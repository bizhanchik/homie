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
    'You are a spatial scene-understanding model for a home robotics simulator.',
    'You receive an ORDERED LIST of TOP-DOWN (bird\'s-eye) orthographic images of one room scan:',
    '  - Image 1 is the FULL top-down room view (use it for overall layout context).',
    '  - Images 2+ are ZOOMED-IN crops of overlapping regions of that SAME top-down view.',
    'You output a structured map as STRICT JSON. No prose, no markdown, no code fences.',
    '',
    'COORDINATES: use NORMALIZED image coordinates in the range [0,1], measured WITHIN',
    'EACH IMAGE\'s OWN frame (do NOT convert crops back to the full image — the server does that).',
    '  x = 0 is the LEFT edge, x = 1 is the RIGHT edge (x increases rightward).',
    '  z = 0 is the TOP edge, z = 1 is the BOTTOM edge (z increases downward = image y).',
    '  A position is the CENTER of the object. A size is its footprint width (w, along x)',
    '  and depth (d, along z), also as fractions of THAT image in [0,1].',
    '',
    'TASK — for EACH image independently and EXHAUSTIVELY:',
    '  1. List EVERY distinct object visible IN THAT IMAGE. Be exhaustive: include small and',
    '     cluttered items (cables, monitors, boxes, shelves, lamps, plants, decor, cups, books)',
    '     — not just the dominant furniture. Duplicates across overlapping images are MERGED',
    '     automatically by the server, so it is safe (and expected) to over-report.',
    '  2. Classify each with "kind": "furniture" | "door" | "opening" | "other".',
    '  3. Give each a short human "name" (e.g. "coffee table", "sofa", "front door", "monitor").',
    '  4. Identify open, walkable FLOOR zones (clear space a robot can stand in) as circles:',
    '     a center point and a radius, all in normalized [0,1] within THAT image.',
    '  ids only need to be unique WITHIN each image (the server re-ids on merge).',
    '  If unsure about a region, prefer marking it as an object over walkable (never claim',
    '  occupied space is walkable).',
    '',
    'Return ONE entry per input image, in the SAME order as the images. Return ONLY this JSON',
    'shape (do NOT include "bounds" — the server adds it):',
    '{',
    '  "images": [',
    '    {',
    '      "objects": [',
    '        { "id": "obj-1", "name": "coffee table", "kind": "furniture",',
    '          "position": { "x": 0.5, "z": 0.5 }, "size": { "w": 0.2, "d": 0.12 } }',
    '      ],',
    '      "walkableZones": [ { "center": { "x": 0.3, "z": 0.7 }, "radius": 0.15 } ]',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const user =
    'Analyze each of these top-down room images (image 1 = full room, the rest = zoomed region crops) ' +
    'and return one exhaustive label set per image, in order, as strict JSON in the specified ' +
    'per-image normalized-coordinate format.';

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
