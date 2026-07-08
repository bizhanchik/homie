'use client';

import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';

const STEPS = [
  {
    pill: 'Scan',
    pillColor: 'bg-[#dfa88f] text-[#26251e]',
    title: 'Point. Walk. Done.',
    body: 'Open Scaniverse on your iPhone. Walk the room once. A LiDAR mesh beams to the browser in seconds.',
  },
  {
    pill: 'Simulate',
    pillColor: 'bg-[#c0a8dd] text-[#26251e]',
    title: 'Watch it work.',
    body: 'Homie reads the room — furniture, clearances, floor paths. Type a task and watch it navigate your actual space.',
  },
  {
    pill: 'Order',
    pillColor: 'bg-[#c08532] text-white',
    title: 'Ship knowing your home.',
    body: 'Love it? Reserve the real robot. It arrives with your map already loaded — day one, it knows your home.',
  },
];

export default function Home() {
  const router = useRouter();

  const openStudio = () => {
    router.push(`/s/${nanoid(8)}`);
  };

  return (
    <main
      className="min-h-screen"
      style={{ background: 'var(--color-canvas)', color: 'var(--color-ink)' }}
    >
      {/* ── Nav ── */}
      <nav
        className="flex items-center justify-between px-8 h-16 border-b"
        style={{ borderColor: 'var(--color-hairline)' }}
      >
        <span
          className="text-base font-semibold tracking-tight"
          style={{ fontFamily: "'CursorGothic', sans-serif", color: 'var(--color-ink)' }}
        >
          Homie
        </span>
        <div className="flex items-center gap-6">
          <span
            className="text-sm hidden sm:block"
            style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif" }}
          >
            Cursor Physical AI Hackathon · Almaty 2026
          </span>
          <button
            type="button"
            onClick={openStudio}
            className="text-sm font-medium transition-opacity hover:opacity-70 cursor-pointer"
            style={{
              color: 'var(--color-primary)',
              fontFamily: "'CursorGothic', sans-serif",
              background: 'none',
              border: 'none',
            }}
          >
            Try it →
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-5xl mx-auto px-8 pt-24 pb-20">
        <div className="mb-8 inline-flex items-center gap-2">
          <span
            className="text-xs font-semibold px-3 py-1 rounded-full"
            style={{
              background: 'var(--color-surface-strong)',
              color: 'var(--color-ink)',
              letterSpacing: '0.88px',
              textTransform: 'uppercase',
              fontFamily: "'CursorGothic', sans-serif",
            }}
          >
            Try before you buy
          </span>
        </div>

        <h1
          className="leading-none mb-6"
          style={{
            fontFamily: "'CursorGothic', sans-serif",
            fontSize: 'clamp(48px, 8vw, 80px)',
            fontWeight: 400,
            letterSpacing: '-2px',
            color: 'var(--color-ink)',
            maxWidth: '820px',
          }}
        >
          Try a home robot in{' '}
          <span style={{ color: 'var(--color-primary)' }}>YOUR</span>{' '}
          home.<br />Before you buy it.
        </h1>

        <p
          className="mb-10 max-w-md"
          style={{
            fontFamily: "'CursorGothic', sans-serif",
            fontSize: '18px',
            fontWeight: 400,
            lineHeight: 1.5,
            color: 'var(--color-body)',
          }}
        >
          Scan your room with an iPhone. Watch Homie navigate and run tasks
          inside your actual space. Order the real thing.
        </p>

        <div className="flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={openStudio}
            className="transition-all duration-150 cursor-pointer hover:opacity-90 active:scale-[0.98] inline-flex items-center"
            style={{
              background: 'var(--color-ink)',
              color: 'var(--color-canvas)',
              fontFamily: "'CursorGothic', sans-serif",
              fontSize: '14px',
              fontWeight: 500,
              padding: '12px 24px',
              height: '44px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
            }}
          >
            Open Studio
          </button>
          <button
            type="button"
            className="transition-opacity duration-150 hover:opacity-60 cursor-pointer"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-muted)',
              fontFamily: "'CursorGothic', sans-serif",
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            See how it works ↓
          </button>
        </div>
      </section>

      {/* ── Divider ── */}
      <div style={{ height: '1px', background: 'var(--color-hairline)', margin: '0 32px' }} />

      {/* ── Steps ── */}
      <section className="max-w-5xl mx-auto px-8 py-20">
        <p
          className="text-xs font-semibold uppercase mb-12"
          style={{
            fontFamily: "'CursorGothic', sans-serif",
            letterSpacing: '0.88px',
            color: 'var(--color-muted)',
          }}
        >
          How it works
        </p>

        <div className="grid gap-px" style={{ background: 'var(--color-hairline)' }}>
          {STEPS.map((s, i) => (
            <div
              key={s.pill}
              className="flex items-start gap-8 p-8"
              style={{ background: 'var(--color-canvas)' }}
            >
              <span
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold"
                style={{
                  background: 'var(--color-surface-strong)',
                  color: 'var(--color-muted)',
                  fontFamily: "'CursorGothic', sans-serif",
                }}
              >
                0{i + 1}
              </span>

              <div className="flex-1 min-w-0">
                <span
                  className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full mb-3 ${s.pillColor}`}
                  style={{
                    letterSpacing: '0.88px',
                    textTransform: 'uppercase',
                    fontFamily: "'CursorGothic', sans-serif",
                  }}
                >
                  {s.pill}
                </span>

                <h3
                  className="mb-2"
                  style={{
                    fontFamily: "'CursorGothic', sans-serif",
                    fontSize: '22px',
                    fontWeight: 400,
                    letterSpacing: '-0.11px',
                    color: 'var(--color-ink)',
                  }}
                >
                  {s.title}
                </h3>
                <p
                  style={{
                    fontFamily: "'CursorGothic', sans-serif",
                    fontSize: '16px',
                    lineHeight: 1.5,
                    color: 'var(--color-body)',
                    maxWidth: '480px',
                  }}
                >
                  {s.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Divider ── */}
      <div style={{ height: '1px', background: 'var(--color-hairline)', margin: '0 32px' }} />

      {/* ── CTA band ── */}
      <section
        className="max-w-5xl mx-auto text-center"
        style={{ padding: '96px 32px' }}
      >
        <h2
          className="mb-8"
          style={{
            fontFamily: "'CursorGothic', sans-serif",
            fontSize: 'clamp(28px, 4vw, 40px)',
            fontWeight: 400,
            letterSpacing: '-0.72px',
            color: 'var(--color-ink)',
          }}
        >
          Your room is the demo.
        </h2>
        <button
          type="button"
          onClick={openStudio}
          className="transition-all duration-150 cursor-pointer hover:opacity-90 active:scale-[0.98] inline-flex items-center"
          style={{
            background: 'var(--color-primary)',
            color: 'var(--color-on-primary)',
            fontFamily: "'CursorGothic', sans-serif",
            fontSize: '14px',
            fontWeight: 500,
            padding: '10px 24px',
            height: '40px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
          }}
        >
          Try Homie — it&apos;s free
        </button>
      </section>

      {/* ── Footer ── */}
      <footer
        className="border-t px-8 py-10 flex items-center justify-between flex-wrap gap-4"
        style={{
          borderColor: 'var(--color-hairline)',
          fontFamily: "'CursorGothic', sans-serif",
          fontSize: '13px',
          color: 'var(--color-muted)',
        }}
      >
        <span>Homie</span>
        <span>Cursor Physical AI Hackathon · Almaty 2026</span>
      </footer>
    </main>
  );
}
