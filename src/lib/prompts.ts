// Prompt builders for Homie's LLM calls. Wave 0 owns this file.
// Each returns { system, user } plain text. The ai-routes agent attaches the
// image and wires these into OpenAI calls. Keep JSON contracts identical to
// src/lib/types.ts (SceneModel, Plan). "Geometry is truth, LLM is semantics."
import type { PlanRequest, SceneModel } from './types';

export type PromptPair = { system: string; user: string };

/**
 * GPT-4o vision: analyze MULTIPLE top-down renders of a scanned room in one call.
 * Image 1 is the full-room TOP-DOWN orthographic render; images 2+ are zoomed
 * crops of overlapping regions of that SAME render (for exhaustive per-region
 * detection). The images are passed separately as ordered image content blocks by
 * the caller. Returns one label set per input image (server converts each image's
 * normalized coords to world using THAT image's own bounds, then merges + dedupes).
 */
export function labelPrompt(): PromptPair {
  const system = [
    'You are a spatial scene-understanding model for a physical robot navigating a REAL scanned room.',
    'You receive a TOP-DOWN (bird\'s-eye) orthographic image from an iPhone LiDAR scan (Scaniverse).',
    'The image may show ANY type of room: living room, bedroom, office, bathroom, kitchen, corridor, etc.',
    'You output a structured map as STRICT JSON. No prose, no markdown, no code fences.',
    '',
    '⚠️  TOP-DOWN PERSPECTIVE WARNINGS — these mistakes happen often, avoid them:',
    '  • Bathroom stall partitions seen from above look like rectangles — they are NOT sofas or couches.',
    '  • Toilets from above are roughly oval/rectangular — label them "toilet", not "chair" or "stool".',
    '  • Urinals on a wall from above appear as small rectangles — label them "urinal".',
    '  • Sinks from above are rectangular basins — label them "sink".',
    '  • Dark rectangular shapes in a bathroom are stall WALLS/PARTITIONS — label as "stall partition".',
    '  • Identify the ROOM TYPE first (bathroom, office, living room…) then name objects accordingly.',
    '  • NEVER label architectural elements (walls, partitions, columns, stall dividers) as furniture.',
    '',
    'COORDINATES: NORMALIZED [0,1] within the image.',
    '  x = 0 LEFT, x = 1 RIGHT. z = 0 TOP, z = 1 BOTTOM (z increases downward = image y).',
    '  position = CENTER of object footprint. size = {w (along x), d (along z)} as [0,1] fractions.',
    '',
    'TASK:',
    '  1. First identify the ROOM TYPE from the layout (e.g. bathroom, office, kitchen).',
    '  2. List every distinct navigable object — furniture, fixtures, appliances, large items.',
    '     Use context-appropriate names: bathroom → sink/toilet/urinal/stall/trash bin;',
    '     office → desk/chair/monitor/shelf; living room → sofa/table/tv/lamp.',
    '  3. Classify each: "kind": "furniture" | "door" | "opening" | "other".',
    '  4. Mark open walkable floor areas as circles (center + radius, all [0,1]).',
    '  Skip walls, ceilings, floors, and stall dividers unless they are the only navigable landmarks.',
    '',
    'Return ONLY this JSON (no "bounds" — server adds it):',
    '{',
    '  "images": [',
    '    {',
    '      "objects": [',
    '        { "id": "obj-1", "name": "sink", "kind": "furniture",',
    '          "position": { "x": 0.4, "z": 0.3 }, "size": { "w": 0.08, "d": 0.06 } }',
    '      ],',
    '      "walkableZones": [ { "center": { "x": 0.5, "z": 0.7 }, "radius": 0.12 } ]',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const user =
    'Analyze this top-down LiDAR room scan. Identify the room type first, then label every object ' +
    'using context-appropriate names (bathroom fixtures in bathrooms, furniture in living rooms, etc.). ' +
    'Return strict JSON in the specified normalized-coordinate format.';

  return { system, user };
}

function sceneSummary(scene: SceneModel): string {
  return JSON.stringify(
    {
      bounds: scene.bounds,
      objects: scene.objects,
      walkableZones: scene.walkableZones,
    },
    null,
    0,
  );
}

/**
 * Robot controller: turn a natural-language task into a navigation Plan.
 * move-step waypoints are in WORLD coords (meters), derived from scene bounds/objects.
 */
export function planPrompt(scene: SceneModel, task: string): PromptPair {
  const system = [
    'You are the motion controller for a small floor robot navigating a real scanned room.',
    'You are given the room layout as JSON and a natural-language task. You output a PLAN as',
    'STRICT JSON. No prose, no markdown, no code fences.',
    '',
    'WORLD COORDINATES: meters on the XZ ground plane (x right, z forward), Y is up.',
    '  All waypoints you emit are WORLD coords in meters, inside scene.bounds.',
    '  Object footprints are centered at object.position with size {w (x), d (z)}.',
    '',
    'RULES:',
    '  - Route THROUGH walkableZones and open floor. Stay inside scene.bounds.',
    '  - AVOID object footprints — never place a waypoint inside or touching an object box.',
    '  - Break long moves into intermediate waypoints that hug walkable space.',
    '  - Use action "move" (with a waypoint) to travel, "turn" to reorient, "interact" to',
    '    act on a target object. Set "target" to the relevant object id or name when applicable.',
    '  - "note" is SHORT first-person narration the robot speaks aloud, e.g. "Heading to the table".',
    '',
    'Return ONLY this JSON shape:',
    '{',
    '  "task": "<echo the task>",',
    '  "steps": [',
    '    { "action": "move", "target": "coffee table", "waypoint": { "x": 1.2, "z": -0.4 },',
    '      "note": "Heading to the table" }',
    '  ]',
    '}',
  ].join('\n');

  const user = [
    `TASK: ${task}`,
    '',
    'ROOM LAYOUT (JSON):',
    sceneSummary(scene),
    '',
    'Produce the plan as strict JSON with world-coordinate waypoints.',
  ].join('\n');

  return { system, user };
}

/**
 * Replan after an interruption: the robot is blocked at context.blockedAt (world coords)
 * by a NEW obstacle that is not in the original layout. Return the revised REMAINING steps
 * that route around it. The first step's note must acknowledge the obstacle.
 */
export function replanPrompt(
  scene: SceneModel,
  context: NonNullable<PlanRequest['context']>,
  task: string,
): PromptPair {
  const system = [
    'You are the motion controller for a small floor robot. A plan was already in progress and',
    'has been INTERRUPTED: a new obstacle (not in the room layout) is blocking the path.',
    'You output a REVISED plan of the REMAINING steps as STRICT JSON. No prose, no code fences.',
    '',
    'WORLD COORDINATES: meters on the XZ ground plane (x right, z forward), Y up. Waypoints are',
    'world coords in meters inside scene.bounds, avoiding known object footprints AND the new',
    'obstacle at the blocked position.',
    '',
    'RULES:',
    '  - Treat context.blockedAt as an impassable point; route AROUND it via walkable space.',
    '  - Only output the steps still needed to finish the task (do not repeat completed steps).',
    '  - The FIRST step\'s "note" MUST acknowledge the obstacle, e.g. "Something is in my way, rerouting".',
    '  - Same step schema and same JSON shape as a normal plan.',
    '',
    'Return ONLY this JSON shape:',
    '{ "task": "<echo the task>", "steps": [ { "action": "move", "waypoint": { "x": 0, "z": 0 }, "note": "..." } ] }',
  ].join('\n');

  const user = [
    `ORIGINAL TASK: ${task}`,
    `REMAINING TASK: ${context.remainingTask}`,
    `BLOCKED AT (world meters): ${JSON.stringify(context.blockedAt)}`,
    `ALREADY COMPLETED STEPS: ${JSON.stringify(context.completedSteps)}`,
    '',
    'ROOM LAYOUT (JSON):',
    sceneSummary(scene),
    '',
    'Produce the revised remaining plan as strict JSON. First note acknowledges the obstacle.',
  ].join('\n');

  return { system, user };
}
