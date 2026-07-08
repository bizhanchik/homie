'use client';

// useHomieAgent — the integration surface between the Studio UI and the sim.
// Owns the AgentState machine (via useReducer) plus the imperative THREE / grid /
// robot pipeline (kept in refs, all browser work inside callbacks -> SSR-safe).
//
//   idle -> awaiting_scan -> (loadRoom) labeling -> scene_ready
//        -> (runTask) planning -> executing -> done
//   executing -> blocked -> replanning -> executing
//   any -> error (message in `error`; recovers on the next action)
import { useCallback, useReducer, useRef } from 'react';
import type * as THREE from 'three';
import type { RoomViewerHandle } from '@/components/RoomViewer';
import type {
  AgentState,
  Bounds,
  NarrationEvent,
  Plan,
  PlanStep,
  RunRecord,
  SceneModel,
  Vec2,
  ApiResult,
} from '@/lib/types';
import { buildGrid, type OccupancyGrid } from './grid';
import { findPath } from './astar';
import { RobotDriver } from './robot';

export type AgentAPI = {
  state: AgentState;
  scene: SceneModel | null;
  plan: Plan | null;
  currentStepIndex: number; // -1 when none
  narration: NarrationEvent[]; // append-only
  error: string | null;
  history: RunRecord[];
  isReplaying: boolean;
  attachViewer(h: RoomViewerHandle): void;
  loadRoom(glb: ArrayBuffer): Promise<void>;
  runTask(task: string): Promise<void>;
  replayRun(record: RunRecord): void;
  addObstacle(at: Vec2, viewerAssignedId?: string): string; // returns obstacle id
  removeObstacle(id: string): void;
  reset(): void;
  /**
   * Debug-only (dev harness): when on, the next replan short-circuits its API
   * call to a failure so the pure-A* local-fallback reroute is exercised. Not
   * used by the Studio UI; safe to ignore.
   */
  setDebugFailReplan(on: boolean): void;
  setVisionMode(mode: 'gpt4o' | 'sam2'): void;
  teleportRobot(pos: Vec2): void;
  moveObject(id: string, newPos: Vec2): void;
};

type AgentReducerState = {
  state: AgentState;
  scene: SceneModel | null;
  plan: Plan | null;
  currentStepIndex: number;
  narration: NarrationEvent[];
  error: string | null;
  history: RunRecord[];
  isReplaying: boolean;
};

type Action =
  | { type: 'setState'; state: AgentState }
  | { type: 'setScene'; scene: SceneModel | null; state: AgentState }
  | { type: 'setPlan'; plan: Plan | null }
  | { type: 'setStep'; index: number }
  | { type: 'narrate'; event: NarrationEvent }
  | { type: 'error'; error: string }
  | { type: 'addHistory'; record: RunRecord }
  | { type: 'setReplaying'; isReplaying: boolean }
  | { type: 'reset' };

const initialState: AgentReducerState = {
  state: 'awaiting_scan',
  scene: null,
  plan: null,
  currentStepIndex: -1,
  narration: [],
  error: null,
  history: [],
  isReplaying: false,
};

