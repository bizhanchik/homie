// Phone-side GLB upload + retrieval.
//   POST /api/scan/[id]  raw GLB body   -> { ok, data: { size, glb } }
//   GET  /api/scan/[id]                 -> model/gltf-binary bytes | 404 JSON
//
// Next 16: `params` is a Promise (async), route handlers read raw bodies via
// Web APIs with no framework body-size limit — fine for multi-MB scans.
import type { NextRequest } from 'next/server';
import { getScan, putScan } from '@/lib/store';

// GLB magic number: the ASCII bytes "glTF" (0x67 0x6C 0x54 0x46) at offset 0.
function looksLikeGlb(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x67 && // g
    buf[1] === 0x6c && // l
    buf[2] === 0x54 && // T
    buf[3] === 0x46 //// F
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let ab: ArrayBuffer;
  try {
    ab = await req.arrayBuffer();
  } catch {
    return Response.json(
      { ok: false, error: 'could not read request body' },
      { status: 400 },
    );
  }

  const buf = Buffer.from(ab);
  if (buf.byteLength === 0) {
    return Response.json(
      { ok: false, error: 'empty upload' },
      { status: 400 },
    );
  }

  // Sanity-flag non-GLB payloads but still accept them — the viewer can decide
  // what to do, and we never want a demo upload to silently 4xx.
  const glb = looksLikeGlb(buf);
  putScan(id, buf);

  return Response.json({ ok: true, data: { size: buf.byteLength, glb } });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const buf = getScan(id);

  if (!buf) {
    return Response.json(
      { ok: false, error: 'no scan for this session yet' },
      { status: 404 },
    );
  }

  // Copy into a fresh Uint8Array so the Response body is a clean ArrayBuffer
  // view (a pooled Node Buffer can be a slice of a larger allocation).
  const body = new Uint8Array(buf.byteLength);
  body.set(buf);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
