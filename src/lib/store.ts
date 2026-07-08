// In-memory scan store for the phone->desktop room-sync flow.
//
// The server is the single local `next dev` process, so plain in-memory state
// is enough for the demo. The one hazard is Turbopack HMR: editing a file that
// imports this module re-evaluates it and would blow away uploaded scans +
// live SSE subscribers. We defend against that by hanging the state off
// `globalThis`, which survives module re-evaluation within the same process.

export type ScanInfo = { id: string; size: number; ts: number };
type ScanListener = (info: ScanInfo) => void;

type ScanEntry = {
  buffer: Buffer;
  info: ScanInfo;
};

type HomieStore = {
  scans: Map<string, ScanEntry>;
  listeners: Map<string, Set<ScanListener>>;
};

const g = globalThis as unknown as { __homieStore?: HomieStore };

const store: HomieStore = (g.__homieStore ??= {
  scans: new Map<string, ScanEntry>(),
  listeners: new Map<string, Set<ScanListener>>(),
});

/**
 * Store the GLB bytes for a session id and notify every live subscriber.
 * Accepts an ArrayBuffer (from `req.arrayBuffer()`) or a Node Buffer.
 * Re-uploads for the same id overwrite the previous scan.
 */
export function putScan(id: string, data: ArrayBuffer | Buffer): void {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const info: ScanInfo = { id, size: buffer.byteLength, ts: Date.now() };
  store.scans.set(id, { buffer, info });

  const subs = store.listeners.get(id);
  if (subs) {
    for (const fn of subs) {
      try {
        fn(info);
      } catch {
        // A broken listener must never break the upload or the other listeners.
      }
    }
  }
}

/** Return the stored GLB bytes for a session id, or null if none uploaded yet. */
export function getScan(id: string): Buffer | null {
  return store.scans.get(id)?.buffer ?? null;
}

/** Return metadata (id/size/ts) for a stored scan without copying the bytes. */
export function getScanInfo(id: string): ScanInfo | null {
  return store.scans.get(id)?.info ?? null;
}

/**
 * Subscribe to uploads for a session id. `fn` fires every time a scan is put
 * for that id. Returns an unsubscribe function (call it on stream cancel).
 */
export function subscribeScan(id: string, fn: ScanListener): () => void {
  let subs = store.listeners.get(id);
  if (!subs) {
    subs = new Set<ScanListener>();
    store.listeners.set(id, subs);
  }
  subs.add(fn);

  return () => {
    const set = store.listeners.get(id);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) store.listeners.delete(id);
  };
}
