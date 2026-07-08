'use client';

import type { SceneModel, SceneObject } from '@/lib/types';

function emojiFor(o: SceneObject): string {
  const n = o.name.toLowerCase();
  if (o.kind === 'door' || o.kind === 'opening' || n.includes('door')) return '🚪';
  if (n.includes('sofa') || n.includes('couch')) return '🛋️';
  if (n.includes('bed')) return '🛏️';
  if (n.includes('chair') || n.includes('stool')) return '🪑';
  if (n.includes('table') || n.includes('desk')) return '🪑';
  if (n.includes('tv') || n.includes('screen') || n.includes('monitor')) return '📺';
  if (n.includes('plant')) return '🪴';
  if (n.includes('lamp') || n.includes('light')) return '💡';
  if (n.includes('rug') || n.includes('carpet') || n.includes('mat')) return '🟫';
  if (n.includes('shelf') || n.includes('cabinet') || n.includes('drawer')) return '🗄️';
  if (o.kind === 'furniture') return '🛋️';
  return '📦';
}

function fmt(n: number): string {
  return n.toFixed(1);
}

export default function LabelsPanel({
  scene,
  placingObjectId,
  onPlace,
}: {
  scene: SceneModel | null;
  placingObjectId?: string | null;
  onPlace?: (id: string) => void;
}) {
  return (
    <section
      className="shrink-0 p-4"
      style={{ borderBottom: '1px solid var(--color-hairline)' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif", letterSpacing: '0.88px' }}
        >
          In this room
        </h2>
        {scene && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: 'var(--color-surface-strong)', color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
          >
            {scene.objects.length}
          </span>
        )}
      </div>

      {scene === null ? (
        <ul className="space-y-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
              style={{ border: '1px solid var(--color-hairline)', background: 'var(--color-surface-card)' }}
            >
              <span className="h-6 w-6 shrink-0 animate-pulse rounded-md" style={{ background: 'var(--color-surface-strong)' }} />
              <span className="flex-1 space-y-1.5">
                <span className="block h-2.5 w-24 animate-pulse rounded" style={{ background: 'var(--color-surface-strong)' }} />
                <span className="block h-2 w-16 animate-pulse rounded" style={{ background: 'var(--color-hairline-strong)' }} />
              </span>
            </li>
          ))}
        </ul>
      ) : scene.objects.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-soft)', fontFamily: "'CursorGothic', sans-serif" }}>
          No objects detected yet.
        </p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {scene.objects.map((o) => {
            const isPlacing = placingObjectId === o.id;
            return (
              <li
                key={o.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2"
                style={{
                  border: isPlacing ? '1px solid var(--color-primary)' : '1px solid var(--color-hairline)',
                  background: isPlacing ? 'rgba(245,78,0,0.06)' : 'var(--color-surface-card)',
                }}
              >
                <span className="text-lg leading-none">{emojiFor(o)}</span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-medium capitalize"
                    style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
                  >
                    {o.name}
                  </span>
                  <span
                    className="block font-mono text-[11px]"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {fmt(o.position.x)}, {fmt(o.position.z)} m
                  </span>
                </span>
                {onPlace && (
                  <button
                    type="button"
                    title={isPlacing ? 'Click floor to place' : 'Move on floor'}
                    onClick={() => onPlace(o.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium transition cursor-pointer"
                    style={{
                      background: isPlacing ? 'var(--color-primary)' : 'var(--color-surface-strong)',
                      color: isPlacing ? '#fff' : 'var(--color-ink)',
                      border: '1px solid var(--color-hairline-strong)',
                      fontFamily: "'CursorGothic', sans-serif",
                    }}
                  >
                    {isPlacing ? '↓ click floor' : '✦'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
