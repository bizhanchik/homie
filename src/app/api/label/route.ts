// POST /api/label  ->  ApiResult<SceneModel>
// Mock mode: deterministic SceneModel matching sample-room.glb.
// Real mode: GPT-4o vision labels a MULTI-IMAGE top-down capture (one full-room
// render + overlapping zoomed crops) in NORMALIZED [0,1] image coords, PER IMAGE.
// We convert each image to WORLD meters via imageToWorld using ITS OWN bounds,
// concatenate, dedupe near-duplicate same-name objects across all images, and
// inject the overall bounds.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { isMock, structuredCompletion, type StructuredUserContent } from '@/lib/openai';
import { labelPrompt } from '@/lib/prompts';
import { labelRequestSchema, sceneModelSchema, vec2Schema } from '@/lib/schemas';
import { imageToWorld } from '@/lib/types';
import type { ApiResult, Bounds, SceneModel, SceneObject } from '@/lib/types';
import { mockSceneModel } from '@/lib/mock-data';

// What the vision model returns PER IMAGE: a SceneModel minus `bounds`, with all
// numbers in NORMALIZED [0,1] image space. Reuses the shared object shape
// (id/name/kind/position/size) so semantics stay in lockstep with types.ts.
const perImageLabelSchema = sceneModelSchema
  .omit({ bounds: true })
  .extend({
    walkableZones: z.array(z.object({ center: vec2Schema, radius: z.number() })),
  });

// The full multi-image response: one label set per input image, in order.
const multiImageLabelResponseSchema = z.object({
  images: z.array(perImageLabelSchema),
});

// Element type of structuredCompletion's array `user` content (mixed text/image).
type ContentParts = Extract<StructuredUserContent, unknown[]>;

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
  const { bounds, images } = parsed.data;

  if (isMock) {
    await new Promise((r) => setTimeout(r, 700)); // let the UI show its loading state
    return json({ ok: true, data: mockSceneModel(bounds) });
  }

  const { system, user } = labelPrompt();

  // One call: a leading text block, then for each image an ordered
  // "Image N — <role>" text block followed by its image_url block.
  const content: ContentParts = [{ type: 'text', text: user }];
  images.forEach((img, i) => {
    content.push({
      type: 'text',
      text: `Image ${i + 1}${i === 0 ? ' — full room' : ' — zoomed region crop'}`,
    });
    content.push({ type: 'image_url', image_url: { url: img.imageDataUrl } });
  });

  const result = await structuredCompletion({
    system,
    user: content,
    schema: multiImageLabelResponseSchema,
    schemaName: 'room_scene',
  });
  if (!result.ok) return json(result);

  // Zip the model's per-image results against the request images BY INDEX. Never
  // throws if the counts differ (openai.ts guarantees errors-as-values); we just
  // process the images both sides agree on.
  const perImage = result.data.images;
  const n = Math.min(perImage.length, images.length);

  const objects: SceneObject[] = [];
  const walkableZones: SceneModel['walkableZones'] = [];
  for (let i = 0; i < n; i++) {
    const converted = convertImageToWorld(perImage[i], images[i].bounds);
    objects.push(...converted.objects);
    walkableZones.push(...converted.walkableZones);
  }

  // Dedupe ACROSS the whole merged list (overlapping tiles produce duplicates).
  const scene: SceneModel = {
    bounds,
    objects: dedupeObjects(objects),
    walkableZones,
  };

  // Final guard: the assembled world-coord SceneModel must satisfy the shared schema.
  const check = sceneModelSchema.safeParse(scene);
  if (!check.success) {
    return json({ ok: false, error: `assembled scene invalid: ${check.error.message}` });
  }
  return json({ ok: true, data: check.data });
}

/**
 * Convert ONE image's normalized-coords label set into world coords using THAT
 * image's own bounds: map positions with imageToWorld, scale footprint/radius by
 * the image's world span, and drop objects whose normalized position is off-image.
 * Dedupe is deliberately NOT done here — it runs once over the merged list.
 */
function convertImageToWorld(
  data: z.infer<typeof perImageLabelSchema>,
  bounds: Bounds,
): { objects: SceneObject[]; walkableZones: SceneModel['walkableZones'] } {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  const avgScale = (Math.abs(width) + Math.abs(height)) / 2;

  const objects: SceneObject[] = [];
  data.objects.forEach((o, i) => {
    if (!inUnit(o.position.x) || !inUnit(o.position.z)) return; // off-image -> drop
    const position = imageToWorld(o.position, bounds);
    objects.push({
      id: o.id && o.id.trim() ? o.id : `obj-${i}`,
      name: o.name,
      kind: o.kind,
      position,
      size: {
        w: Math.max(0.05, Math.abs(o.size.w) * Math.abs(width)),
        d: Math.max(0.05, Math.abs(o.size.d) * Math.abs(height)),
      },
    });
  });

  const walkableZones = data.walkableZones
    .filter((zn) => inUnit(zn.center.x) && inUnit(zn.center.z))
    .map((zn) => ({
      center: imageToWorld(zn.center, bounds),
      radius: Math.max(0.05, Math.abs(zn.radius) * avgScale),
    }));

  return { objects, walkableZones };
}

/**
 * Dedupe a merged object list: drop any object with the same (case-insensitive)
 * name within 0.3m of an already-accepted one (near-duplicates from overlapping
 * tiles), then re-id sequentially so every surviving object has a unique id.
 */
function dedupeObjects(candidates: SceneObject[]): SceneObject[] {
  const kept: SceneObject[] = [];
  for (const c of candidates) {
    const dup = kept.some(
      (e) =>
        e.name.toLowerCase() === c.name.toLowerCase() &&
        Math.hypot(
          e.position.x - c.position.x,
          e.position.z - c.position.z,
        ) < 0.3,
    );
    if (!dup) kept.push(c);
  }
  return kept.map((o, i) => ({ ...o, id: `obj-${i}` }));
}
