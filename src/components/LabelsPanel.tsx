'use client';

// Right-sidebar panel: the objects Homie recognised in the scanned room. Shows
// a shimmer skeleton while the scene is still being understood (scene === null),
// then a tidy list once /api/label has resolved into a SceneModel.

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

export default function LabelsPanel({ scene }: { scene: SceneModel | null }) {
  return (
    <section className="shrink-0 border-b border-neutral-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          In this room
        </h2>
        {scene && (
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] font-medium text-neutral-300">
            {scene.objects.length}
          </span>
        )}
      </div>

      {scene === null ? (
        <ul className="space-y-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-lg border border-neutral-800/60 bg-neutral-900/40 px-3 py-2"
            >
              <span className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-neutral-800" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-2.5 w-24 animate-pulse rounded bg-neutral-800" />
                <span className="block h-2 w-16 animate-pulse rounded bg-neutral-800/70" />
              </span>
            </li>
          ))}
        </ul>
      ) : scene.objects.length === 0 ? (
        <p className="text-sm text-neutral-500">No objects detected yet.</p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {scene.objects.map((o) => (
            <li
              key={o.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2"
            >
              <span className="text-lg leading-none">{emojiFor(o)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium capitalize text-neutral-100">
                  {o.name}
                </span>
                <span className="block font-mono text-[11px] text-neutral-500">
                  {fmt(o.position.x)}, {fmt(o.position.z)} m
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
