'use client';

import type { NarratorState } from '@/voice/narrator';

const DOT_COLOR: Record<NarratorState, string> = {
  off: 'var(--color-hairline-strong)',
  connecting: '#f59e0b',
  live: 'var(--color-primary)',
  fallback: '#f59e0b',
  error: '#ef4444',
};

const LABEL: Record<NarratorState, string> = {
  off: 'Voice off',
  connecting: 'Connecting…',
  live: 'Voice: Homie live',
  fallback: 'Voice: browser',
  error: 'Voice error',
};

export default function VoiceButton({
  state,
  onToggle,
}: {
  state: NarratorState;
  onToggle: () => void;
}) {
  const on = state === 'live' || state === 'fallback';
  const busy = state === 'connecting';

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      title={
        on
          ? 'Turn Homie's voice off'
          : 'Let Homie speak its decisions out loud (and take voice commands)'
      }
      aria-pressed={on}
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition disabled:cursor-wait cursor-pointer"
      style={{
        border: `1px solid ${on ? 'rgba(245,78,0,0.35)' : 'var(--color-hairline-strong)'}`,
        background: on ? 'rgba(245,78,0,0.06)' : 'var(--color-surface-card)',
        color: on ? 'var(--color-primary)' : 'var(--color-muted)',
        fontFamily: "'CursorGothic', sans-serif",
      }}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full${state === 'connecting' ? ' animate-pulse' : ''}`}
        style={{ background: DOT_COLOR[state] }}
        aria-hidden
      />
      <span aria-hidden className="text-base leading-none">{on ? '🔊' : '🔈'}</span>
      <span className="whitespace-nowrap">{LABEL[state]}</span>
    </button>
  );
}
