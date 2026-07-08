'use client';

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
      <h2
        className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif", letterSpacing: '0.88px' }}
      >
        Plan
      </h2>

      {plan === null ? (
        <div className="flex flex-1 items-center justify-center">
          <p
            className="text-center text-sm"
            style={{ color: 'var(--color-muted-soft)', fontFamily: "'CursorGothic', sans-serif" }}
          >
            Give Homie a task below
            <span className="mt-1 block text-xs" style={{ color: 'var(--color-hairline-strong)' }}>
              and watch the plan appear here.
            </span>
          </p>
        </div>
      ) : (
        <>
          <p
            className="mb-3 shrink-0 text-sm font-medium leading-snug"
            style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
          >
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
                  className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors"
                  style={{
                    background: current ? 'rgba(245,78,0,0.06)' : 'transparent',
                    color: current
                      ? 'var(--color-primary)'
                      : done
                        ? 'var(--color-muted-soft)'
                        : 'var(--color-body)',
                    fontFamily: "'CursorGothic', sans-serif",
                  }}
                >
                  <span
                    className={`mt-px w-4 shrink-0 text-center font-mono ${current ? 'animate-pulse' : ''}`}
                    style={{
                      color: current
                        ? 'var(--color-primary)'
                        : done
                          ? 'var(--color-muted)'
                          : 'var(--color-hairline-strong)',
                    }}
                    aria-hidden
                  >
                    {done ? '✓' : current ? '▶' : '·'}
                  </span>
                  <span style={{ textDecoration: done ? 'line-through' : 'none' }}>
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
