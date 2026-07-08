'use client';

import type { RunRecord } from '@/lib/types';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function HistoryPanel({
  history,
  isReplaying,
  onReplay,
}: {
  history: RunRecord[];
  isReplaying: boolean;
  onReplay: (record: RunRecord) => void;
}) {
  if (history.length === 0) return null;

  return (
    <section
      className="shrink-0 p-4"
      style={{ borderTop: '1px solid var(--color-hairline)' }}
    >
      <h2
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{
          color: 'var(--color-muted)',
          fontFamily: "'CursorGothic', sans-serif",
          letterSpacing: '0.88px',
        }}
      >
        Run history
      </h2>

      <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
        {history.map((rec) => (
          <li
            key={rec.id}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2"
            style={{
              border: '1px solid var(--color-hairline)',
              background: 'var(--color-surface-card)',
            }}
          >
            <span
              className="shrink-0 text-xs"
              title={rec.outcome}
              style={{ color: rec.outcome === 'done' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            >
              {rec.outcome === 'done' ? '✓' : '✕'}
            </span>

            <span
              className="min-w-0 flex-1 truncate text-xs"
              style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
              title={rec.task}
            >
              {rec.task}
            </span>

            <span
              className="shrink-0 text-[10px]"
              style={{ color: 'var(--color-muted-soft)', fontFamily: 'monospace' }}
            >
              {timeAgo(rec.startedAt)}
            </span>

            <button
              type="button"
              onClick={() => onReplay(rec)}
              disabled={isReplaying}
              title="Replay this run at 3x speed"
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition disabled:cursor-wait disabled:opacity-40 cursor-pointer"
              style={{
                background: 'var(--color-surface-strong)',
                color: 'var(--color-ink)',
                border: '1px solid var(--color-hairline-strong)',
                fontFamily: "'CursorGothic', sans-serif",
              }}
            >
              {isReplaying ? '…' : '▶'}
            </button>
          </li>
        ))}
      </ul>

      {isReplaying && (
        <p
          className="mt-2 text-center text-[11px]"
          style={{ color: 'var(--color-primary)', fontFamily: "'CursorGothic', sans-serif" }}
        >
          Replaying at 3× speed…
        </p>
      )}
    </section>
  );
}
