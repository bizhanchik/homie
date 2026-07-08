// POST /api/label-sam  ->  ApiResult<SceneModel>
// Open-source vision pipeline: YOLO World v2 (ultralytics/yolov8s-worldv2) on Replicate.
// Open-vocabulary object detection — one API call, labeled bboxes, no GPT-4o needed.
// Model: https://replicate.com/ultralytics/yolov8s-worldv2
//
// Requires REPLICATE_API_TOKEN in .env.local.
// Falls back gracefully on error — robot still navigates via LiDAR geometry.
// Emergency revert: git checkout pre-sam2-gpt4o-working
import Replicate from 'replicate';
import type { NextRequest } from 'next/server';
import { labelRequestSchema } from '@/lib/schemas';
import { imageToWorld } from '@/lib/types';
import type { ApiResult, Bounds, SceneModel, SceneObject } from '@/lib/types';

// YOLO World v2 — open-vocabulary detection classes.
// Comma-separated list sent as class_names input.
const ROOM_CLASSES = [
  'chair', 'armchair', 'sofa', 'couch', 'table', 'dining table', 'desk',
  'shelf', 'bookshelf', 'cabinet', 'wardrobe', 'bed', 'lamp', 'tv',
  'monitor', 'plant', 'door', 'window', 'refrigerator', 'rug',
  'counter', 'toilet', 'sink', 'bathtub', 'dresser', 'nightstand',
].join(', ');

// YOLO World v2 detection output shape (when return_json=true → json_str field).
type YoloDetection = {
  name: string;
  class: number;
  confidence: number;
  box: { x1: number; y1: number; x2: number; y2: number };
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
    return { ...o, id: `yolo-${i}`, name };
  });
}

// Read PNG pixel dimensions from the first 24 bytes (no deps).
function getPngDimensions(base64: string): { width: number; height: number } {
  try {
    const bytes = Buffer.from(base64.slice(0, 48), 'base64');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } catch {
    return { width: 1024, height: 1024 };
  }
}

function detectionToObject(
  det: YoloDetection,
  index: number,
  imageW: number,
  imageH: number,
  imageBounds: Bounds,
): SceneObject | null {
  const { x1, y1, x2, y2 } = det.box;
  if (x2 <= x1 || y2 <= y1) return null;

  // Normalize to [0,1] image space.
  const cx = (x1 + x2) / 2 / imageW;
  const cy = (y1 + y2) / 2 / imageH;
  const bw = (x2 - x1) / imageW;
  const bh = (y2 - y1) / imageH;

  // Drop off-image or noise detections.
  if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return null;
  const area = bw * bh;
  if (area < 0.01 || area > 0.65) return null;

  const worldW = Math.abs(imageBounds.maxX - imageBounds.minX);
  const worldH = Math.abs(imageBounds.maxZ - imageBounds.minZ);

  const position = imageToWorld({ x: cx, z: cy }, imageBounds);
  const size = {
    w: Math.max(0.1, bw * worldW),
    d: Math.max(0.1, bh * worldH),
  };

  const name = det.name.replace(/\b\w/g, (c) => c.toUpperCase()).trim();

  return {
    id: `yolo-${index}`,
    name,
    position,
    size,
    kind: inferKind(det.name),
  };
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return json({
      ok: false,
      error: 'REPLICATE_API_TOKEN not set. Add to .env.local and restart the server.',
    }, 500);
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return json({ ok: false, error: 'invalid JSON body' }, 400);
  }

  const parsed = labelRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: `invalid LabelRequest: ${parsed.error.message}` }, 400);
  }

  const { bounds, images } = parsed.data;
  const { imageDataUrl, bounds: imageBounds } = images[0];

  const base64Data = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
  const { width: imageW, height: imageH } = getPngDimensions(base64Data);

  const buffer = Buffer.from(base64Data, 'base64');
  const blob = new Blob([buffer], { type: 'image/png' });

  try {
    const replicate = new Replicate({ auth: token });

    // YOLO World v2 — open-vocabulary object detection.
    // Version pinned for stability; update at replicate.com/ultralytics/yolov8s-worldv2
    const rawOutput = await replicate.run(
      'ultralytics/yolov8s-worldv2:9d109240fd8fa73c41dbac9c17f651fc4c0b42261c2ec9db3a975a56b704e2b1',
      {
        input: {
          image: blob,
          class_names: ROOM_CLASSES,
          conf: 0.2,
          iou: 0.45,
          return_json: true,
        },
      },
    ) as { json_str?: string; image?: string } | null;

    if (!rawOutput || !rawOutput.json_str) {
      return json({ ok: false, error: 'YOLO World returned no output' });
    }

    let detections: YoloDetection[] = [];
    try {
      detections = JSON.parse(rawOutput.json_str) as YoloDetection[];
    } catch {
      return json({ ok: false, error: `failed to parse YOLO output: ${rawOutput.json_str?.slice(0, 100)}` });
    }

    const objects: SceneObject[] = detections
      .filter((d) => d.confidence >= 0.2)
      .map((d, i) => detectionToObject(d, i, imageW, imageH, imageBounds))
      .filter((o): o is SceneObject => o !== null);

    const scene: SceneModel = {
      bounds,
      objects: dedupeObjects(objects),
      walkableZones: [],
    };

    return json({ ok: true, data: scene });
  } catch (e) {
    return json({
      ok: false,
      error: `YOLO World failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
