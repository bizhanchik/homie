'use client';

// The business beat: order the real Homie One. Presentational modal with a
// stylized SVG robot (no external assets), spec sheet, price, and a one-click
// order that flips to a confirmation state. Esc / backdrop close.

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
      className="h-28 w-28 drop-shadow-[0_0_24px_rgba(52,211,153,0.35)]"
      role="img"
      aria-label="Homie One robot"
    >
      {/* antenna */}
      <line x1="60" y1="20" x2="60" y2="34" stroke="#34d399" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="16" r="5" fill="#34d399" />
      {/* head */}
      <rect x="28" y="32" width="64" height="48" rx="16" fill="#171717" stroke="#34d399" strokeWidth="2.5" />
      {/* eyes */}
      <circle cx="47" cy="56" r="7" fill="#34d399" />
      <circle cx="73" cy="56" r="7" fill="#34d399" />
      <circle cx="47" cy="56" r="2.5" fill="#052e2b" />
      <circle cx="73" cy="56" r="2.5" fill="#052e2b" />
      {/* smile */}
      <path d="M48 70 Q60 78 72 70" stroke="#34d399" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* body / base */}
      <rect x="38" y="84" width="44" height="22" rx="10" fill="#171717" stroke="#3f3f46" strokeWidth="2" />
      <rect x="50" y="90" width="20" height="4" rx="2" fill="#34d399" opacity="0.8" />
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

  // Reset the confirmation state each time the modal reopens.
  useEffect(() => {
    if (open) setOrdered(false);
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
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
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
        >
          ✕
        </button>

        {ordered ? (
          <div className="flex flex-col items-center bg-gradient-to-b from-emerald-500/10 to-transparent px-8 py-12 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl text-emerald-400 shadow-lg shadow-emerald-500/20 ring-4 ring-emerald-500/10">
              ✓
            </div>
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-100">
              You&apos;re in line!
            </h3>
            <p className="mt-1.5 text-sm font-medium text-emerald-400">
              Order #HMI-0042 confirmed.
            </p>
            <p className="mt-4 max-w-xs text-sm text-neutral-400">
              Your room map ships with it — Homie knows your home on day one.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 rounded-xl border border-neutral-700 px-5 py-2.5 text-sm font-medium text-neutral-200 transition hover:border-neutral-500"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center bg-gradient-to-b from-emerald-500/10 to-transparent px-8 pt-10 pb-6">
              <RobotGlyph />
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-neutral-100">
                Homie One
              </h3>
              <p className="mt-1 text-sm text-neutral-400">
                The home robot that already knows your home.
              </p>
            </div>

            <div className="px-8 pb-8">
              <ul className="mb-6 grid grid-cols-2 gap-2">
                {SPECS.map((s) => (
                  <li
                    key={s}
                    className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-xs text-neutral-300"
                  >
                    <span className="text-emerald-400">✓</span>
                    {s}
                  </li>
                ))}
              </ul>

              <div className="mb-5 flex items-end justify-between border-t border-neutral-800 pt-5">
                <div className="flex flex-col">
                  <span className="text-xs uppercase tracking-wide text-neutral-500">
                    One-time
                  </span>
                  <span className="text-4xl font-bold tracking-tight text-white">
                    $1,499
                  </span>
                </div>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                  Ships Q1 2027
                </span>
              </div>

              <button
                type="button"
                onClick={placeOrder}
                className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:bg-emerald-400"
              >
                Order Homie — Reserve yours
              </button>
              <p className="mt-3 text-center text-xs text-neutral-500">
                Free to reserve · cancel anytime
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
