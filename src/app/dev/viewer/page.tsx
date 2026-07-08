'use client';

// Dev harness / smoke test for RoomViewer. Not part of the product surface —
// it exercises the full imperative-handle contract in isolation so the viewer
// can be verified before the studio UI is wired up.
//
// RoomViewer is imported directly (this page is already a Client Component, and
// the viewer guards every browser/WebGL call inside effects) so the forwarded
// ref resolves synchronously for the buttons below.

import { useCallback, useRef, useState } from 'react';
import RoomViewer, { type RoomViewerHandle } from '@/components/RoomViewer';
import type { SceneObject, Vec2, Bounds } from '@/lib/types';

const FAKE_LABELS: SceneObject[] = [
  {
    id: 'table',
    name: 'Table',
    position: { x: 0, z: 0 },
    size: { w: 1.2, d: 0.8 },
    kind: 'furniture',
  },
  {
    id: 'sofa',
    name: 'Sofa',
    position: { x: 0, z: -1.5 },
    size: { w: 2.0, d: 0.9 },
    kind: 'furniture',
  },
];

// A fake L-shaped path across the sample room (6m x 4m, centered at origin).
const FAKE_PATH: Vec2[] = [
  { x: -2, z: 1.5 },
  { x: -2, z: -1 },
  { x: 2, z: -1 },
];

const ROBOT_SPEED = 1.2; // m/s

