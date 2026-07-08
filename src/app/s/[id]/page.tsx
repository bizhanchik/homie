'use client';

// The Homie studio — the demo screen. Left: the live 3D room (RoomViewer).
// Right: what Homie sees (LabelsPanel) and what it plans (PlanPanel). Bottom:
// the task bar. Empty until a room arrives — via phone scan (QR), the sample
// room, or a dragged-in .glb.

import { use, useCallback, useEffect, useRef, useState } from 'react';
import RoomViewer, { type RoomViewerHandle } from '@/components/RoomViewer';
import QrPairing from '@/components/QrPairing';
import LabelsPanel from '@/components/LabelsPanel';
import PlanPanel from '@/components/PlanPanel';
import TaskBar from '@/components/TaskBar';
import OrderModal from '@/components/OrderModal';
import VoiceButton from '@/components/VoiceButton';
import { useScanSync } from '@/lib/use-scan-sync';
import { useHomieAgent } from '@/sim/use-homie-agent';
import type { AgentState } from '@/lib/types';
import {
  createNarrator,
  speechRecognitionSupported,
  type Narrator,
  type NarratorState,
} from '@/voice/narrator';

const STATE_LABEL: Record<AgentState, string | null> = {
  idle: null,
  awaiting_scan: 'Waiting for your scan…',
  scene_ready: 'Room ready',
  labeling: 'Understanding your room…',
  planning: 'Thinking…',
  executing: 'On the move…',
  blocked: 'Obstacle! Replanning…',
  replanning: 'Replanning route…',
  done: 'Task complete',
  error: 'Something went wrong',
};

const BUSY_STATES: AgentState[] = [
  'labeling',
  'planning',
  'executing',
  'blocked',
  'replanning',
];

