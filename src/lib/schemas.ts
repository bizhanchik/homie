// Zod schemas mirroring src/lib/types.ts, for server-side validation of
// LLM structured outputs and incoming API request bodies. Wave 0 owns this file.
// Keep in lockstep with types.ts.
import { z } from 'zod';

export const vec2Schema = z.object({
  x: z.number(),
  z: z.number(),
});

export const boundsSchema = z.object({
  minX: z.number(),
  maxX: z.number(),
  minZ: z.number(),
  maxZ: z.number(),
});

export const sceneObjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: vec2Schema,
  size: z.object({ w: z.number(), d: z.number() }),
  kind: z.enum(['furniture', 'door', 'opening', 'other']),
});

export const sceneModelSchema = z.object({
  bounds: boundsSchema,
  objects: z.array(sceneObjectSchema),
  walkableZones: z.array(
    z.object({
      center: vec2Schema,
      radius: z.number(),
    }),
  ),
});

export const planStepSchema = z.object({
  action: z.enum(['move', 'turn', 'interact']),
  target: z.string().optional(),
  waypoint: vec2Schema.optional(),
  note: z.string(),
});

export const planSchema = z.object({
  task: z.string(),
  steps: z.array(planStepSchema),
});

export const labelImageSchema = z.object({
  imageDataUrl: z.string(),
  bounds: boundsSchema,
});

export const labelRequestSchema = z.object({
  bounds: boundsSchema,
  images: z.array(labelImageSchema).min(1),
});

export const planRequestSchema = z.object({
  scene: sceneModelSchema,
  task: z.string(),
  mode: z.enum(['plan', 'replan']),
  context: z
    .object({
      completedSteps: z.array(planStepSchema),
      blockedAt: vec2Schema,
      remainingTask: z.string(),
    })
    .optional(),
});
