'use client';

// Header control for Homie's voice. Toggles the narrator connect/disconnect and
// shows a tiny state dot + label. The mic toggle lives in the TaskBar (appears
// once connected) — this button only owns the speaker on/off + status.

import type { NarratorState } from '@/voice/narrator';

const DOT: Record<NarratorState, string> = {
  off: 'bg-neutral-600',
  connecting: 'animate-pulse bg-amber-400',
  live: 'bg-emerald-400',
  fallback: 'bg-amber-400',
  error: 'bg-red-400',
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
          ? 'Turn Homie’s voice off'
          : 'Let Homie speak its decisions out loud (and take voice commands)'
      }
      aria-pressed={on}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:cursor-wait ${
        on
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500'
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[state]}`} aria-hidden />
      <span aria-hidden className="text-base leading-none">
        {on ? '🔊' : '🔈'}
      </span>
      <span className="whitespace-nowrap">{LABEL[state]}</span>
    </button>
  );
}
