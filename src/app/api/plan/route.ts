// POST /api/plan  ->  ApiResult<Plan>   (mode: 'plan' | 'replan')
// Mock mode: deterministic mockPlan / mockReplan matching sample-room.glb.
// Real mode: GPT-4o turns the scene + task into a navigation Plan. Move steps
// missing a waypoint are rejected (via structuredCompletion's retry path); every
// returned waypoint is clamped into scene.bounds ("geometry is truth").
import type { NextRequest } from 'next/server';
import { isMock, structuredCompletion } from '@/lib/openai';
import { planPrompt, replanPrompt } from '@/lib/prompts';
import { planRequestSchema, planSchema } from '@/lib/schemas';
import type { ApiResult, Bounds, Plan, Vec2 } from '@/lib/types';
import { mockPlan, mockReplan } from '@/lib/mock-data';

// A move step MUST carry a waypoint. This refinement makes a waypoint-less move
// fail zod validation, which drives structuredCompletion's one retry.
const planResponseSchema = planSchema.superRefine((plan, ctx) => {
  plan.steps.forEach((s, i) => {
    if (s.action === 'move' && !s.waypoint) {
      ctx.addIssue({
        code: 'custom',
        message: `step ${i} has action "move" but no waypoint`,
        path: ['steps', i, 'waypoint'],
      });
    }
  });
});

function clampToBounds(p: Vec2, b: Bounds): Vec2 {
  const loX = Math.min(b.minX, b.maxX);
  const hiX = Math.max(b.minX, b.maxX);
  const loZ = Math.min(b.minZ, b.maxZ);
  const hiZ = Math.max(b.minZ, b.maxZ);
  return {
    x: Math.max(loX, Math.min(hiX, p.x)),
    z: Math.max(loZ, Math.min(hiZ, p.z)),
  };
}

function clampPlan(plan: Plan, b: Bounds): Plan {
  return {
    task: plan.task,
    steps: plan.steps.map((s) =>
      s.waypoint ? { ...s, waypoint: clampToBounds(s.waypoint, b) } : s,
    ),
  };
}

function json(body: ApiResult<Plan>, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON body' }, 400);
  }

  const parsed = planRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: `invalid PlanRequest: ${parsed.error.message}` },
      400,
    );
  }
  const { scene, task, mode, context } = parsed.data;

  if (mode === 'replan' && !context) {
    return json({ ok: false, error: 'replan mode requires context' }, 400);
  }

  if (isMock) {
    await new Promise((r) => setTimeout(r, 700)); // let the UI show its loading state
    const data =
      mode === 'replan' && context ? mockReplan(context, task) : mockPlan(task);
    return json({ ok: true, data });
  }

  const { system, user } =
    mode === 'replan' && context
      ? replanPrompt(scene, context, task)
      : planPrompt(scene, task);

  const result = await structuredCompletion({
    system,
    user,
    schema: planResponseSchema,
    schemaName: mode === 'replan' ? 'robot_replan' : 'robot_plan',
  });
  if (!result.ok) return json(result);

  return json({ ok: true, data: clampPlan(result.data, scene.bounds) });
}
