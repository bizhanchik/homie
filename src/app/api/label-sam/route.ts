// POST /api/label-sam  ->  ApiResult<SceneModel>
// Open-source vision pipeline: Grounded SAM 2 (GroundingDINO + SAM2) on Replicate.
// One API call: send the top-down room render + a text vocabulary, get back
// labeled bounding boxes. No CLIP needed — GroundingDINO handles text grounding.
//
// If REPLICATE_API_TOKEN is missing the route fails fast with a clear error.
// The agent treats { ok:false } gracefully — robot still navigates via geometry.
//
// To switch back to GPT-4o: use the "Vision model" toggle in the studio UI.
// Emergency: git checkout pre-sam2-gpt4o-working
import Replicate from 'replicate';
import type { NextRequest } from 'next/server';
import { labelRequestSchema } from '@/lib/schemas';
import { imageToWorld } from '@/lib/types';
import type { ApiResult, Bounds, SceneModel, SceneObject } from '@/lib/types';

// Vocabulary sent to Grounded SAM 2 as the text prompt.
// GroundingDINO uses ' . ' as separator between labels.
const ROOM_VOCAB = [
  'chair', 'armchair', 'sofa', 'couch', 'table', 'dining table', 'desk',
  'shelf', 'bookshelf', 'cabinet', 'wardrobe', 'closet', 'bed', 'lamp',
  'tv', 'television', 'monitor', 'plant', 'door', 'window', 'refrigerator',
  'fridge', 'rug', 'carpet', 'counter', 'toilet', 'sink', 'bathtub',
  'dresser', 'nightstand', 'ottoman',
].join(' . ');

// Grounded SAM 2 output format from Replicate.
// Verify at: https://replicate.com/lucataco/grounded-sam-2
// The model returns detections as structured JSON (not just an image).
type GsamDetection = {
  label: string;
  score: number;
  // Pixel-space bounding box: [x_min, y_min, x_max, y_max]
  box: [number, number, number, number];
};

type GsamOutput = {
  detections: GsamDetection[];
  // Model also returns an annotated image URL — we ignore it.
  [key: string]: unknown;
};

const KIND_MAP: Record<string, SceneObject['kind']> = {
  door: 'door',
  window: 'opening',
};

function inferKind(name: string): SceneObject['kind'] {
  return KIND_MAP[name.toLowerCase()] ?? 'furniture';
}

function json(body: ApiResult<SceneModel>, status = 200): Response {
  return Response.json(body, { status });
}

// Dedup objects within 0.3m of same name, then number duplicates —
// same logic as the GPT-4o route.
function dedupeObjects(candidates: SceneObject[]): SceneObject[] {
  const kept: SceneObject[] = [];
  for (const c of candidates) {
    const dup = kept.some(
      (e) =>
        e.name.toLowerCase() === c.name.toLowerCase() &&
        Math.hypot(e.position.x - c.position.x, e.position.z - c.position.z) < 0.3,
    );
    if (!dup) kept.push(c);
  }

  const counts = new Map<string, number>();
  for (const o of kept) counts.set(o.name.toLowerCase(), (counts.get(o.name.toLowerCase()) ?? 0) + 1);

  const seen = new Map<string, number>();
  return kept.map((o, i) => {
    const k = o.name.toLowerCase();
    let name = o.name;
    if ((counts.get(k) ?? 0) > 1) {
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      name = `${o.name} ${n}`;
    }
    return { ...o, id: `sam-${i}`, name };
  });
}