export default function DevViewerPage() {
  const viewerRef = useRef<RoomViewerHandle>(null);
  const rafRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [obstacleMode, setObstacleMode] = useState(false);
  const [floorY, setFloorY] = useState<number | null>(null);
  const [robotKind, setRobotKind] = useState<'capsule' | 'glb' | null>(null);
  const [obstacleCount, setObstacleCount] = useState(0);
  const [lastClick, setLastClick] = useState<Vec2 | null>(null);
  const [topDown, setTopDown] = useState<{ url: string; bounds: Bounds } | null>(null);
  const [status, setStatus] = useState('starting…');

  const loadRoom = useCallback(async () => {
    const v = viewerRef.current;
    if (!v) return;
    setStatus('fetching /sample-room.glb…');
    try {
      const res = await fetch('/sample-room.glb');
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      await v.loadGlb(buf);
      setLoaded(true);
      setFloorY(v.getFloorY());
      setRobotKind(v.getRobotModelKind());
      setStatus(`loaded (${(buf.byteLength / 1024).toFixed(1)} KB)`);
    } catch (err) {
      setStatus(`load error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onReady = useCallback(() => {
    setReady(true);
    setStatus('viewer ready');
    void loadRoom();
  }, [loadRoom]);

  const onFloorClick = useCallback((at: Vec2) => {
    setLastClick(at);
  }, []);

  const onObstacleAdded = useCallback(() => {
    const v = viewerRef.current;
    if (v) setObstacleCount(v.getObstacles().length);
  }, []);

  const stopAnim = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const animateRobot = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    stopAnim();
    v.setPath(FAKE_PATH);

    // Precompute segment lengths for constant-speed arc-length traversal.
    const segs = FAKE_PATH.slice(1).map((p, i) => {
      const a = FAKE_PATH[i];
      const dx = p.x - a.x;
      const dz = p.z - a.z;
      return { a, b: p, dx, dz, len: Math.hypot(dx, dz) };
    });
    const total = segs.reduce((s, seg) => s + seg.len, 0);
    const start = performance.now();

    const tick = (now: number) => {
      const dist = Math.min(((now - start) / 1000) * ROBOT_SPEED, total);
      let d = dist;
      let seg = segs[segs.length - 1];
      for (const s of segs) {
        if (d <= s.len) {
          seg = s;
          break;
        }
        d -= s.len;
      }
      const f = seg.len > 0 ? d / seg.len : 0;
      const pos: Vec2 = { x: seg.a.x + seg.dx * f, z: seg.a.z + seg.dz * f };
      const headingRad = Math.atan2(seg.dz, seg.dx);
      v.setRobotPose({ position: pos, headingRad });
      if (dist < total) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopAnim]);

  const doTopDown = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const { imageDataUrl, bounds } = v.renderTopDown();
    setTopDown({ url: imageDataUrl, bounds });
  }, []);

  const toggleObstacleMode = useCallback(() => {
    setObstacleMode((m) => !m);
  }, []);

  const btn =
    'rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:text-neutral-200';

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <h1 className="mr-3 text-sm font-semibold tracking-tight text-emerald-400">
          RoomViewer dev harness
        </h1>
        <button className={btn} onClick={loadRoom} disabled={!ready}>
          Reload room
        </button>
        <button
          className={`${btn} ${obstacleMode ? 'border-emerald-500 text-emerald-300' : ''}`}
          onClick={toggleObstacleMode}
          disabled={!loaded}
        >
          Obstacle mode: {obstacleMode ? 'ON' : 'off'}
        </button>
        <button className={btn} onClick={() => viewerRef.current?.setLabels(FAKE_LABELS)} disabled={!loaded}>
          Set labels
        </button>
        <button className={btn} onClick={() => viewerRef.current?.setLabels([])} disabled={!loaded}>
          Clear labels
        </button>
        <button className={btn} onClick={() => viewerRef.current?.setPath(FAKE_PATH)} disabled={!loaded}>
          Set path
        </button>
        <button className={btn} onClick={animateRobot} disabled={!loaded}>
          Animate robot
        </button>
        <button className={btn} onClick={stopAnim} disabled={!loaded}>
          Stop
        </button>
        <button className={btn} onClick={doTopDown} disabled={!loaded}>
          Render top-down
        </button>
        <button
          className={btn}
          onClick={() => {
            stopAnim();
            viewerRef.current?.clearScene();
            setLoaded(false);
            setTopDown(null);
            setObstacleCount(0);
            setLastClick(null);
            setRobotKind(null);
          }}
          disabled={!loaded}
        >
          Clear scene
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <RoomViewer
          ref={viewerRef}
          className="min-h-0 flex-1"
          onReady={onReady}
          onFloorClick={onFloorClick}
          obstacleMode={obstacleMode}
          onObstacleAdded={onObstacleAdded}
        />

        <aside className="w-80 shrink-0 space-y-4 overflow-auto border-l border-neutral-800 p-4 text-xs">
          <section className="space-y-1">
            <div className="font-semibold text-neutral-400">STATUS</div>
            <div className="text-neutral-200">{status}</div>
            <div className="text-neutral-500">
              ready: {String(ready)} · loaded: {String(loaded)}
            </div>
            <div className="text-neutral-500">
              floorY: {floorY === null ? '—' : floorY.toFixed(3)}
            </div>
            <div className="text-neutral-500">
              robot model:{' '}
              <span className={robotKind === 'glb' ? 'text-emerald-400' : 'text-neutral-300'}>
                {robotKind ?? '—'}
              </span>
            </div>
            <div className="text-neutral-500">obstacles: {obstacleCount}</div>
            <div className="text-neutral-500">
              last floor click:{' '}
              {lastClick ? `(${lastClick.x.toFixed(2)}, ${lastClick.z.toFixed(2)})` : '—'}
            </div>
          </section>

          <section className="space-y-2">
            <div className="font-semibold text-neutral-400">TOP-DOWN CAPTURE</div>
            {topDown ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={topDown.url}
                  alt="top-down render"
                  className="w-full rounded border border-neutral-800 bg-black"
                />
                <pre className="overflow-auto rounded bg-neutral-900 p-2 text-[10px] text-emerald-300">
                  {JSON.stringify(topDown.bounds, null, 2)}
                </pre>
              </>
            ) : (
              <div className="text-neutral-600">no capture yet</div>
            )}
          </section>

          <section className="text-neutral-600">
            Tip: toggle obstacle mode, then click the floor to drop red boxes.
            Plain clicks (no drag) fire onFloorClick.
          </section>
        </aside>
      </div>
    </div>
  );
}
