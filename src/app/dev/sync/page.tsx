'use client';

// Dev harness for the phone->desktop scan-sync seam. Generates a session id,
// shows the QR wired to useScanSync, and lets you either scan with a real phone
// or click "simulate phone upload" (POSTs public/sample-room.glb) to test the
// whole loop without a device.
import { useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { QrPairing } from '@/components/QrPairing';
import { useScanSync } from '@/lib/use-scan-sync';

export default function DevSyncPage() {
  // Fresh id per mount, generated client-side to avoid SSR hydration mismatch.
  const [sessionId, setSessionId] = useState('');
  useEffect(() => setSessionId(nanoid(10)), []);

  if (!sessionId) {
    return (
      <main className="min-h-dvh bg-neutral-950 text-neutral-500 grid place-items-center">
        starting session…
      </main>
    );
  }

  return <DevSyncInner key={sessionId} sessionId={sessionId} onReset={() => setSessionId(nanoid(10))} />;
}

function DevSyncInner({
  sessionId,
  onReset,
}: {
  sessionId: string;
  onReset: () => void;
}) {
  const { status, scanInfo, fetchScan, mobileUrl } = useScanSync(sessionId);
  const [fetched, setFetched] = useState<number | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [simMsg, setSimMsg] = useState<string | null>(null);

  // When the phone (or the simulate button) beams a scan, pull the bytes down
  // and show the size so we can confirm a round-trip.
  useEffect(() => {
    if (status !== 'received') return;
    let cancelled = false;
    fetchScan()
      .then((ab) => {
        if (!cancelled) {
          setFetched(ab.byteLength);
          setFetchErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setFetchErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [status, scanInfo, fetchScan]);

  async function simulateUpload() {
    setSimMsg('uploading sample-room.glb…');
    try {
      const glb = await fetch('/sample-room.glb').then((r) => r.arrayBuffer());
      const res = await fetch(`/api/scan/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'model/gltf-binary' },
        body: glb,
      });
      const json = await res.json();
      setSimMsg(`POST -> ${JSON.stringify(json)}`);
    } catch (e) {
      setSimMsg(`error: ${String(e)}`);
    }
  }

  const statusColor = useMemo(
    () =>
      status === 'received'
        ? 'text-emerald-400'
        : status === 'waiting'
          ? 'text-amber-400'
          : 'text-neutral-400',
    [status],
  );

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Scan sync — dev harness</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Scan the QR with a phone, or click simulate.
          </p>
        </div>

        <QrPairing status={status} mobileUrl={mobileUrl} />

        <dl className="w-full space-y-1 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 font-mono text-xs">
          <Row k="session" v={sessionId} />
          <Row k="status" v={status} vClass={statusColor} />
          <Row
            k="scanInfo"
            v={scanInfo ? `${scanInfo.size} B @ ${new Date(scanInfo.ts).toLocaleTimeString()}` : '—'}
          />
          <Row
            k="fetched"
            v={fetchErr ?? (fetched != null ? `${fetched} B` : '—')}
            vClass={fetchErr ? 'text-red-400' : undefined}
          />
        </dl>

        <div className="flex w-full flex-col gap-3">
          <button
            onClick={simulateUpload}
            className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-neutral-950 active:scale-[0.98]"
          >
            Simulate phone upload
          </button>
          <button
            onClick={() => {
              setFetched(null);
              setFetchErr(null);
              setSimMsg(null);
              onReset();
            }}
            className="w-full rounded-xl border border-neutral-700 px-4 py-3 text-sm text-neutral-300 active:scale-[0.98]"
          >
            New session
          </button>
        </div>

        {simMsg && (
          <pre className="w-full overflow-x-auto rounded-lg bg-neutral-900 p-3 text-[11px] text-neutral-400">
            {simMsg}
          </pre>
        )}
      </div>
    </main>
  );
}

function Row({
  k,
  v,
  vClass,
}: {
  k: string;
  v: string;
  vClass?: string;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{k}</dt>
      <dd className={`break-all text-right ${vClass ?? 'text-neutral-200'}`}>
        {v}
      </dd>
    </div>
  );
}
