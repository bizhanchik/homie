'use client';

// Presentational QR pairing panel for the desktop Studio. Pure props in, no
// data fetching — Studio wires `status`/`mobileUrl` from useScanSync. Renders a
// scannable QR (white quiet-zone padding so phones read it against the dark UI)
// plus a status line.
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
      <div className="rounded-2xl bg-white p-4 shadow-lg">
        <QRCode
          value={mobileUrl}
          size={192}
          level="M"
          bgColor="#ffffff"
          fgColor="#0a0a0a"
          // Let the SVG scale down responsively without overflowing its box.
          style={{ height: 'auto', maxWidth: '100%', width: 192 }}
        />
      </div>

      <div className="max-w-[16rem] break-all text-center font-mono text-xs text-neutral-500">
        {mobileUrl}
      </div>

      <div className="flex items-center gap-2 text-sm">
        {received ? (
          <>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-medium text-emerald-400">
              Scan received ✓
            </span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-neutral-400">
              {status === 'connecting'
                ? 'Connecting…'
                : 'Waiting for your scan…'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default QrPairing;
