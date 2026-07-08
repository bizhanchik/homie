'use client';

import QRCode from 'react-qr-code';

export type QrPairingStatus = 'connecting' | 'waiting' | 'received';

export type QrPairingProps = {
  status: QrPairingStatus;
  mobileUrl: string;
};

export function QrPairing({ status, mobileUrl }: QrPairingProps) {
  const received = status === 'received';

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-2xl bg-white p-4" style={{ boxShadow: '0 1px 4px rgba(38,37,30,0.10)' }}>
        <QRCode
          value={mobileUrl}
          size={192}
          level="M"
          bgColor="#ffffff"
          fgColor="#26251e"
          style={{ height: 'auto', maxWidth: '100%', width: 192 }}
        />
      </div>

      <div
        className="max-w-[16rem] break-all text-center font-mono text-xs"
        style={{ color: 'var(--color-muted)', fontFamily: 'monospace' }}
      >
        {mobileUrl}
      </div>

      <div className="flex items-center gap-2 text-sm" style={{ fontFamily: "'CursorGothic', sans-serif" }}>
        {received ? (
          <>
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-primary)' }} />
            <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
              Scan received ✓
            </span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: 'var(--color-primary)' }} />
            <span style={{ color: 'var(--color-muted)' }}>
              {status === 'connecting' ? 'Connecting…' : 'Waiting for your scan…'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default QrPairing;
