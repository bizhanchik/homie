'use client';

// Right-sidebar panel: Homie's plan for the current task, step by step. Each
// step shows a marker — done (✓, dimmed), current (▶, emerald pulse) or pending
// (·). The current step auto-scrolls into view as execution advances.

import { useEffect, useRef } from 'react';
import type { Plan } from '@/lib/types';

export default function PlanPanel({
  plan,
  currentStepIndex,
}: {
  plan: Plan | null;
  currentStepIndex: number;
}) {
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentStepIndex, plan]);

  return (
    <section className="flex h-full flex-col p-4">
      <h2 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Plan
      </h2>

      {plan === null ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-center text-sm text-neutral-600">
            Give Homie a task below
            <span className="mt-1 block text-xs text-neutral-700">
              and watch the plan appear here.
            </span>
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 shrink-0 text-sm font-medium leading-snug text-neutral-200">
            {plan.task}
          </p>
          <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {plan.steps.map((step, i) => {
              const done = i < currentStepIndex;
              const current = i === currentStepIndex;
              return (
                <li
                  key={i}
                  ref={current ? currentRef : undefined}
                  className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                    current
                      ? 'bg-emerald-400/10 text-emerald-200'
                      : done
                        ? 'text-neutral-500'
                        : 'text-neutral-300'
                  }`}
                >
                  <span
                    className={`mt-px w-4 shrink-0 text-center font-mono ${
                      current
                        ? 'animate-pulse text-emerald-400'
                        : done
                          ? 'text-emerald-600/70'
                          : 'text-neutral-600'
                    }`}
                    aria-hidden
                  >
                    {done ? '✓' : current ? '▶' : '·'}
                  </span>
                  <span className={done ? 'line-through decoration-neutral-700' : ''}>
                    {step.note}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
