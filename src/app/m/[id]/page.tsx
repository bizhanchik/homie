'use client';

// Mobile upload page. The phone lands here from the desktop QR code, picks the
// GLB it exported from Scaniverse, and uploads it straight to /api/scan/[id].
// Dark, thumb-first, one job. Next 16: read the dynamic param with use(params).
import { use, useState } from 'react';

// One file input, referenced by both triggers via htmlFor. It is visually
// hidden with the sr-only pattern (NOT display:none) on purpose: a `<label>`
// pointing at a rendered input opens the native picker on iOS Safari, Android,
// and desktop. Calling input.click() on a display:none input silently fails on
// mobile Safari — which is the bug this replaces.
const FILE_INPUT_ID = 'homie-glb-input';

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; pct: number }
  | { phase: 'done'; size: number }
  | { phase: 'error'; message: string };

export default function MobileScanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const [fileName, setFileName] = useState<string | null>(null);

  const isUploading = state.phase === 'uploading';

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again re-triggers change.
    e.target.value = '';
    if (!file) return;
    setFileName(file.name);
    upload(file);
  }

  function upload(file: File) {
    setState({ phase: 'uploading', pct: 0 });

    // XMLHttpRequest (not fetch) so we get real upload progress events.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/scan/${id}`);
    xhr.setRequestHeader('Content-Type', 'model/gltf-binary');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setState({ phase: 'uploading', pct });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText) as {
            ok: boolean;
            data?: { size: number };
            error?: string;
          };
          if (res.ok && res.data) {
            setState({ phase: 'done', size: res.data.size });
            return;
          }
          setState({ phase: 'error', message: res.error ?? 'Upload rejected' });
        } catch {
          setState({ phase: 'error', message: 'Bad server response' });
        }
      } else {
        setState({ phase: 'error', message: `Upload failed (${xhr.status})` });
      }
    };

    xhr.onerror = () =>
      setState({ phase: 'error', message: 'Network error — try again' });

    xhr.send(file);
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 flex flex-col items-center px-6 py-10 select-none">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        {/* Wordmark */}
        <div className="flex items-center gap-2 pt-4">
          <span className="text-2xl font-semibold tracking-tight">Homie</span>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>

        {/* Step hints */}
        <ol className="w-full space-y-2 text-sm text-neutral-400">
          <li>
            <span className="text-emerald-400">1.</span> Scan your room in
            Scaniverse
          </li>
          <li>
            <span className="text-emerald-400">2.</span> Export → GLB → Save to
            Files
          </li>
          <li>
            <span className="text-emerald-400">3.</span> Tap below and pick that
            file
          </li>
        </ol>

        {/* Rendered (sr-only), not display:none, so label activation opens the
            native picker reliably on mobile Safari. Disabled while uploading so
            the labels below become inert without extra JS. */}
        <input
          id={FILE_INPUT_ID}
          type="file"
          accept=".glb,model/gltf-binary"
          className="sr-only"
          onChange={onFile}
          disabled={isUploading}
        />

        {state.phase === 'done' ? (
          <div className="w-full flex flex-col items-center gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-10 text-center">
            <div className="text-5xl">✓</div>
            <div className="text-lg font-medium text-emerald-300">
              Scan beamed to the big screen
            </div>
            <div className="text-xs text-neutral-400">
              {fileName ? `${fileName} · ` : ''}
              {formatBytes(state.size)}
            </div>
            <label
              htmlFor={FILE_INPUT_ID}
              className="mt-2 cursor-pointer text-sm text-neutral-400 underline underline-offset-4 active:text-neutral-200"
            >
              Send a different scan
            </label>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center gap-5">
            <label
              htmlFor={FILE_INPUT_ID}
              aria-disabled={isUploading}
              className={`w-full select-none rounded-2xl bg-emerald-500 px-6 py-6 text-center text-lg font-semibold text-neutral-950 shadow-lg shadow-emerald-500/20 transition ${
                isUploading
                  ? 'cursor-default opacity-60'
                  : 'cursor-pointer active:scale-[0.98] active:bg-emerald-400'
              }`}
            >
              {isUploading ? 'Uploading…' : 'Choose GLB file'}
            </label>

            {isUploading && (
              <div className="w-full">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-[width] duration-150"
                    style={{ width: `${state.pct}%` }}
                  />
                </div>
                <div className="mt-2 text-center text-xs text-neutral-500">
                  {state.pct}%{fileName ? ` · ${fileName}` : ''}
                </div>
              </div>
            )}

            {state.phase === 'error' && (
              <div className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
                {state.message}
              </div>
            )}

            {state.phase === 'idle' && (
              <p className="text-center text-xs text-neutral-600">
                Accepts .glb exported from Scaniverse
              </p>
            )}
          </div>
        )}

        <div className="mt-auto pt-6 text-[10px] uppercase tracking-widest text-neutral-700">
          session {id}
        </div>
      </div>
    </main>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
