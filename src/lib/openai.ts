// OpenAI client + mock-mode flag + structured-completion helper.
// SERVER-ONLY: this module reads OPENAI_API_KEY and constructs the OpenAI client;
// never import it from a Client Component. Only the /api/{label,plan,realtime-session}
// route handlers use it.
//
// Errors-as-values: structuredCompletion NEVER throws — it returns ApiResult<T>.
import OpenAI from 'openai';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type { ApiResult } from './types';

/**
 * When true, /api/label, /api/plan, and /api/realtime-session must return
 * deterministic mocked data instead of calling OpenAI. True when there's no API
 * key, or when MOCK_AI=1 is set explicitly (e.g. for demos without spend).
 */
export const isMock =
  !process.env.OPENAI_API_KEY || process.env.MOCK_AI === '1';

/** Chat model used for the label (vision) + plan/replan structured calls. */
export const CHAT_MODEL = 'gpt-4o';

// --- Lazy client singleton ---------------------------------------------------
// Constructed on first use so importing this module in mock mode (no key) is
// harmless. `new OpenAI()` reads OPENAI_API_KEY (and OPENAI_BASE_URL) from env.
let _client: OpenAI | null = null;
export function getClient(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

// --- zod -> OpenAI strict JSON Schema ---------------------------------------
// OpenAI structured outputs `strict: true` require EVERY object to list all of
// its properties in `required` and set `additionalProperties: false`. zod's
// `toJSONSchema` already emits `additionalProperties: false`, but it omits
// `.optional()` fields from `required`. We therefore (a) force every property
// into `required`, and (b) make the originally-optional ones nullable so the
// model can emit `null` for them. We then strip those nulls before zod parsing
// (see stripNulls) so zod's `.optional()` (which accepts undefined, not null)
// still validates.

type JsonNode = Record<string, unknown>;

function makeNullable(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as JsonNode;
  if (typeof n.type === 'string') {
    return { ...n, type: [n.type, 'null'] };
  }
  if (Array.isArray(n.type)) {
    return n.type.includes('null') ? n : { ...n, type: [...n.type, 'null'] };
  }
  // No simple `type` (e.g. anyOf/enum-only) — wrap in a nullable union.
  return { anyOf: [n, { type: 'null' }] };
}

function makeStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(makeStrict);
  if (!node || typeof node !== 'object') return node;
  const n = node as JsonNode;

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(n[key])) n[key] = (n[key] as unknown[]).map(makeStrict);
  }
  if (n.items) n.items = makeStrict(n.items);
  if (n.$defs && typeof n.$defs === 'object') {
    const defs = n.$defs as JsonNode;
    for (const k of Object.keys(defs)) defs[k] = makeStrict(defs[k]);
  }

  if (n.type === 'object' && n.properties && typeof n.properties === 'object') {
    const props = n.properties as JsonNode;
    const keys = Object.keys(props);
    const originalRequired = new Set(
      Array.isArray(n.required) ? (n.required as string[]) : [],
    );
    for (const k of keys) {
      let child = makeStrict(props[k]);
      if (!originalRequired.has(k)) child = makeNullable(child);
      props[k] = child;
    }
    n.required = keys;
    n.additionalProperties = false;
  }
  return n;
}

function toStrictJSONSchema(schema: ZodType): JsonNode {
  const full = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    reused: 'inline', // inline shared subschemas so there are no $ref cycles
    unrepresentable: 'any',
  }) as JsonNode;
  // Drop keys OpenAI's validator does not want on the schema object.
  const { $schema: _s, ['~standard']: _std, ...rest } = full as JsonNode & {
    ['~standard']?: unknown;
  };
  void _s;
  void _std;
  return makeStrict(rest) as JsonNode;
}

/** Recursively drop null-valued properties (see makeStrict rationale). */
function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null) continue;
      out[k] = stripNulls(val);
    }
    return out;
  }
  return v;
}

// --- Structured completion ---------------------------------------------------

export type StructuredUserContent =
  | string
  | Array<OpenAI.Chat.Completions.ChatCompletionContentPart>;

export type StructuredCompletionOpts<T> = {
  system: string;
  user: StructuredUserContent;
  schema: ZodType<T>;
  schemaName: string;
};

/**
 * Run a single chat.completions call constrained to a JSON schema, validate the
 * result with the same zod schema, and return ApiResult<T>. On a validation or
 * JSON-parse failure it retries ONCE with the error fed back to the model, then
 * returns { ok:false }. Never throws.
 */
export async function structuredCompletion<T>(
  opts: StructuredCompletionOpts<T>,
): Promise<ApiResult<T>> {
  const { system, user, schema, schemaName } = opts;
  try {
    const client = getClient();
    const jsonSchema = toStrictJSONSchema(schema);

    const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        attempt === 0
          ? baseMessages
          : [
              ...baseMessages,
              {
                role: 'user',
                content:
                  `Your previous response was invalid: ${lastError}. ` +
                  'Return corrected STRICT JSON that matches the schema exactly. No prose, no markdown.',
              },
            ];

      const completion = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema: jsonSchema },
        },
      });

      const choice = completion.choices[0];
      const refusal = choice?.message?.refusal;
      if (refusal) {
        lastError = `model refused: ${refusal}`;
        continue;
      }
      const content = choice?.message?.content;
      if (!content) {
        lastError = 'empty model response';
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch (e) {
        lastError = `response was not valid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`;
        continue;
      }

      const parsed = schema.safeParse(stripNulls(raw));
      if (parsed.success) return { ok: true, data: parsed.data };
      lastError = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    }

    return {
      ok: false,
      error: `${schemaName} did not match schema after retry: ${lastError}`,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'unknown OpenAI error',
    };
  }
}
