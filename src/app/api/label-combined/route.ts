// POST /api/label-combined  ->  ApiResult<SceneModel>
// Fires GPT-4o (/api/label) and YOLO World v2 (/api/label-sam) in parallel.
// Merges: YOLO objects (precise pixel boxes) + GPT-4o objects (semantic names)
//          + GPT-4o walkable zones (YOLO doesn't produce those).
// Deduplication: objects within 0.3m with the same name keep the YOLO version
// (better spatial precision), otherwise both are kept.
// If either model fails, the other's result is used alone — no hard dependency.
import type { NextRequest } from 'next/server';
import type { ApiResult, SceneModel, SceneObject } from '@/lib/types';

function json(body: ApiResult<SceneModel>, status = 200): Response {
  return Response.json(body, { status });
}

function mergeObjects(yolo: SceneObject[], gpt: SceneObject[]): SceneObject[] {
  const merged: SceneObject[] = [...yolo];

  for (const g of gpt) {
    const nearby = merged.some(
      (y) =>
        y.name.toLowerCase() === g.name.toLowerCase() &&
        Math.hypot(y.position.x - g.position.x, y.position.z - g.position.z) < 0.4,
    );
    if (!nearby) merged.push(g);
  }

  // Renumber duplicates so the planner can address them unambiguously.
  const counts = new Map<string, number>();
  for (const o of merged) counts.set(o.name.toLowerCase(), (counts.get(o.name.toLowerCase()) ?? 0) + 1);
  const seen = new Map<string, number>();
  return merged.map((o, i) => {
    const k = o.name.toLowerCase();
    let name = o.name;
    if ((counts.get(k) ?? 0) > 1) {
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      name = `${o.name} ${n}`;
    }
    return { ...o, id: `combo-${i}`, name };
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json({ ok: false, error: 'invalid body' }, 400);
  }

  // Derive base URL from the incoming request so this works on any port.
  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const headers = { 'Content-Type': 'application/json' };

  const [gptRes, yoloRes] = await Promise.allSettled([
    fetch(`${base}/api/label`, { method: 'POST', headers, body: rawBody }),
    fetch(`${base}/api/label-sam`, { method: 'POST', headers, body: rawBody }),
  ]);

  // Parse whichever responses succeeded.
  const gpt: ApiResult<SceneModel> | null =
    gptRes.status === 'fulfilled' && gptRes.value.ok
      ? await gptRes.value.json().catch(() => null)
      : null;

  const yolo: ApiResult<SceneModel> | null =
    yoloRes.status === 'fulfilled' && yoloRes.value.ok
      ? await yoloRes.value.json().catch(() => null)
      : null;

  const gptScene = gpt?.ok ? gpt.data : null;
  const yoloScene = yolo?.ok ? yolo.data : null;

  // Both failed — return the error.
  if (!gptScene && !yoloScene) {
    const err = [
      gpt?.ok === false ? `GPT-4o: ${gpt.error}` : null,
      yolo?.ok === false ? `YOLO: ${yolo.error}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    return json({ ok: false, error: err || 'both vision models failed' });
  }

  // One failed — return the other.
  if (!gptScene) return json({ ok: true, data: yoloScene! });
  if (!yoloScene) return json({ ok: true, data: gptScene });

  // Both succeeded — merge.
  const scene: SceneModel = {
    bounds: gptScene.bounds, // overall bounds come from GPT-4o (same for both)
    objects: mergeObjects(yoloScene.objects, gptScene.objects),
    walkableZones: gptScene.walkableZones, // only GPT-4o produces these
  };

  return json({ ok: true, data: scene });
}
