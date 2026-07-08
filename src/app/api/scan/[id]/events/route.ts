// SSE stream that tells the desktop Studio the instant a phone uploads a scan.
//   GET /api/scan/[id]/events  -> text/event-stream
//     event: hello                       (on connect)
//     event: scan-ready  data: ScanInfo  (on upload, or immediately if one exists)
//     : heartbeat                         (comment line every 15s to keep alive)
//
// Consumed by useScanSync via EventSource, which auto-reconnects natively.
import type { NextRequest } from 'next/server';
import { getScanInfo, subscribeScan, type ScanInfo } from '@/lib/store';

const HEARTBEAT_MS = 15_000;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const sendScanReady = (info: ScanInfo) => {
        send(
          `event: scan-ready\ndata: ${JSON.stringify({
            id: info.id,
            size: info.size,
            ts: info.ts,
          })}\n\n`,
        );
      };

      // Greeting so the client can flip to a "waiting" state immediately.
      send(`event: hello\ndata: ${JSON.stringify({ id })}\n\n`);

      // Subscribe BEFORE the existing-scan check so an upload racing the
      // connect can't slip through the gap unnotified.
      unsubscribe = subscribeScan(id, sendScanReady);

      // Refresh-after-upload: if a scan is already stored, fire immediately.
      const existing = getScanInfo(id);
      if (existing) sendScanReady(existing);

      heartbeat = setInterval(() => send(`: heartbeat\n\n`), HEARTBEAT_MS);
    },

    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe = null;
      heartbeat = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