export default function StudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);

  const scan = useScanSync(sessionId);

  // Homie's voice. Created once (client-only) in an effect below; narration
  // events from the agent are spoken through it. Held in a ref so the agent's
  // onNarration callback can reach it without re-subscribing.
  const narratorRef = useRef<Narrator | null>(null);
  const [voiceState, setVoiceState] = useState<NarratorState>('off');
  const [micEnabled, setMicEnabled] = useState(false);
  const [injectedTask, setInjectedTask] = useState<{ text: string; nonce: number } | null>(
    null,
  );

  const agent = useHomieAgent({
    onNarration: (e) => narratorRef.current?.speak(e.text),
  });

  // Latest agent in a ref so the file-load callbacks stay stable.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const viewerRef = useRef<RoomViewerHandle>(null);
  const loadingRef = useRef(false);
  const autoLoadedRef = useRef(false);

  const [roomLoaded, setRoomLoaded] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [obstacleMode, setObstacleMode] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  // useScanSync derives mobileUrl from window.location.origin, so the QR content
  // differs between server and client. Gate it behind mount to avoid a hydration
  // mismatch (the whole studio is client-only anyway).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ---- Room loading -------------------------------------------------------
  const doLoadRoom = useCallback(async (glb: ArrayBuffer) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingRoom(true);
    setLoadError(null);
    try {
      await agentRef.current.loadRoom(glb);
      setRoomLoaded(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRoom(false);
      loadingRef.current = false;
    }
  }, []);

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch('/sample-room.glb');
      if (!res.ok) throw new Error(`Could not fetch sample room (${res.status})`);
      const buf = await res.arrayBuffer();
      await doLoadRoom(buf);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [doLoadRoom]);

  // Attach the viewer to the agent as soon as the canvas is ready.
  const onReady = useCallback(() => {
    if (viewerRef.current) agentRef.current.attachViewer(viewerRef.current);
  }, []);

  // Auto-load once the phone beams a scan up.
  useEffect(() => {
    if (scan.status !== 'received' || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    scan
      .fetchScan()
      .then((buf) => doLoadRoom(buf))
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : String(e)),
      );
  }, [scan.status, scan, doLoadRoom]);

  // Full-window drag & drop of a .glb file.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (file.name.endsWith('.glb') || file.name.endsWith('.gltf')) {
        file
          .arrayBuffer()
          .then((buf) => doLoadRoom(buf))
          .catch((err) =>
            setLoadError(err instanceof Error ? err.message : String(err)),
          );
      } else {
        setLoadError('Please drop a .glb file.');
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [doLoadRoom]);

  const runTask = useCallback((task: string) => {
    void agentRef.current.runTask(task);
  }, []);

  const onObstacleAdded = useCallback((at: { x: number; z: number }) => {
    agentRef.current.addObstacle(at);
  }, []);

  // ---- Voice: spoken commands -> tasks ------------------------------------
  const roomLoadedRef = useRef(false);
  const voiceNonceRef = useRef(0);

  const handleVoiceCommand = useCallback((utterance: string) => {
    const text = utterance.trim();
    if (!text) return;
    // "stop" always cuts through — cancels the current run safely.
    if (/\bstop\b/i.test(text)) {
      agentRef.current.reset();
      return;
    }
    // Ignore new commands while Homie is planning/executing, or before a room
    // exists (guard: never queue a task on top of an in-flight one).
    if (BUSY_STATES.includes(agentRef.current.state) || !roomLoadedRef.current) return;
    voiceNonceRef.current += 1;
    setInjectedTask({ text, nonce: voiceNonceRef.current });
    void agentRef.current.runTask(text);
  }, []);
  const handleVoiceCommandRef = useRef(handleVoiceCommand);
  handleVoiceCommandRef.current = handleVoiceCommand;

  // Create the narrator once (client-only) and wire its events.
  useEffect(() => {
    const n = createNarrator();
    narratorRef.current = n;
    n.onStateChange((s) => setVoiceState(s));
    n.onCommand((u) => handleVoiceCommandRef.current(u));
    // Dev/manual-test affordance: drive the live narrator from the console, e.g.
    //   window.__homieNarrator.speak('hello')  /  .setMicEnabled(true)
    (window as unknown as { __homieNarrator?: Narrator }).__homieNarrator = n;
    return () => {
      n.disconnect();
      narratorRef.current = null;
    };
  }, []);

  // Drop the mic whenever voice isn't in a connected state.
  useEffect(() => {
    const connected = voiceState === 'live' || voiceState === 'fallback';
    if (!connected && micEnabled) {
      setMicEnabled(false);
      void narratorRef.current?.setMicEnabled(false);
    }
  }, [voiceState, micEnabled]);

  const toggleVoice = useCallback(() => {
    const n = narratorRef.current;
    if (!n) return;
    if (n.state === 'off' || n.state === 'error') void n.connect();
    else n.disconnect();
  }, []);

  const toggleMic = useCallback(() => {
    const n = narratorRef.current;
    if (!n) return;
    setMicEnabled((prev) => {
      const next = !prev;
      void n.setMicEnabled(next);
      return next;
    });
  }, []);

  const stateLabel = STATE_LABEL[agent.state];
  const busy = BUSY_STATES.includes(agent.state);
  const latestNarration =
    agent.narration.length > 0
      ? agent.narration[agent.narration.length - 1].text
      : null;
  const error = agent.error ?? loadError;

  const showEmpty = !roomLoaded;
  roomLoadedRef.current = roomLoaded;

  const voiceConnected = voiceState === 'live' || voiceState === 'fallback';
  const micSupported =
    voiceState === 'live' || (voiceState === 'fallback' && speechRecognitionSupported());

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      {/* ---- Header ---- */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 px-4">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight text-white">
            Homie
          </span>
          <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-0.5 font-mono text-[11px] text-neutral-400">
            {sessionId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* voice-button-slot */}
          <VoiceButton state={voiceState} onToggle={toggleVoice} />
          <button
            type="button"
            onClick={() => setOrderOpen(true)}
            className="rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400"
          >
            Order Homie
          </button>
        </div>
      </header>

      {/* ---- Main: viewer + sidebar ---- */}
      <div className="flex min-h-0 flex-1">
        {/* Viewer area */}
        <main
          className={`relative min-h-0 flex-1 ${
            obstacleMode ? 'cursor-crosshair' : ''
          }`}
        >
          <RoomViewer
            ref={viewerRef}
            className="h-full w-full"
            onReady={onReady}
            obstacleMode={obstacleMode}
            onObstacleAdded={onObstacleAdded}
          />

          {/* Toolbar (top-left) */}
          {roomLoaded && (
            <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setObstacleMode((m) => !m)}
                className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur transition ${
                  obstacleMode
                    ? 'border-red-500/70 bg-red-500/15 text-red-300'
                    : 'border-neutral-700 bg-neutral-900/80 text-neutral-300 hover:border-neutral-500'
                }`}
              >
                <span className="text-sm">⛔</span>
                {obstacleMode ? 'Click floor to drop' : 'Drop obstacle'}
              </button>
              {obstacleMode && (
                <span className="pointer-events-none max-w-[12rem] rounded-lg bg-neutral-900/80 px-3 py-1.5 text-[11px] text-neutral-400 backdrop-blur">
                  Click anywhere on the floor to place an obstacle in Homie&apos;s
                  path.
                </span>
              )}
            </div>
          )}

          {/* State ribbon (top-center) */}
          {roomLoaded && stateLabel && (
            <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1">
              <div className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/85 px-3.5 py-1.5 text-sm text-neutral-200 backdrop-blur">
                <span
                  className={`h-2 w-2 rounded-full ${
                    agent.state === 'error'
                      ? 'bg-red-400'
                      : busy
                        ? 'animate-pulse bg-emerald-400'
                        : 'bg-emerald-400'
                  }`}
                />
                {stateLabel}
              </div>
              {latestNarration && (
                <div className="max-w-xs truncate rounded-full bg-neutral-900/70 px-3 py-1 text-xs text-neutral-400 backdrop-blur">
                  “{latestNarration}”
                </div>
              )}
            </div>
          )}

          {/* Error toast */}
          {error && (
            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-red-500/50 bg-red-950/80 px-4 py-2 text-sm text-red-200 shadow-lg backdrop-blur">
              {error}
            </div>
          )}

          {/* Empty state overlay */}
          {showEmpty && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm">
              {loadingRoom ? (
                <div className="flex flex-col items-center gap-3 text-neutral-300">
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-emerald-400" />
                  <span className="text-sm">Loading your room…</span>
                </div>
              ) : (
                <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-neutral-800 bg-neutral-900/70 p-8">
                  <h2 className="mb-1 text-lg font-semibold text-neutral-100">
                    Bring in your room
                  </h2>
                  <p className="mb-6 text-center text-sm text-neutral-400">
                    Scan with your iPhone to beam a room up.
                  </p>

                  {mounted ? (
                    <QrPairing status={scan.status} mobileUrl={scan.mobileUrl} />
                  ) : (
                    <div className="flex flex-col items-center gap-4">
                      <div className="flex h-[224px] w-[224px] items-center justify-center rounded-2xl bg-white shadow-lg">
                        <span className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
                      </div>
                      <span className="text-sm text-neutral-400">
                        Preparing your pairing code…
                      </span>
                    </div>
                  )}

                  <div className="my-6 flex w-full items-center gap-3 text-xs text-neutral-600">
                    <span className="h-px flex-1 bg-neutral-800" />
                    or
                    <span className="h-px flex-1 bg-neutral-800" />
                  </div>

                  <button
                    type="button"
                    onClick={loadSample}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-800/60 py-2.5 text-sm font-medium text-neutral-100 transition hover:border-emerald-500/60 hover:text-emerald-300"
                  >
                    Load sample room
                  </button>
                  <p className="mt-3 text-center text-xs text-neutral-600">
                    …or drag a .glb file anywhere onto this window.
                  </p>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
          <LabelsPanel scene={agent.scene} />
          <div className="min-h-0 flex-1">
            <PlanPanel
              plan={agent.plan}
              currentStepIndex={agent.currentStepIndex}
            />
          </div>
        </aside>
      </div>

      {/* ---- Task bar ---- */}
      <TaskBar
        onRun={runTask}
        disabled={!roomLoaded}
        busy={busy}
        mic={{
          connected: voiceConnected,
          enabled: micEnabled,
          supported: micSupported,
          onToggle: toggleMic,
        }}
        injectedTask={injectedTask}
      />

      {/* ---- Full-window drag highlight ---- */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-emerald-500/70 bg-emerald-500/10">
          <span className="rounded-xl bg-neutral-950/90 px-6 py-3 text-lg font-medium text-emerald-300">
            Drop your .glb to load the room
          </span>
        </div>
      )}

      <OrderModal open={orderOpen} onClose={() => setOrderOpen(false)} />
    </div>
  );
}