// Convert a Grounded SAM 2 detection (pixel bbox) to a SceneObject.
// imageW/imageH: pixel dimensions of the top-down render.
// imageBounds: world-space rect this image covers (for imageToWorld).
function detectionToObject(
  det: GsamDetection,
  index: number,
  imageW: number,
  imageH: number,
  imageBounds: Bounds,
): SceneObject | null {
  const [x1, y1, x2, y2] = det.box;
  if (x1 >= x2 || y1 >= y2) return null;

  // Normalize to [0,1] image space.
  const cx = (x1 + x2) / 2 / imageW;
  const cy = (y1 + y2) / 2 / imageH;
  const bw = (x2 - x1) / imageW;
  const bh = (y2 - y1) / imageH;

  // Clamp: drop anything outside the image.
  if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return null;

  // Filter noise: skip segments smaller than 1% or larger than 60% of image area.
  const areaNorm = bw * bh;
  if (areaNorm < 0.01 || areaNorm > 0.6) return null;

  const worldSpan = {
    x: imageBounds.maxX - imageBounds.minX,
    z: imageBounds.maxZ - imageBounds.minZ,
  };

  const position = imageToWorld({ x: cx, z: cy }, imageBounds);
  const size = {
    w: Math.max(0.1, bw * Math.abs(worldSpan.x)),
    d: Math.max(0.1, bh * Math.abs(worldSpan.z)),
  };

  const rawName = det.label
    .replace(/\b\w/g, (c) => c.toUpperCase()) // Title Case
    .trim();

  return {
    id: `sam-${index}`,
    name: rawName,
    position,
    size,
    kind: inferKind(det.label),
  };
}

// Read image dimensions from a PNG base64 string without any native deps.
// PNG stores width at bytes 16-19 and height at bytes 20-23.
function getPngDimensions(base64: string): { width: number; height: number } {
  const bytes = Buffer.from(base64.slice(0, 64), 'base64');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return json(
      {
        ok: false,
        error:
          'REPLICATE_API_TOKEN not set. Add it to .env.local:\n  REPLICATE_API_TOKEN=r8_...\nGet yours at https://replicate.com/account/api-tokens',
      },
      500,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON body' }, 400);
  }

  const parsed = labelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: `invalid LabelRequest: ${parsed.error.message}` }, 400);
  }

  const { bounds, images } = parsed.data;
  // Use only the full-room image (index 0) — Grounded SAM 2 handles the whole scene in one pass.
  const { imageDataUrl, bounds: imageBounds } = images[0];

  const base64Data = imageDataUrl.includes(',')
    ? imageDataUrl.split(',')[1]
    : imageDataUrl;

  let imageW: number;
  let imageH: number;
  try {
    const dims = getPngDimensions(base64Data);
    imageW = dims.width;
    imageH = dims.height;
    if (!imageW || !imageH) throw new Error('zero dimensions');
  } catch {
    // Fallback: assume square 1024×1024 render (RoomViewer default).
    imageW = 1024;
    imageH = 1024;
  }

  // Convert data URL to Blob — Replicate SDK uploads it automatically.
  const buffer = Buffer.from(base64Data, 'base64');
  const blob = new Blob([buffer], { type: 'image/png' });

  try {
    const replicate = new Replicate({ auth: token });

    // Grounded SAM 2 on Replicate.
    // Model page: https://replicate.com/lucataco/grounded-sam-2
    // If this model ID changes, update it here. Check the model page for the latest version.
    const rawOutput = await replicate.run('lucataco/grounded-sam-2', {
      input: {
        image: blob,
        prompt: ROOM_VOCAB,
        box_threshold: 0.25,
        text_threshold: 0.25,
      },
    });

    // Parse the output — model returns detections as JSON.
    // If the structure changes, log rawOutput here to inspect it.
    let detections: GsamDetection[] = [];
    if (rawOutput && typeof rawOutput === 'object') {
      const out = rawOutput as GsamOutput;
      if (Array.isArray(out.detections)) {
        detections = out.detections;
      } else {
        // Some versions return the array at the top level.
        const arr = Object.values(out).find((v) => Array.isArray(v));
        if (Array.isArray(arr)) detections = arr as GsamDetection[];
      }
    }

    const objects: SceneObject[] = detections
      .filter((d) => d.score >= 0.3)
      .map((d, i) => detectionToObject(d, i, imageW, imageH, imageBounds))
      .filter((o): o is SceneObject => o !== null);

    const scene: SceneModel = {
      bounds,
      objects: dedupeObjects(objects),
      // Grounded SAM 2 doesn't predict walkable zones — agent uses the
      // occupancy grid from the LiDAR mesh directly, so this is fine.
      walkableZones: [],
    };

    return json({ ok: true, data: scene });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({
      ok: false,
      error: `Grounded SAM 2 failed: ${msg}. Check REPLICATE_API_TOKEN and model availability.`,
    });
  }
}
