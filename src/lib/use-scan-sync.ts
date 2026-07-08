'use client';

// Desktop-side hook: opens an SSE channel for a session id and reports when the
// phone has beamed a scan up. EventSource handles reconnection natively, so on a
// dropped connection the browser reconnects and the server replays scan-ready
// for any already-uploaded scan.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type ScanSyncStatus = 'connecting' | 'waiting' | 'received';
export type ScanSyncInfo = { size: number; ts: number };

export type UseScanSync = {
  status: ScanSyncStatus;
  scanInfo: ScanSyncInfo | null;
  fetchScan: () => Promise<ArrayBuffer>;
  mobileUrl: string;
};

export function useScanSync(sessionId: string): UseScanSync {
  const [status, setStatus] = useState<ScanSyncStatus>('connecting');
  const [scanInfo, setScanInfo] = useState<ScanSyncInfo | null>(null);

  // Keep the id in a ref so fetchScan stays stable even if the id changes.
  const idRef = useRef(sessionId);
  idRef.current = sessionId;

  useEffect(() => {
    if (!sessionId) return;

    setStatus('connecting');
    setScanInfo(null);

    const es = new EventSource(`/api/scan/${sessionId}/events`);

    es.addEventListener('open', () => {
      // Only advance to "waiting" while we haven't received a scan yet; a
      // reconnect after receipt shouldn't visually regress the UI.
      setStatus((s) => (s === 'received' ? s : 'waiting'));
    });

    es.addEventListener('hello', () => {
      setStatus((s) => (s === 'received' ? s : 'waiting'));
    });

    es.addEventListener('scan-ready', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          size: number;
          ts: number;
        };
        setScanInfo({ size: data.size, ts: data.ts });
        setStatus('received');
      } catch {
        // Ignore malformed frames; the next one (or a refetch) will recover.
      }
    });

    es.addEventListener('error', () => {
      // EventSource auto-reconnects. Reflect the drop only if we're still
      // waiting, so a post-receipt blip doesn't clobber the success state.
      setStatus((s) => (s === 'received' ? s : 'connecting'));
    });

    return () => es.close();
  }, [sessionId]);

  const fetchScan = useCallback(async (): Promise<ArrayBuffer> => {
    const res = await fetch(`/api/scan/${idRef.current}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`fetchScan failed: ${res.status}`);
    }
    return res.arrayBuffer();
  }, []);

  const mobileUrl = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    return `${base}/m/${sessionId}`;
  }, [sessionId]);

  return { status, scanInfo, fetchScan, mobileUrl };
}
