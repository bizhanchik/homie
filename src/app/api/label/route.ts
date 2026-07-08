// POST /api/label  ->  ApiResult<SceneModel>
// Mock mode: deterministic SceneModel matching sample-room.glb.
// Real mode: GPT-4o vision labels a top-down render in NORMALIZED [0,1] image
// coords; we convert to WORLD meters via imageToWorld, sanitize, and inject bounds.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { isMock, structuredCompletion } from '@/lib/openai';
import { labelPrompt } from '@/lib/prompts';
import { labelRequestSchema, sceneModelSchema, vec2Schema } from '@/lib/schemas';
import { imageToWorld } from '@/lib/types';
import type { ApiResult, Bounds, SceneModel, SceneObject } from '@/lib/types';
import { mockSceneModel } from '@/lib/mock-data';

// What the vision model returns: a SceneModel minus `bounds`, with all numbers in
// NORMALIZED [0,1] image space. Reuses the shared object shape (id/name/kind/
// position/size) so semantics stay in lockstep with types.ts.
const labelResponseSchema = sceneModelSchema
  .omit({ bounds: true })
  .extend({
    walkableZones: z.array(z.object({ center: vec2Schema, radius: z.number() })),
  });

function inUnit(v: number): boolean {
  return Number.isFinite(v) && v >= -0.02 && v <= 1.02;
}

function json(body: ApiResult<SceneModel>, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON body' }, 400);
  }

  const parsed = labelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: `invalid LabelRequest: ${parsed.error.message}` },
      400,
    );
  }
  const { imageDataUrl, bounds } = parsed.data;

  if (isMock) {
    await new Promise((r) => setTimeout(r, 700)); // let the UI show its loading state
    return json({ ok: true, data: mockSceneModel(bounds) });
  }

  const { system, user } = labelPrompt();
  const result = await structuredCompletion({
    system,
    user: [
      { type: 'text', text: user },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
    schema: labelResponseSchema,
    schemaName: 'room_scene',
  });
  if (!result.ok) return json(result);

  const scene = normalizeToWorld(result.data, bounds);

  // Final guard: the assembled world-coord SceneModel must satisfy the shared schema.
  const check = sceneModelSchema.safeParse(scene);
  if (!check.success) {
    return json({ ok: false, error: `assembled scene invalid: ${check.error.message}` });
  }
  return json({ ok: true, data: check.data });
}

/**
 * Convert a normalized-coords label response into a world-coords SceneModel:
 * map positions with imageToWorld, scale footprint/radius by the world span,
 * drop objects whose normalized position is off-image, and dedupe near-duplicate
 * same-name objects.
 */
function normalizeToWorld(
  data: z.infer<typeof labelResponseSchema>,
  bounds: Bounds,
): SceneModel {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  const avgScale = (Math.abs(width) + Math.abs(height)) / 2;

  const objects: SceneObject[] = [];
  data.objects.forEach((o, i) => {
    if (!inUnit(o.position.x) || !inUnit(o.position.z)) return; // off-image -> drop
    const position = imageToWorld(o.position, bounds);
    const candidate: SceneObject = {
      id: o.id && o.id.trim() ? o.id : `obj-${i}`,
      name: o.name,
      kind: o.kind,
      position,
      size: {
        w: Math.max(0.05, Math.abs(o.size.w) * Math.abs(width)),
        d: Math.max(0.05, Math.abs(o.size.d) * Math.abs(height)),
      },
    };
    // Dedupe: same (case-insensitive) name within 0.3m of an accepted object.
    const dup = objects.some(
      (e) =>
        e.name.toLowerCase() === candidate.name.toLowerCase() &&
        Math.hypot(
          e.position.x - candidate.position.x,
          e.position.z - candidate.position.z,
        ) < 0.3,
    );
    if (!dup) objects.push(candidate);
  });

  const walkableZones = data.walkableZones
    .filter((zn) => inUnit(zn.center.x) && inUnit(zn.center.z))
    .map((zn) => ({
      center: imageToWorld(zn.center, bounds),
      radius: Math.max(0.05, Math.abs(zn.radius) * avgScale),
    }));

  return { bounds, objects, walkableZones };
}
