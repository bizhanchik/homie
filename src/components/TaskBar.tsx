'use client';

import { useEffect, useState } from 'react';

const EXAMPLES = [
  'Go to the table, then the door',
  'Patrol the room',
  'Go wait by the sofa',
];

export type MicState = {
  connected: boolean;
  enabled: boolean;
  supported: boolean;
  onToggle: () => void;
};

export default function TaskBar({
  onRun,
  disabled,
  busy,
  mic,
  injectedTask,
}: {
  onRun: (task: string) => void;
  disabled: boolean;
  busy: boolean;
  mic?: MicState;
  injectedTask?: { text: string; nonce: number } | null;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (injectedTask && injectedTask.text) setValue(injectedTask.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedTask?.nonce]);

  const canRun = !disabled && !busy && value.trim().length > 0;

  const run = () => {
    if (!canRun) return;
    onRun(value.trim());
  };

  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{
        borderTop: '1px solid var(--color-hairline)',
        background: 'var(--color-canvas)',
      }}
    >
      <div className="mb-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled}
            onClick={() => setValue(ex)}
            className="rounded-full px-3 py-1 text-xs transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              border: '1px solid var(--color-hairline-strong)',
              background: 'var(--color-surface-card)',
              color: 'var(--color-muted)',
              fontFamily: "'CursorGothic', sans-serif",
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {mic?.connected && (
          <button
            type="button"
            onClick={mic.supported ? mic.onToggle : undefined}
            disabled={!mic.supported}
            aria-pressed={mic.enabled}
            title={
              !mic.supported
                ? 'Voice input needs Chrome'
                : mic.enabled
                  ? 'Listening — tap to stop'
                  : 'Tap to speak a command'
            }
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            style={{
              border: mic.enabled
                ? '1px solid var(--color-primary)'
                : '1px solid var(--color-hairline-strong)',
              background: mic.enabled ? 'rgba(245,78,0,0.08)' : 'var(--color-surface-card)',
              color: mic.enabled ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
          >
            <span aria-hidden className={mic.enabled ? 'animate-pulse' : ''}>🎤</span>
          </button>
        )}
        <input
          name="task"
          aria-label="Task for Homie"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          disabled={disabled}
          placeholder="Tell Homie what to do…"
          className="min-w-0 flex-1 rounded-xl px-4 py-2.5 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            border: '1px solid var(--color-hairline-strong)',
            background: 'var(--color-surface-card)',
            color: 'var(--color-ink)',
            fontFamily: "'CursorGothic', sans-serif",
          }}
        />
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition cursor-pointer disabled:cursor-not-allowed"
          style={{
            background: canRun ? 'var(--color-ink)' : 'var(--color-surface-strong)',
            color: canRun ? 'var(--color-canvas)' : 'var(--color-muted)',
            fontFamily: "'CursorGothic', sans-serif",
            border: 'none',
          }}
        >
          {busy && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" aria-hidden />
          )}
          {busy ? 'Running…' : 'Execute'}
        </button>
      </div>
    </div>
  );
}
