// GET|POST /api/realtime-session  ->  ApiResult<{ clientSecret; model; expiresAt? }>
// Mints a short-lived ephemeral client secret so the BROWSER can open a WebRTC
// voice session directly with OpenAI Realtime (the real API key never leaves the
// server). Mock mode returns { ok:false, error:'mock-mode' } on purpose — the
// client then falls back to speechSynthesis (expected, not a bug).
//
// openai@6 ships the GA Realtime surface: `client.realtime.clientSecrets.create`
// (POST /v1/realtime/client_secrets), returning { value, expires_at, session }.
// We use that as primary and fall back to a raw fetch (GA endpoint, then the
// legacy /v1/realtime/sessions beta endpoint on 404).
import { getClient, isMock } from '@/lib/openai';
import type { ApiResult } from '@/lib/types';

type RealtimeSessionData = {
  clientSecret: string;
  model: string;
  expiresAt?: number;
};

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'verse';
const EXPIRES_SECONDS = 600;

const HOMIE_INSTRUCTIONS = [
  'You are Homie, a friendly small floor robot narrating your own actions out loud in a real scanned room.',
  'You have two jobs:',
  '1) NARRATE: When the app sends you a narration line (as text), speak it back VERBATIM in a warm, upbeat robot voice.',
  '   Do not paraphrase, add, or drop words, and do not add commentary before or after it.',
  '2) LISTEN: When the human speaks, treat their words as a TASK COMMAND for the robot',
  '   (e.g. "go to the table", "leave through the door"). Transcribe it faithfully and keep your',
  '   spoken acknowledgement to a short confirmation like "On it!" — the app handles the actual planning.',
  'Keep every spoken response short. Never invent navigation steps or claim to see things you were not told about.',
].join('\n');

function ok(data: RealtimeSessionData): Response {
  return Response.json({ ok: true, data } satisfies ApiResult<RealtimeSessionData>);
}
function err(error: string): Response {
  return Response.json({ ok: false, error } satisfies ApiResult<RealtimeSessionData>);
}

async function handle(): Promise<Response> {
  if (isMock) return err('mock-mode');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return err('missing OPENAI_API_KEY');

  // Session config shared by the SDK path and the raw-fetch fallback.
  // NOTE: the GA API expresses "audio + text transcript" as output_modalities:['audio']
  // (audio comes with a transcript); ['audio','text'] together is not allowed there.
  const session = {
    type: 'realtime' as const,
    model: REALTIME_MODEL,
    instructions: HOMIE_INSTRUCTIONS,
    output_modalities: ['audio'] as Array<'audio' | 'text'>,
    audio: {
      input: {
        turn_detection: { type: 'server_vad' as const },
        transcription: { model: 'gpt-4o-mini-transcribe' },
      },
      output: { voice: REALTIME_VOICE },
    },
  };
  const expires_after = { anchor: 'created_at' as const, seconds: EXPIRES_SECONDS };

  // Primary: typed SDK path.
  try {
    const client = getClient();
    const secrets = client.realtime?.clientSecrets;
    if (secrets && typeof secrets.create === 'function') {
      const resp = await secrets.create({ expires_after, session });
      const respModel =
        (resp.session as { model?: string } | undefined)?.model ?? REALTIME_MODEL;
      return ok({
        clientSecret: resp.value,
        model: respModel,
        expiresAt: resp.expires_at,
      });
    }
  } catch {
    // fall through to the raw-fetch fallback below
  }

  // Fallback: raw fetch to the GA endpoint, then the legacy beta endpoint on 404.
  try {
    return ok(await fetchEphemeral(apiKey, session, expires_after));
  } catch (e) {
    return err(e instanceof Error ? e.message : 'realtime session request failed');
  }
}

async function fetchEphemeral(
  apiKey: string,
  session: {
    type: 'realtime';
    model: string;
    instructions: string;
    output_modalities: Array<'audio' | 'text'>;
    audio: {
      input: {
        turn_detection: { type: 'server_vad' };
        transcription: { model: string };
      };
      output: { voice: string };
    };
  },
  expires_after: { anchor: 'created_at'; seconds: number },
): Promise<RealtimeSessionData> {
  let res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expires_after, session }),
  });

  if (res.status === 404) {
    // Legacy beta endpoint: flat body, returns { client_secret: { value, expires_at } }.
    const legacyBody = {
      model: session.model,
      voice: session.audio.output.voice,
      modalities: ['audio', 'text'],
      instructions: session.instructions,
      turn_detection: session.audio.input.turn_detection,
      input_audio_transcription: session.audio.input.transcription,
    };
    res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify(legacyBody),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`realtime session HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    value?: string;
    expires_at?: number;
    session?: { model?: string };
    model?: string;
    client_secret?: { value?: string; expires_at?: number };
  };

  const clientSecret = data.value ?? data.client_secret?.value;
  const expiresAt = data.expires_at ?? data.client_secret?.expires_at;
  const model = data.session?.model ?? data.model ?? session.model;
  if (!clientSecret || typeof clientSecret !== 'string') {
    throw new Error('realtime response did not include a client secret');
  }
  return { clientSecret, model, expiresAt };
}

export async function POST(): Promise<Response> {
  return handle();
}
export async function GET(): Promise<Response> {
  return handle();
}
