// Deterministic canned AI output for mock mode (no OPENAI_API_KEY or MOCK_AI=1).
// Hand-tuned to match public/sample-room.glb so the viewer + sim have a coherent
// scene to render with zero API spend:
//   floor 6m (x) x 4m (z), origin-centered  -> x in [-3,3], z in [-2,2]
//   table  1.2w x 0.8d at world { x: 0,  z: 0    }   (kind: furniture)
//   sofa   2.0w x 0.9d at world { x: 0,  z: -1.45 }  (against north wall, kind: furniture)
//   doorway 1m gap in south wall at world { x: 0, z: +2 } (kind: opening)
import type { Bounds, PlanRequest, PlanStep, Plan, SceneModel } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * A SceneModel matching sample-room.glb. `bounds` is echoed from the request so
 * the returned model always agrees with the render the caller measured.
 */
export function mockSceneModel(bounds: Bounds): SceneModel {
  return {
    bounds,
    objects: [
      {
        id: 'obj-table',
        name: 'coffee table',
        kind: 'furniture',
        position: { x: 0, z: 0 },
        size: { w: 1.2, d: 0.8 },
      },
      {
        id: 'obj-sofa',
        name: 'sofa',
        kind: 'furniture',
        position: { x: 0, z: -1.45 },
        size: { w: 2.0, d: 0.9 },
      },
      {
        id: 'obj-doorway',
        name: 'doorway',
        kind: 'opening',
        position: { x: 0, z: 2 },
        size: { w: 1.0, d: 0.2 },
      },
    ],
    // Open floor a robot can stand in, steering clear of the table + sofa boxes.
    walkableZones: [
      { center: { x: -2, z: 0 }, radius: 0.9 }, // west of the table
      { center: { x: 2, z: 0 }, radius: 0.9 }, // east of the table
      { center: { x: 0, z: 1.2 }, radius: 0.7 }, // south open floor (toward door)
      { center: { x: 0, z: 1.85 }, radius: 0.4 }, // doorway approach
    ],
  };
}

/**
 * A 5-step plan: cross the open floor to the table, pause there, then head to the
 * doorway. Every move waypoint sits in open floor, outside the table/sofa boxes.
 */
export function mockPlan(task: string): Plan {
  const steps: PlanStep[] = [
    {
      action: 'move',
      target: 'coffee table',
      waypoint: { x: 1.4, z: 0.9 },
      note: 'On my way over to the table.',
    },
    {
      action: 'move',
      target: 'coffee table',
      waypoint: { x: 0, z: 0.75 },
      note: 'Almost at the table now.',
    },
    {
      action: 'interact',
      target: 'coffee table',
      note: 'Here at the table — taking a look.',
    },
    {
      action: 'move',
      target: 'doorway',
      waypoint: { x: 0, z: 1.4 },
      note: 'Turning around and heading for the doorway.',
    },
    {
      action: 'move',
      target: 'doorway',
      waypoint: { x: 0, z: 1.95 },
      note: 'Reaching the doorway to head out.',
    },
  ];
  return { task: task || 'Go to the table, then leave through the door.', steps };
}

/**
 * A revised remaining plan after the robot is blocked. It visibly detours ~1.2m
 * to the side with more room, then continues to the doorway. The first note
 * acknowledges the obstacle (contract requirement).
 */
export function mockReplan(
  context: NonNullable<PlanRequest['context']>,
  task: string,
): Plan {
  const blocked = context.blockedAt;
  // Detour toward whichever side has more open floor, then clamp inside bounds.
  const dir = blocked.x >= 0 ? -1 : 1;
  const detourX = clamp(blocked.x + dir * 1.2, -2.7, 2.7);

  const steps: PlanStep[] = [
    {
      action: 'move',
      waypoint: { x: detourX, z: clamp(blocked.z, -1.8, 1.8) },
      note: 'Something is blocking my path — rerouting around it.',
    },
    {
      action: 'move',
      waypoint: { x: detourX, z: 1.4 },
      note: 'Around the obstacle now, back on course.',
    },
    {
      action: 'move',
      target: 'doorway',
      waypoint: { x: 0, z: 1.95 },
      note: 'Heading for the doorway to finish up.',
    },
  ];
  return { task: task || context.remainingTask || 'Finish the task.', steps };
}