function reducer(s: AgentReducerState, a: Action): AgentReducerState {
  switch (a.type) {
    case 'setState':
      return { ...s, state: a.state, error: a.state === 'error' ? s.error : null };
    case 'setScene':
      return { ...s, scene: a.scene, state: a.state, error: null };
    case 'setPlan':
      return { ...s, plan: a.plan };
    case 'setStep':
      return { ...s, currentStepIndex: a.index };
    case 'narrate':
      return { ...s, narration: [...s.narration, a.event] };
    case 'error':
      return { ...s, state: 'error', error: a.error };
    case 'addHistory':
      return { ...s, history: [a.record, ...s.history].slice(0, 20) };
    case 'setReplaying':
      return { ...s, isReplaying: a.isReplaying };
    case 'reset':
      return {
        ...s,
        state: s.scene ? 'scene_ready' : 'awaiting_scan',
        plan: null,
        currentStepIndex: -1,
        narration: [],
        error: null,
      };
    default:
      return s;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function minimalScene(bounds: Bounds): SceneModel {
  return { bounds, objects: [], walkableZones: [] };
}

// Minimum on-screen dwell (ms) for the transient beats so judges can read the
// "Obstacle! / Replanning…" ribbon. These gate the REPORTED state transitions,
// never the API call itself (that runs concurrently underneath).
const MIN_BLOCKED_MS = 900;
const MIN_REPLAN_MS = 900;
// Bounded replans per run: enough for several genuine obstacles, but caps a
// pathological loop (target walled off) so the demo can never hang on screen.
const MAX_REPLANS = 8;

// Join names into a short, natural, spoken list: "a", "a and b", "a, b, and c".
// Caps at 4 items so narration stays snappy.
function listPhrase(names: string[]): string {
  const xs = names.slice(0, 4);
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}

type BlockOutcome =
  | { type: 'done' }
  | { type: 'cancelled' }
  | {
      type: 'blocked';
      pos: Vec2;
      currentStep: PlanStep;
      remainingAfter: PlanStep[];
      completedNow: PlanStep[];
    };

export function useHomieAgent(opts?: {
  onNarration?: (e: NarrationEvent) => void;
}): AgentAPI {
  const [rs, dispatch] = useReducer(reducer, initialState);

  // Imperative state (never triggers re-render; read live by async flows).
  const viewerRef = useRef<RoomViewerHandle | null>(null);
  const gridRef = useRef<OccupancyGrid | null>(null);
  const driverRef = useRef<RobotDriver | null>(null);
  const sceneRef = useRef<SceneModel | null>(null);
  const boundsRef = useRef<Bounds>({ minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
  const floorYRef = useRef<number>(0);
  // Track manually-placed obstacle positions keyed by viewer id so we can
  // rebuild the grid when one is removed.
  const manualObstaclesRef = useRef<Map<string, Vec2>>(new Map());

  // Live trail: positions sampled every ~100ms while the robot is moving.
  // Stored in a ref (not state) because it updates every frame.
  const currentTrailRef = useRef<Vec2[]>([]);
  const lastTrailUpdateRef = useRef<number>(0);
  const taskRef = useRef<string>('');
  const cancelledRef = useRef<boolean>(false);
  // Monotonic run token: a fresh runTask (or reset) bumps this so any older
  // async flow still in flight can detect it has been superseded and bail
  // cleanly — no double-drive, no dangling loop.
  const runIdRef = useRef<number>(0);
  // Debug-only (harness): when true, the replan API path is short-circuited to a
  // failure so the pure-A* local fallback is exercised. Never toggled in prod.
  const debugFailReplanRef = useRef<boolean>(false);
  const labelEndpointRef = useRef<string>('/api/label');
  const onNarrationRef = useRef(opts?.onNarration);
  onNarrationRef.current = opts?.onNarration;

  const narrate = useCallback((text: string) => {
    const event: NarrationEvent = { at: Date.now(), text };
    dispatch({ type: 'narrate', event });
    onNarrationRef.current?.(event);
  }, []);

  const attachViewer = useCallback((h: RoomViewerHandle) => {
    viewerRef.current = h;
  }, []);

  // --- loadRoom ------------------------------------------------------------
  const loadRoom = useCallback(
    async (glb: ArrayBuffer): Promise<void> => {
      const v = viewerRef.current;
      if (!v) {
        dispatch({ type: 'error', error: 'viewer not attached' });
        return;
      }
      dispatch({ type: 'setState', state: 'labeling' });
      let bounds: Bounds;
      try {
        await v.loadGlb(glb);
        const root = v.getRoomRoot() as THREE.Object3D | null;
        const floorY = v.getFloorY();
        const td = v.renderTopDown();
        bounds = td.bounds;
        boundsRef.current = bounds;
        floorYRef.current = floorY;

        const t0 = performance.now();
        const grid = root ? buildGrid(root, bounds, floorY) : null;
        const t1 = performance.now();
        gridRef.current = grid;
        if (grid) {
          const blockedCount = grid.blocked.reduce((n, b) => n + b, 0);
          // eslint-disable-next-line no-console
          console.log(
            `[homie] grid built: ${grid.cols}x${grid.rows} (${grid.cols * grid.rows} cells), ` +
              `${blockedCount} blocked, in ${(t1 - t0).toFixed(1)}ms`,
          );
        }

        // Seed the robot at a free cell near the room's centre-south.
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cz = (bounds.minZ + bounds.maxZ) / 2;
        const southZ = cz + (bounds.maxZ - cz) * 0.5;
        const seed: Vec2 = { x: cx, z: southZ };
        const startPos = grid ? grid.nearestFree(seed, 3) ?? seed : seed;
        driverRef.current = new RobotDriver(v, startPos, -Math.PI / 2);
      } catch (e) {
        dispatch({
          type: 'error',
          error: `room load failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }

      // Label API — never hard-fail the demo if vision is down.
      try {
        // Single top-down image: one coordinate space, no per-tile offset math,
        // no multi-tile duplicates. The full-room render is 2048px square so
        // fine detail is preserved; tiles were causing same-object duplication.
        const td2 = v.renderTopDown();
        const res = await fetch(labelEndpointRef.current, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bounds, images: [{ imageDataUrl: td2.imageDataUrl, bounds: td2.bounds }] }),
        });
        const data = (await res.json()) as ApiResult<SceneModel>;
        if (data.ok) {
          sceneRef.current = data.data;
          v.setLabels(data.data.objects);
          // Stamp real furniture footprints onto the grid now that we have
          // them. Load-bearing in permissive-fallback mode (a messy real scan
          // where per-cell geometry occupancy proved unreliable and the grid
          // fell back to "everywhere walkable except a thin margin") — this is
          // what actually gives the robot something to navigate AROUND,
          // sourced from the vision labels we trust rather than the raycast
          // heuristic that just failed. Harmless in normal geometry mode too
          // (those cells are typically already blocked there).
          for (const obj of data.data.objects) {
            if (obj.kind === 'furniture') {
              // Cap the stamped footprint — real-scan vision labeling can
              // overestimate an object's real-world size (seen: a "desk"
              // reported at 2.56m wide), and addObstacleFootprint already adds
              // a robot-radius dilation on top. Uncapped, a single oversized
              // label can blow a ~1.8m no-go halo around it, which swallows
              // every reasonable "go near this object" approach radius and
              // makes every task targeting it silently un-pathable.
              const size = Math.min(Math.max(obj.size.w, obj.size.d), 1.0);
              gridRef.current?.addObstacleFootprint(obj.position, size);
            }
          }
          // The robot was seeded before these stamps existed — if a footprint
          // now covers its start position, nudge it to the nearest free cell.
          const driver = driverRef.current;
          const grid = gridRef.current;
          if (driver && grid && grid.isBlockedWorld(driver.position)) {
            const safe = grid.nearestFree(driver.position, 1.5);
            if (safe) driver.setPose(safe);
          }
          dispatch({ type: 'setScene', scene: data.data, state: 'scene_ready' });
          const names = data.data.objects.map((o) => o.name);
          narrate(
            names.length
              ? `Scan complete — I can see the ${listPhrase(names)}.`
              : 'Scan complete — the room looks clear.',
          );
        } else {
          sceneRef.current = null;
          narrate("My eyes are fuzzy right now — I'll navigate by feel.");
          dispatch({ type: 'setScene', scene: null, state: 'scene_ready' });
        }
      } catch {
        sceneRef.current = null;
        narrate("My eyes are fuzzy right now — I'll navigate by feel.");
        dispatch({ type: 'setScene', scene: null, state: 'scene_ready' });
      }
    },
    [narrate],
  );

  // --- step execution ------------------------------------------------------

  // BFS from `from` through free cells; returns a path to the reachable cell
  // that is closest (in world distance) to `target`. Capped at 4000 cells so
  // it stays under 1ms even on a dense Scaniverse grid. Returns null only if
  // the robot's start position itself is in a blocked cell.
  function bestEffortPath(grid: OccupancyGrid, from: Vec2, target: Vec2): Vec2[] | null {
    const { c: fc, r: fr } = grid.worldToCell(from);
    if (grid.blocked[fr * grid.cols + fc]) return null;

    const { c: tc, r: tr } = grid.worldToCell(target);
    const visited = new Uint8Array(grid.cols * grid.rows);
    const queue: [number, number][] = [[fc, fr]];
    visited[fr * grid.cols + fc] = 1;

    let bestC = fc, bestR = fr;
    let bestDist = Math.hypot(fc - tc, fr - tr);
    let explored = 0;

    while (queue.length > 0 && explored < 4000) {
      const [c, r] = queue.shift()!;
      explored++;
      const d = Math.hypot(c - tc, r - tr);
      if (d < bestDist) { bestDist = d; bestC = c; bestR = r; }
      if (bestDist < 2) break; // close enough, stop early

      for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
        const idx = nr * grid.cols + nc;
        if (visited[idx] || grid.blocked[idx]) continue;
        visited[idx] = 1;
        queue.push([nc, nr]);
      }
    }

    const closest = grid.cellToWorld(bestC, bestR);
    return findPath(grid, from, closest) ?? [from, closest];
  }

  const execMoveStep = useCallback(
    async (step: PlanStep): Promise<DriveResultLike> => {
      const v = viewerRef.current;
      const grid = gridRef.current;
      const driver = driverRef.current;
      if (!v || !driver || !step.waypoint) return 'arrived';

      const from = driver.position;
      let path: Vec2[];
      if (grid) {
        // Try increasingly wide approach radii around the target. Furniture
        // stamps + robot dilation can block the exact waypoint, so we search
        // outward until A* finds a connected route.
        let routed: Vec2[] | null = null;
        for (const r of [0.45, 0.8, 1.4, 2.5, 4.0]) {
          const candidate = grid.nearestFree(step.waypoint, r);
          if (candidate) {
            routed = findPath(grid, from, candidate);
            if (routed) break;
          }
        }
        if (!routed) {
          // All radii failed — find the closest cell that IS reachable from
          // the robot's position (BFS, capped at 4000 cells ≈ full room) and
          // drive as close as we can get.
          routed = bestEffortPath(grid, from, step.waypoint);
        }
        if (!routed) {
          narrate(`Can't reach that position — moving on`);
          v.setPath([]);
          return 'arrived';
        }
        path = routed;
      } else {
        path = [from, step.waypoint];
      }

      v.setPath(path);

      const validate = (): boolean => {
        const g = gridRef.current;
        if (!g) return true;
        const pos = driver.position;
        // Check the corridor AHEAD: nearest path vertex through the end.
        let bi = 0;
        let bd = Infinity;
        for (let i = 0; i < path.length; i++) {
          const d = Math.hypot(path[i].x - pos.x, path[i].z - pos.z);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        const ahead: Vec2[] = [pos, ...path.slice(bi)];
        const stepLen = g.cell * 0.75;
        for (let i = 0; i + 1 < ahead.length; i++) {
          const a = ahead[i];
          const b = ahead[i + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const n = Math.max(1, Math.ceil(len / stepLen));
          for (let k = 0; k <= n; k++) {
            const f = k / n;
            if (g.isBlockedWorld({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f })) {
              return false;
            }
          }
        }
        return true;
      };

      const progressFn = (pos: Vec2): void => {
        const now = performance.now();
        if (now - lastTrailUpdateRef.current > 80) {
          currentTrailRef.current.push({ ...pos });
          lastTrailUpdateRef.current = now;
          if (currentTrailRef.current.length % 5 === 0) {
            viewerRef.current?.setTrail(currentTrailRef.current);
          }
        }
      };

      const result = await driver.drive(path, { speed: 0.8, validate, onProgress: progressFn });

      // When blocked, back up so the robot visually retreats before replanning
      // instead of freezing in place. Rotate 180° and reverse ~0.35 m.
      if (result === 'blocked') {
        const backHeading = driver.headingRad + Math.PI;
        const backTarget = {
          x: driver.position.x + Math.cos(backHeading) * 0.35,
          z: driver.position.z + Math.sin(backHeading) * 0.35,
        };
        const freeBack = grid?.nearestFree(backTarget, 0.8) ?? backTarget;
        v.setPath([freeBack]);
        await driver.drive([freeBack], { speed: 1.2, onProgress: progressFn });
        v.setPath([]);
      }

      return result;
    },
    [],
  );

  // Run a sequence of steps; return the outcome (done / cancelled / blocked).
  // `cancelled()` returns true once this run has been superseded (new runTask)
  // or reset — every checkpoint bails on it so no stale loop keeps driving.
  const execSequence = useCallback(
    async (
      steps: PlanStep[],
      base: number,
      completedIn: PlanStep[],
      cancelled: () => boolean,
    ): Promise<BlockOutcome> => {
      const completed = [...completedIn];
      const driver = driverRef.current;
      for (let i = 0; i < steps.length; i++) {
        if (cancelled()) return { type: 'cancelled' };
        const step = steps[i];
        dispatch({ type: 'setStep', index: base + i });
        narrate(step.note);

        if (step.action === 'move' && step.waypoint) {
          const result = await execMoveStep(step);
          if (cancelled() || result === 'cancelled') {
            return { type: 'cancelled' };
          }
          if (result === 'blocked') {
            return {
              type: 'blocked',
              pos: driver ? driver.position : step.waypoint,
              currentStep: step,
              remainingAfter: steps.slice(i + 1),
              completedNow: completed,
            };
          }
        } else {
          // 'turn' / 'interact' — a brief beat so the narration lands.
          await sleep(600);
          if (cancelled()) return { type: 'cancelled' };
        }
        completed.push(step);
      }
      return { type: 'done' };
    },
    [execMoveStep, narrate],
  );

  // --- blocked -> replan ---------------------------------------------------
  const replan = useCallback(
    async (
      o: Extract<BlockOutcome, { type: 'blocked' }>,
      cancelled: () => boolean,
    ): Promise<PlanStep[]> => {
      // Kick the network work off immediately so the min-dwell timers overlap
      // the (mock ~700ms) API latency instead of adding to it. Coords stay in
      // the on-screen log only — never in speech.
      dispatch({ type: 'setState', state: 'blocked' });
      narrate('Whoa — something new in my path. Rerouting.');

      const scene = sceneRef.current ?? minimalScene(boundsRef.current);
      const fetchReplan = (async (): Promise<PlanStep[] | null> => {
        try {
          // Debug hook (harness-only): force the replan API to fail so the
          // pure-A* local-fallback branch is exercised. Never set in prod UI.
          if (debugFailReplanRef.current) throw new Error('debug: forced replan 500');
          const res = await fetch('/api/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scene,
              task: taskRef.current,
              mode: 'replan',
              context: {
                completedSteps: o.completedNow,
                blockedAt: o.pos,
                remainingTask: taskRef.current,
              },
            }),
          });
          const data = (await res.json()) as ApiResult<Plan>;
          if (data.ok && data.data.steps.length > 0) return data.data.steps;
          return null;
        } catch {
          return null;
        }
      })();

      // Beat 1: hold "blocked" on screen so the obstacle moment reads.
      await sleep(MIN_BLOCKED_MS);
      if (cancelled()) return o.remainingAfter;

      // Beat 2: show "replanning" for at least MIN_REPLAN_MS, but no longer than
      // the API needs beyond that.
      dispatch({ type: 'setState', state: 'replanning' });
      const [steps] = await Promise.all([fetchReplan, sleep(MIN_REPLAN_MS)]);
      if (cancelled()) return o.remainingAfter;
      if (steps) return steps;

      // Local fallback (never-dead-end guarantee). Re-targeting the SAME forward
      // waypoint dead-ends: A* from the robot's near-obstacle stop heads back
      // into the freshly-blocked corridor and validate() re-blocks instantly,
      // looping forever. Instead — like the server replan — sidestep to the
      // roomier side of the block FIRST (a lateral move clears the forward
      // obstacle), then resume the original target; the grid now carries the
      // obstacle so A* routes cleanly around it from there.
      narrate("Planner's offline — I'll route around it myself.");
      const grid = gridRef.current;
      const fwd = o.currentStep.waypoint ?? o.pos;
      const dx = fwd.x - o.pos.x;
      const dz = fwd.z - o.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      const DETOUR = 1.2; // metres to the side, matches the server replan
      const sides: Vec2[] = [
        { x: -uz, z: ux }, // left of travel
        { x: uz, z: -ux }, // right of travel
      ];
      // Prefer the side whose detour point is free (roomier); fall back to left.
      const pick = (): Vec2 => {
        if (!grid) return { x: o.pos.x + sides[0].x * DETOUR, z: o.pos.z + sides[0].z * DETOUR };
        for (const s of sides) {
          const cand = { x: o.pos.x + s.x * DETOUR, z: o.pos.z + s.z * DETOUR };
          if (!grid.isBlockedWorld(cand)) return grid.nearestFree(cand, 0.8) ?? cand;
        }
        const c0 = { x: o.pos.x + sides[0].x * DETOUR, z: o.pos.z + sides[0].z * DETOUR };
        return grid.nearestFree(c0, 1.2) ?? c0;
      };
      const detour: PlanStep = {
        action: 'move',
        target: o.currentStep.target,
        waypoint: pick(),
        note: 'Sidestepping around it.',
      };
      const resume: PlanStep = {
        action: 'move',
        target: o.currentStep.target,
        waypoint: o.currentStep.waypoint,
        note: 'Back on track.',
      };
      return [detour, resume, ...o.remainingAfter];
    },
    [narrate],
  );

  const runPlan = useCallback(
    async (
      initialSteps: PlanStep[],
      task: string,
      cancelled: () => boolean,
    ): Promise<void> => {
      let steps = initialSteps;
      let completed: PlanStep[] = [];
      let base = 0;
      let replans = 0;
      for (;;) {
        const outcome = await execSequence(steps, base, completed, cancelled);
        if (outcome.type === 'cancelled') return;
        if (outcome.type === 'done') {
          // Park the cursor PAST the last step so every row renders as ✓ done
          // (index -1 would make a finished plan look all-pending).
          dispatch({ type: 'setStep', index: base + steps.length });
          dispatch({ type: 'setState', state: 'done' });
          narrate("Done! What's next?");
          return;
        }
        // Never-dead-end safety: if a target is genuinely walled off, bounded
        // replans stop us looping forever on screen. Finish gracefully instead.
        if (replans >= MAX_REPLANS) {
          dispatch({ type: 'setStep', index: -1 });
          dispatch({ type: 'setState', state: 'done' });
          narrate("That way's fully blocked — I'll stop here for now.");
          return;
        }
        replans++;
        // blocked -> replan -> resume
        const newSteps = await replan(outcome, cancelled);
        if (cancelled()) return;
        completed = outcome.completedNow;
        steps = newSteps;
        base = completed.length;
        dispatch({ type: 'setPlan', plan: { task, steps: [...completed, ...steps] } });
        dispatch({ type: 'setState', state: 'executing' });
      }
    },
    [execSequence, replan, narrate],
  );

  // --- runTask -------------------------------------------------------------
  const runTask = useCallback(
    async (task: string): Promise<void> => {
      if (!viewerRef.current || !driverRef.current) {
        dispatch({ type: 'error', error: 'load a room before running a task' });
        return;
      }
      // Re-task robustness: supersede any in-flight run cleanly. Bumping runId
      // makes every older async flow's cancelled() go true (they bail at their
      // next checkpoint); cancelling the driver halts the current drive and
      // clears the stale path viz immediately — no double-drive.
      const myRun = ++runIdRef.current;
      cancelledRef.current = false;
      driverRef.current.cancel();
      viewerRef.current.setPath([]);
      const cancelled = (): boolean =>
        cancelledRef.current || runIdRef.current !== myRun;

      taskRef.current = task;
      // Reset the live trail for this new run.
      currentTrailRef.current = [];
      lastTrailUpdateRef.current = 0;
      viewerRef.current?.clearTrail();
      dispatch({ type: 'setState', state: 'planning' });

      const scene = sceneRef.current ?? minimalScene(boundsRef.current);
      let plan: Plan;
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scene, task, mode: 'plan' }),
        });
        if (cancelled()) return; // a newer run/reset superseded us mid-fetch
        const data = (await res.json()) as ApiResult<Plan>;
        if (!data.ok) {
          dispatch({ type: 'error', error: `planning failed: ${data.error}` });
          return;
        }
        plan = data.data;
      } catch (e) {
        if (cancelled()) return;
        dispatch({
          type: 'error',
          error: `planning failed: ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }

      if (cancelled()) return;
      dispatch({ type: 'setPlan', plan });
      dispatch({ type: 'setState', state: 'executing' });

      const runStartedAt = Date.now();
      await runPlan(plan.steps, task, cancelled);

      // Save the completed run to history regardless of outcome.
      if (currentTrailRef.current.length > 1) {
        viewerRef.current?.setTrail(currentTrailRef.current);
        const record: RunRecord = {
          id: `run-${runStartedAt}`,
          task,
          startedAt: runStartedAt,
          positions: [...currentTrailRef.current],
          outcome: cancelled() ? 'cancelled' : 'done',
        };
        dispatch({ type: 'addHistory', record });
      }
    },
    [runPlan],
  );

  // --- replayRun -----------------------------------------------------------
  const replayRun = useCallback((record: RunRecord) => {
    if (!driverRef.current || !viewerRef.current) return;
    // Cancel any active task first.
    cancelledRef.current = true;
    runIdRef.current++;
    driverRef.current.cancel();
    viewerRef.current.setPath([]);

    dispatch({ type: 'setReplaying', isReplaying: true });

    // Show the full historical trail immediately.
    viewerRef.current.setTrail(record.positions);

    // Drive the robot through the recorded positions at 3x speed.
    const pts = record.positions;
    driverRef.current.drive(pts, { speed: 2.4 }).then(() => {
      dispatch({ type: 'setReplaying', isReplaying: false });
    }).catch(() => {
      dispatch({ type: 'setReplaying', isReplaying: false });
    });
  }, []);

  // --- addObstacle ---------------------------------------------------------
  // Called by the viewer's onObstacleAdded callback: the viewer already drew
  // the box and gives us the id. We only update the grid + tracking map.
  const addObstacle = useCallback((at: Vec2, viewerAssignedId?: string): string => {
    let id = viewerAssignedId ?? '';
    if (!id) {
      // Programmatic call (no viewer auto-place) — ask viewer to draw the box.
      id = viewerRef.current?.addObstacle(at) ?? String(Date.now());
    }
    gridRef.current?.addObstacleFootprint(at, 0.4);
    manualObstaclesRef.current.set(id, at);
    return id;
  }, []);

  // --- removeObstacle ------------------------------------------------------
  // Rebuild the grid from geometry so the removed obstacle's blocked cells
  // are cleared, then re-stamp all remaining manual obstacles.
  const removeObstacle = useCallback((id: string) => {
    viewerRef.current?.removeObstacle(id);
    manualObstaclesRef.current.delete(id);

    const v = viewerRef.current;
    const root = (v?.getRoomRoot() ?? null) as THREE.Object3D | null;
    if (!v || !root) return;

    const grid = buildGrid(root, boundsRef.current, floorYRef.current);
    // Re-stamp remaining manual obstacles.
    for (const pos of manualObstaclesRef.current.values()) {
      grid.addObstacleFootprint(pos, 0.4);
    }
    // Re-stamp furniture footprints from the scene model.
    const scene = sceneRef.current;
    if (scene) {
      for (const obj of scene.objects) {
        if (obj.kind === 'furniture') {
          grid.addObstacleFootprint(obj.position, Math.min(Math.max(obj.size.w, obj.size.d), 1.0));
        }
      }
    }
    gridRef.current = grid;
  }, []);

  // --- debug ---------------------------------------------------------------
  const setDebugFailReplan = useCallback((on: boolean) => {
    debugFailReplanRef.current = on;
  }, []);

  const setVisionMode = useCallback((mode: 'gpt4o' | 'sam2') => {
    labelEndpointRef.current = mode === 'sam2' ? '/api/label-sam' : '/api/label';
  }, []);

  const teleportRobot = useCallback((pos: Vec2) => {
    const driver = driverRef.current;
    if (!driver) return;
    driver.cancel();
    const grid = gridRef.current;
    const safe = grid ? (grid.nearestFree(pos, 0.5) ?? grid.nearestFree(pos, 2.0) ?? pos) : pos;
    driver.setPose(safe);
    viewerRef.current?.setPath([]);
  }, []);

  const moveObject = useCallback((id: string, newPos: Vec2) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const obj = scene.objects.find((o) => o.id === id);
    if (!obj) return;
    obj.position = newPos;
    viewerRef.current?.setLabels(scene.objects);
    if (obj.kind === 'furniture' && gridRef.current) {
      const size = Math.min(Math.max(obj.size.w, obj.size.d), 1.0);
      gridRef.current.addObstacleFootprint(newPos, size);
    }
  }, []);

  // --- reset ---------------------------------------------------------------
  const reset = useCallback(() => {
    // Invalidate any in-flight run (its cancelled() flips true) AND stop the
    // driver's rAF loop so nothing keeps ticking after a reset.
    cancelledRef.current = true;
    runIdRef.current++;
    driverRef.current?.cancel();
    viewerRef.current?.setPath([]);
    // Drop the red obstacle boxes the viewer is still rendering. clearObstacles
    // is being added to RoomViewerHandle by the polish agent in parallel; call
    // it defensively so we don't depend on their landing order.
    // TODO(integrator): tighten after Wave 3.
    (viewerRef.current as { clearObstacles?: () => void })?.clearObstacles?.();
    // Rebuild the grid from geometry to drop obstacle footprints (the room stays).
    const v = viewerRef.current;
    const root = (v?.getRoomRoot() ?? null) as THREE.Object3D | null;
    if (v && root) {
      gridRef.current = buildGrid(root, boundsRef.current, floorYRef.current);
      const cx = (boundsRef.current.minX + boundsRef.current.maxX) / 2;
      const cz = (boundsRef.current.minZ + boundsRef.current.maxZ) / 2;
      const southZ = cz + (boundsRef.current.maxZ - cz) * 0.5;
      const seed: Vec2 = { x: cx, z: southZ };
      const startPos = gridRef.current.nearestFree(seed, 3) ?? seed;
      driverRef.current = new RobotDriver(v, startPos, -Math.PI / 2);
    }
    dispatch({ type: 'reset' });
  }, []);

  return {
    state: rs.state,
    scene: rs.scene,
    plan: rs.plan,
    currentStepIndex: rs.currentStepIndex,
    narration: rs.narration,
    error: rs.error,
    history: rs.history,
    isReplaying: rs.isReplaying,
    attachViewer,
    loadRoom,
    runTask,
    replayRun,
    addObstacle,
    removeObstacle,
    reset,
    setDebugFailReplan,
    setVisionMode,
    teleportRobot,
    moveObject,
  };
}

// Local alias so this module doesn't import the driver's result type by name at
// the top (keeps the public surface small); values are the same string union.
type DriveResultLike = 'arrived' | 'blocked' | 'cancelled';
