'use client';

// Homie landing — one dark screen. Wordmark, the pitch, and a single CTA that
// mints a fresh session id and drops you into the studio.

import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';

const STEPS = [
  { emoji: '📱', title: 'Scan', body: 'Point your iPhone around the room. A LiDAR mesh beams up in seconds.' },
  { emoji: '🤖', title: 'Simulate', body: 'Watch Homie navigate and run tasks inside your actual space.' },
  { emoji: '📦', title: 'Order', body: 'Love it? Order the real robot — it ships knowing your home.' },
];

export default function Home() {
  const router = useRouter();

  const openStudio = () => {
    router.push(`/s/${nanoid(8)}`);
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-12 overflow-hidden bg-neutral-950 px-6 py-14 text-neutral-100">
      {/* Ambient emerald glow — pure CSS, no assets. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 45% at 50% 22%, rgba(16,185,129,0.16), transparent 70%), radial-gradient(40% 30% at 80% 90%, rgba(52,211,153,0.08), transparent 70%)',
        }}
      />

      <div className="flex max-w-2xl flex-col items-center text-center">
        <div className="mb-7 flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/5 px-4 py-1.5 text-xs font-medium text-emerald-300/90">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Try before you buy
        </div>

        <h1 className="text-5xl font-bold tracking-tight text-white sm:text-7xl">
          Homie
        </h1>

        <h2 className="mt-5 text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-[2.75rem]">
          Try a home robot in{' '}
          <span className="bg-gradient-to-r from-emerald-300 to-emerald-500 bg-clip-text text-transparent">
            YOUR
          </span>{' '}
          home.
          <br className="hidden sm:block" /> Before you buy it.
        </h2>

        <p className="mt-6 max-w-md text-balance text-lg leading-relaxed text-neutral-400">
          Scan your room with your iPhone. Watch Homie work inside it. Order the
          real thing.
        </p>

        <button
          type="button"
          onClick={openStudio}
          className="mt-10 rounded-full bg-emerald-500 px-8 py-3.5 text-base font-semibold text-neutral-950 shadow-lg shadow-emerald-500/25 ring-1 ring-emerald-400/40 transition hover:-translate-y-0.5 hover:bg-emerald-400 hover:shadow-emerald-500/40"
        >
          Open Studio →
        </button>
      </div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 transition hover:border-emerald-500/40 hover:bg-neutral-900/70"
          >
            <div className="mb-3 flex items-center gap-2 text-sm text-neutral-500">
              <span className="text-2xl">{s.emoji}</span>
              <span className="font-mono">0{i + 1}</span>
            </div>
            <div className="text-base font-semibold text-neutral-100">{s.title}</div>
            <p className="mt-1 text-sm leading-relaxed text-neutral-400">{s.body}</p>
          </div>
        ))}
      </div>

      <footer className="text-xs text-neutral-600">
        Built at Cursor Physical AI Hackathon — Almaty 2026
      </footer>
    </main>
  );
}
