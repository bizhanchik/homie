'use client';

import { useEffect, useState } from 'react';

const SPECS = [
  'LiDAR navigation',
  '2-hour battery',
  'Self-docking',
  'Works with your scanned map',
];

function RobotGlyph() {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-28 w-28"
      role="img"
      aria-label="Homie One robot"
    >
      <line x1="60" y1="20" x2="60" y2="34" stroke="#f54e00" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="16" r="5" fill="#f54e00" />
      <rect x="28" y="32" width="64" height="48" rx="16" fill="#f7f7f4" stroke="#f54e00" strokeWidth="2.5" />
      <circle cx="47" cy="56" r="7" fill="#f54e00" />
      <circle cx="73" cy="56" r="7" fill="#f54e00" />
      <circle cx="47" cy="56" r="2.5" fill="#26251e" />
      <circle cx="73" cy="56" r="2.5" fill="#26251e" />
      <path d="M48 70 Q60 78 72 70" stroke="#f54e00" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="38" y="84" width="44" height="22" rx="10" fill="#f7f7f4" stroke="#e5e4df" strokeWidth="2" />
      <rect x="50" y="90" width="20" height="4" rx="2" fill="#f54e00" opacity="0.8" />
    </svg>
  );
}

export default function OrderModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [ordered, setOrdered] = useState(false);

  useEffect(() => {
    if (open) setOrdered(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const placeOrder = () => {
    const payload = {
      product: 'Homie One',
      sku: 'HMI-ONE',
      price: 1499,
      currency: 'USD',
      ships: 'Q1 2027',
      orderId: 'HMI-0042',
      placedAt: new Date().toISOString(),
    };
    console.log('[Homie] order placed', payload);
    setOrdered(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Order Homie One"
    >
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'rgba(38,37,30,0.45)' }} onClick={onClose} />

      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl shadow-2xl"
        style={{ border: '1px solid var(--color-hairline)', background: 'var(--color-surface-card)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full transition cursor-pointer"
          style={{ color: 'var(--color-muted)', background: 'transparent' }}
        >
          ✕
        </button>

        {ordered ? (
          <div className="flex flex-col items-center px-8 py-12 text-center">
            <div
              className="mb-5 flex h-16 w-16 items-center justify-center rounded-full text-3xl"
              style={{ background: 'rgba(245,78,0,0.10)', color: 'var(--color-primary)', border: '4px solid rgba(245,78,0,0.12)' }}
            >
              ✓
            </div>
            <h3
              className="text-2xl font-semibold tracking-tight"
              style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
            >
              You&apos;re in line!
            </h3>
            <p className="mt-1.5 text-sm font-medium" style={{ color: 'var(--color-primary)', fontFamily: "'CursorGothic', sans-serif" }}>
              Order #HMI-0042 confirmed.
            </p>
            <p className="mt-4 max-w-xs text-sm" style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif" }}>
              Your room map ships with it — Homie knows your home on day one.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 rounded-xl px-5 py-2.5 text-sm font-medium transition hover:opacity-70 cursor-pointer"
              style={{ border: '1px solid var(--color-hairline-strong)', color: 'var(--color-ink)', background: 'transparent', fontFamily: "'CursorGothic', sans-serif" }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div
              className="flex flex-col items-center px-8 pt-10 pb-6"
              style={{ borderBottom: '1px solid var(--color-hairline)' }}
            >
              <RobotGlyph />
              <h3
                className="mt-4 text-2xl font-semibold tracking-tight"
                style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif", letterSpacing: '-0.5px' }}
              >
                Homie One
              </h3>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif" }}>
                The home robot that already knows your home.
              </p>
            </div>

            <div className="px-8 pb-8 pt-6">
              <ul className="mb-6 grid grid-cols-2 gap-2">
                {SPECS.map((s) => (
                  <li
                    key={s}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                    style={{ border: '1px solid var(--color-hairline)', background: 'var(--color-canvas)', color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
                  >
                    <span style={{ color: 'var(--color-primary)' }}>✓</span>
                    {s}
                  </li>
                ))}
              </ul>

              <div
                className="mb-5 flex items-end justify-between pt-5"
                style={{ borderTop: '1px solid var(--color-hairline)' }}
              >
                <div className="flex flex-col">
                  <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif", letterSpacing: '0.88px' }}>
                    One-time
                  </span>
                  <span
                    className="text-4xl font-bold tracking-tight"
                    style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
                  >
                    $1,499
                  </span>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{ border: '1px solid rgba(245,78,0,0.25)', background: 'rgba(245,78,0,0.07)', color: 'var(--color-primary)', fontFamily: "'CursorGothic', sans-serif" }}
                >
                  Ships Q1 2027
                </span>
              </div>

              <button
                type="button"
                onClick={placeOrder}
                className="w-full rounded-xl py-3.5 text-sm font-semibold transition hover:opacity-90 active:scale-[0.99] cursor-pointer"
                style={{ background: 'var(--color-primary)', color: '#fff', fontFamily: "'CursorGothic', sans-serif", border: 'none' }}
              >
                Order Homie — Reserve yours
              </button>
              <p className="mt-3 text-center text-xs" style={{ color: 'var(--color-muted-soft)', fontFamily: "'CursorGothic', sans-serif" }}>
                Free to reserve · cancel anytime
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
