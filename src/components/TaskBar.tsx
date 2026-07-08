'use client';

// Bottom bar of the studio: type (or tap an example of) what Homie should do,
// then Execute. Owns only its own input text; running is the page's concern.

import { useEffect, useState } from 'react';

const EXAMPLES = [
  'Go to the table, then the door',
  'Patrol the room',
  'Go wait by the sofa',
];

// Optional voice-mic control, prop-drilled from the studio page. `connected`
// gates the button's appearance (only once the narrator is live/fallback);
// `supported` false -> shown disabled with a "needs Chrome" tooltip.
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
  // A spoken command echoed into the input so the user sees what Homie heard.
  injectedTask?: { text: string; nonce: number } | null;
}) {
  const [value, setValue] = useState('');

  // Reflect a voice command into the input (the page also auto-runs it).
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
    <div className="shrink-0 border-t border-neutral-800 bg-neutral-950/95 px-4 py-3">
      <div className="mb-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled}
            onClick={() => setValue(ex)}
            className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400 transition hover:border-emerald-500/60 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-800 disabled:hover:text-neutral-400"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* mic-slot */}
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
                  ? 'Listening — tap to stop (push-to-talk for the demo)'
                  : 'Tap to speak a command'
            }
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
              mic.enabled
                ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-300'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600'
            }`}
          >
            <span aria-hidden className={mic.enabled ? 'animate-pulse' : ''}>
              🎤
            </span>
          </button>
        )}
        <input
          name="task"
          aria-label="Task for Homie"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
          disabled={disabled}
          placeholder="Tell Homie what to do…"
          className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none transition focus:border-emerald-500/70 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {busy && (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-950/40 border-t-neutral-950"
              aria-hidden
            />
          )}
          {busy ? 'Running…' : 'Execute'}
        </button>
      </div>
    </div>
  );
}
