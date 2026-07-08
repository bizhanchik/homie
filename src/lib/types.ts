// Shared type contract for Homie. Wave 0 owns this file.
// Rule: EXTEND these types (add fields), never RENAME existing ones — 3 other
// agents code against this exact shape.
//
// Coordinate conventions:
//   world  = meters, XZ ground plane, Y up. Vec2 = (x, z) on that plane.
//   vision = NORMALIZED image coords in [0,1]: x right, z down (= image y).
//   Convert vision -> world with imageToWorld() below.
//   "Geometry is truth, LLM is semantics": collision/walkability come from mesh
//   raycasts, never from the LLM. The LLM only names things and suggests routes.

export type Vec2 = { x: number; z: number };

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export type SceneObject = {
  id: string;
  name: string;
  position: Vec2; // world coords (meters), center of the object footprint
  size: { w: number; d: number }; // world footprint: width (x) x depth (z), meters
  kind: 'furniture' | 'door' | 'opening' | 'other';
};

export type SceneModel = {
  bounds: Bounds;
  objects: SceneObject[];
  walkableZones: { center: Vec2; radius: number }[]; // world coords + radius (m)
};

export type PlanStep = {
  action: 'move' | 'turn' | 'interact';
  target?: string; // SceneObject id or name this step is about
  waypoint?: Vec2; // world coords (meters); present on 'move' steps
  note: string; // short first-person narration, e.g. "Heading to the table"
};

export type Plan = { task: string; steps: PlanStep[] };

export type AgentState =
  | 'idle'
  | 'awaiting_scan'
  | 'scene_ready'
  | 'labeling'
  | 'planning'
  | 'executing'
  | 'blocked'
  | 'replanning'
  | 'done'
  | 'error';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type NarrationEvent = { at: number; text: string }; // at = ms timestamp

export type RunRecord = {
  id: string;
  task: string;
  startedAt: number; // Date.now()
  positions: Vec2[];  // sampled robot positions throughout the run
  outcome: 'done' | 'cancelled';
};

// --- API payloads -----------------------------------------------------------

// POST /api/label  ->  ApiResult<SceneModel>
// A multi-image top-down capture: image [0] is the full-room orthographic render,
// images [1..] are overlapping zoomed crops of that SAME render (for exhaustive
// per-region detection). Each image carries its OWN world bounds so imageToWorld()
// maps THAT image's normalized [0,1] coords to world meters.
// bounds: overall framed world bounds, injected back into the returned SceneModel.
export type LabelRequest = {
  bounds: Bounds; // overall framed world bounds, injected into the returned SceneModel
  images: { imageDataUrl: string; bounds: Bounds }[]; // ordered: [0]=full room, [1..]=zoomed region crops; each image's own bounds map ITS OWN normalized [0,1] coords to world meters
};

// POST /api/plan  ->  ApiResult<Plan>
export type PlanRequest = {
  scene: SceneModel;
  task: string;
  mode: 'plan' | 'replan';
  context?: {
    completedSteps: PlanStep[];
    blockedAt: Vec2; // world position where the robot got stuck
    remainingTask: string;
  };
};

// --- Helpers -----------------------------------------------------------------

/**
 * Map a NORMALIZED [0,1] vision-image point to world coords (meters).
 * x -> minX + p.x*(maxX-minX);  z -> minZ + p.z*(maxZ-minZ).
 * Vision uses x-right / z-down (image y), matching a top-down render where
 * +z world points toward the bottom of the image.
 */
export function imageToWorld(p: Vec2, b: Bounds): Vec2 {
  return {
    x: b.minX + p.x * (b.maxX - b.minX),
    z: b.minZ + p.z * (b.maxZ - b.minZ),
  };
}
