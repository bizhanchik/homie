'use client';

// Dev harness for the sim pipeline (grid -> A* -> robot -> replan). A mini-Studio
// that wires RoomViewer to useHomieAgent and exercises the full loop:
//   Load sample room -> mock labels -> Run task -> robot paths to table then door
//   -> drop an obstacle mid-run -> robot halts, replans, detours, finishes.
//
// RoomViewer is imported directly: this page is already a Client Component and the
// viewer guards every WebGL call inside effects, so the ref resolves synchronously.
import { useCallback, useEffect, useRef, useState } from 'react';
import RoomViewer, { type RoomViewerHandle } from '@/components/RoomViewer';
import PlanPanel from '@/components/PlanPanel';
import { useHomieAgent } from '@/sim/use-homie-agent';
import type { Vec2 } from '@/lib/types';

const DEFAULT_TASK = 'Go to the table, then go to the door';

export default function DevSimPage() {
  const viewerRef = useRef<RoomViewerHandle>(null);
  const agent = useHomieAgent();
  const { attachViewer, setDebugFailReplan } = agent;

  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [obstacleMode, setObstacleMode] = useState(false);
  const [failReplan, setFailReplan] = useState(false);
  const [task, setTask] = useState(DEFAULT_TASK);
  const [note, setNote] = useState('starting…');

  // Attach the viewer handle to the agent as soon as it exists.
  useEffect(() => {
    if (ready && viewerRef.current) attachViewer(viewerRef.current);
  }, [ready, attachViewer]);

  const onReady = useCallback(() => {
    setReady(true);
    if (viewerRef.current) attachViewer(viewerRef.current);
  }, [attachViewer]);

  // Dev-only introspection handle for the browser QA harness.
  useEffect(() => {
    (window as unknown as { __homie?: unknown }).__homie = {
      agent,
      viewer: viewerRef.current,
    };
  });

  const loadSampleRoom = useCallback(async () => {
    setNote('fetching /sample-room.glb…');
    try {
      const res = await fetch('/sample-room.glb');
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      await agent.loadRoom(buf);
      setLoaded(true);
      setNote(`room loaded (${(buf.byteLength / 1024).toFixed(1)} KB)`);
    } catch (e) {
      setNote(`load error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [agent]);

  const onObstacleAdded = useCallback(
    (at: Vec2) => {
      agent.addObstacle(at);
    },
    [agent],
  );

  const runTask = useCallback(() => {
    void agent.runTask(task);
  }, [agent, task]);

  // Debug: force the replan API to fail so the pure-A* local fallback runs.
  const toggleFailReplan = useCallback(() => {
    setFailReplan((on) => {
      const next = !on;
      setDebugFailReplan(next);
      return next;
    });
  }, [setDebugFailReplan]);

  // Debug: deterministically drop an obstacle mid-corridor (no aiming needed) to
  // force a replan. Placed at the midpoint between the first and last move
  // waypoints so it sits ON the route but does NOT engulf either goal (the
  // occupancy dilation is ~0.75m, so an obstacle hugging a waypoint would wall
  // it off). Drop it while the robot is on the leg that crosses this point.
  const blockAhead = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const first = agent.plan?.steps.find((s) => s.waypoint)?.waypoint;
    // Drop it just short of the first waypoint (open centre of the room) and
    // offset ~0.45m off the centreline: the box covers the route but leaves one
    // side of the corridor clearly open — a passable "walk around it" obstacle
    // in open space, not the tight doorway gap which no reroute can squeeze.
    const at: Vec2 = first
      ? { x: first.x + 0.45, z: first.z + 0.5 }
      : { x: 0.45, z: 0.5 };
    v.addObstacle(at); // red box (viewer)
    agent.addObstacle(at); // occupancy grid
    setNote(`blocked path at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`);
  }, [agent]);

  const btn =
    'rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:text-neutral-200';

  const step =
    agent.plan &&
    agent.currentStepIndex >= 0 &&
    agent.currentStepIndex < agent.plan.steps.length
      ? agent.plan.steps[agent.currentStepIndex]
      : null;

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <h1 className="mr-3 text-sm font-semibold tracking-tight text-emerald-400">
          Homie sim dev harness
        </h1>
        <button className={btn} onClick={loadSampleRoom} disabled={!ready}>
          Load sample room
        </button>
        <button
          className={`${btn} ${obstacleMode ? 'border-emerald-500 text-emerald-300' : ''}`}
          onClick={() => setObstacleMode((m) => !m)}
          disabled={!loaded}
        >
          Obstacle mode: {obstacleMode ? 'ON' : 'off'}
        </button>
        <button className={btn} onClick={() => agent.reset()} disabled={!loaded}>
          Reset
        </button>
        <button className={btn} onClick={blockAhead} disabled={!loaded}>
          Block path ahead
        </button>
        <button
          className={`${btn} ${failReplan ? 'border-amber-500 text-amber-300' : ''}`}
          onClick={toggleFailReplan}
          disabled={!loaded}
          title="Force /api/plan replan to fail → pure-A* local fallback"
        >
          Fail replan API: {failReplan ? 'ON' : 'off'}
        </button>
        <div className="mx-2 h-5 w-px bg-neutral-800" />
        <input
          className="w-72 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Task…"
        />
        <button
          className={`${btn} border-emerald-600 text-emerald-300`}
          onClick={runTask}
          disabled={!loaded}
        >
          Run
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <RoomViewer
          ref={viewerRef}
          className="min-h-0 flex-1"
          onReady={onReady}
          obstacleMode={obstacleMode}
          onObstacleAdded={onObstacleAdded}
        />

        <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-auto border-l border-neutral-800 p-4 text-xs">
          <section className="space-y-1">
            <div className="font-semibold text-neutral-400">STATUS</div>
            <div>
              state:{' '}
              <span
                className={
                  agent.state === 'error'
                    ? 'text-red-400'
                    : agent.state === 'done'
                      ? 'text-emerald-400'
                      : 'text-emerald-300'
                }
              >
                {agent.state}
              </span>
            </div>
            <div className="text-neutral-400">
              step:{' '}
              {step
                ? `#${agent.currentStepIndex} ${step.action}${step.target ? ` → ${step.target}` : ''}`
                : '—'}
            </div>
            <div className="text-neutral-500">
              idx: {agent.currentStepIndex}
              {agent.plan ? ` / ${agent.plan.steps.length} steps` : ''}
            </div>
            <div className="text-neutral-600">{note}</div>
            {agent.error && <div className="text-red-400">error: {agent.error}</div>}
          </section>

          <section className="max-h-72 shrink-0 overflow-hidden rounded border border-neutral-800">
            <PlanPanel plan={agent.plan} currentStepIndex={agent.currentStepIndex} />
          </section>

          <section className="space-y-1">
            <div className="font-semibold text-neutral-400">
              NARRATION ({agent.narration.length})
            </div>
            <ol className="space-y-1">
              {agent.narration.map((n, i) => (
                <li
                  key={`${n.at}-${i}`}
                  className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-neutral-200"
                >
                  {n.text}
                </li>
              ))}
              {agent.narration.length === 0 && (
                <li className="text-neutral-600">no narration yet</li>
              )}
            </ol>
          </section>

          <section className="text-neutral-600">
            Tip: click <span className="text-emerald-400">Load sample room</span>,
            then <span className="text-emerald-400">Run</span>. Mid-run, toggle{' '}
            <span className="text-emerald-400">Obstacle mode</span> and click the
            floor on the robot&apos;s path to force a replan.
          </section>
        </aside>
      </div>
    </div>
  );
}
