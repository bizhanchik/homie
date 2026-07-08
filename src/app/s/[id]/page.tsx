'use client';

// The Homie studio — the demo screen. Left: the live 3D room (RoomViewer).
// Right: what Homie sees (LabelsPanel) and what it plans (PlanPanel). Bottom:
// the task bar. Empty until a room arrives — via the sample room, a picked
// .glb file, or a dragged-in .glb.

import { use, useCallback, useEffect, useRef, useState } from 'react';
import RoomViewer, { type RoomViewerHandle } from '@/components/RoomViewer';
import LabelsPanel from '@/components/LabelsPanel';
import PlanPanel from '@/components/PlanPanel';
import TaskBar from '@/components/TaskBar';
import OrderModal from '@/components/OrderModal';
import VoiceButton from '@/components/VoiceButton';
import HistoryPanel from '@/components/HistoryPanel';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [roomLoaded, setRoomLoaded] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [obstacleMode, setObstacleMode] = useState<'add' | 'remove' | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);

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

  // Direct file picker — the primary way to bring in a room.
  const pickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileChosen = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow picking the same file again
      if (!file) return;
      file
        .arrayBuffer()
        .then((buf) => doLoadRoom(buf))
        .catch((err) =>
          setLoadError(err instanceof Error ? err.message : String(err)),
        );
    },
    [doLoadRoom],
  );

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

  const onObstacleAdded = useCallback((at: { x: number; z: number }, id: string) => {
    // Viewer already drew the box; pass its id so the agent only stamps the grid.
    agentRef.current.addObstacle(at, id);
  }, []);

  const onObstacleRemoved = useCallback((id: string) => {
    agentRef.current.removeObstacle(id);
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

  const [visionMode, setVisionMode] = useState<'gpt4o' | 'sam2'>('gpt4o');
  const toggleVisionMode = useCallback(() => {
    setVisionMode((prev) => {
      const next = prev === 'gpt4o' ? 'sam2' : 'gpt4o';
      agentRef.current.setVisionMode(next);
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
    <div
      className="flex h-screen flex-col"
      style={{ background: 'var(--color-canvas)', color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
    >
      {/* ---- Header ---- */}
      <header
        className="flex h-14 shrink-0 items-center justify-between px-4"
        style={{ borderBottom: '1px solid var(--color-hairline)', background: 'var(--color-canvas)' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-lg font-semibold tracking-tight"
            style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
          >
            Homie
          </span>
          <span
            className="rounded-full px-2.5 py-0.5 font-mono text-[11px]"
            style={{
              border: '1px solid var(--color-hairline)',
              background: 'var(--color-surface-card)',
              color: 'var(--color-muted)',
            }}
          >
            {sessionId}
          </span>
        </div>
        <div className="flex items-center gap-2">
        </div>
      </header>

      {/* ---- Main: viewer + sidebar ---- */}
      <div className="flex min-h-0 flex-1">
        {/* Viewer area */}
        <main className={`relative min-h-0 flex-1 ${obstacleMode === 'add' ? 'cursor-crosshair' : obstacleMode === 'remove' ? 'cursor-pointer' : ''}`}>
          <RoomViewer
            ref={viewerRef}
            className="h-full w-full"
            onReady={onReady}
            obstacleMode={obstacleMode === 'add'}
            obstacleRemoveMode={obstacleMode === 'remove'}
            onObstacleAdded={onObstacleAdded}
            onObstacleRemoved={onObstacleRemoved}
          />

          {/* Toolbar (top-left) */}
          {roomLoaded && (
            <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
              {/* Add obstacle button */}
              <button
                type="button"
                onClick={() => setObstacleMode((m) => (m === 'add' ? null : 'add'))}
                className="pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium backdrop-blur transition cursor-pointer"
                style={{
                  border: obstacleMode === 'add' ? '1px solid rgba(239,68,68,0.6)' : '1px solid var(--color-hairline-strong)',
                  background: obstacleMode === 'add' ? 'rgba(239,68,68,0.08)' : 'rgba(247,247,244,0.88)',
                  color: obstacleMode === 'add' ? '#dc2626' : 'var(--color-ink)',
                  fontFamily: "'CursorGothic', sans-serif",
                }}
              >
                <span className="text-sm">⛔</span>
                {obstacleMode === 'add' ? 'Click floor to place' : 'Add obstacle'}
              </button>

              {/* Remove obstacle button */}
              <button
                type="button"
                onClick={() => setObstacleMode((m) => (m === 'remove' ? null : 'remove'))}
                className="pointer-events-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium backdrop-blur transition cursor-pointer"
                style={{
                  border: obstacleMode === 'remove' ? '1px solid rgba(239,68,68,0.6)' : '1px solid var(--color-hairline-strong)',
                  background: obstacleMode === 'remove' ? 'rgba(239,68,68,0.08)' : 'rgba(247,247,244,0.88)',
                  color: obstacleMode === 'remove' ? '#dc2626' : 'var(--color-ink)',
                  fontFamily: "'CursorGothic', sans-serif",
                }}
              >
                <span className="text-sm">✕</span>
                {obstacleMode === 'remove' ? 'Click obstacle to remove' : 'Remove obstacle'}
              </button>

              {obstacleMode && (
                <span
                  className="pointer-events-none max-w-[12rem] rounded-lg px-3 py-1.5 text-[11px] backdrop-blur"
                  style={{ background: 'rgba(247,247,244,0.88)', color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif" }}
                >
                  {obstacleMode === 'add'
                    ? "Click anywhere on the floor to place a red block."
                    : "Click a red block to erase it."}
                </span>
              )}
            </div>
          )}

          {/* State ribbon (top-center) */}
          {roomLoaded && stateLabel && (
            <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1">
              <div
                className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm backdrop-blur"
                style={{
                  border: '1px solid var(--color-hairline-strong)',
                  background: 'rgba(247,247,244,0.90)',
                  color: 'var(--color-ink)',
                  fontFamily: "'CursorGothic', sans-serif",
                }}
              >
                <span
                  className={`h-2 w-2 rounded-full${busy ? ' animate-pulse' : ''}`}
                  style={{ background: agent.state === 'error' ? '#ef4444' : 'var(--color-primary)' }}
                />
                {stateLabel}
              </div>
              {latestNarration && (
                <div
                  className="max-w-xs truncate rounded-full px-3 py-1 text-xs backdrop-blur"
                  style={{ background: 'rgba(247,247,244,0.80)', color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif" }}
                >
                  &quot;{latestNarration}&quot;
                </div>
              )}
            </div>
          )}

          {/* Error toast */}
          {error && (
            <div
              className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg backdrop-blur"
              style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(255,245,245,0.92)', color: '#dc2626', fontFamily: "'CursorGothic', sans-serif" }}
            >
              {error}
            </div>
          )}

          {/* Empty state overlay */}
          {showEmpty && (
            <div
              className="absolute inset-0 z-30 flex items-center justify-center backdrop-blur-sm"
              style={{ background: 'rgba(247,247,244,0.75)' }}
            >
              {loadingRoom ? (
                <div className="flex flex-col items-center gap-3" style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif" }}>
                  <span
                    className="h-8 w-8 animate-spin rounded-full border-2"
                    style={{ borderColor: 'var(--color-hairline-strong)', borderTopColor: 'var(--color-primary)' }}
                  />
                  <span className="text-sm">Loading your room…</span>
                </div>
              ) : (
                <div
                  className="flex w-full max-w-sm flex-col items-center rounded-2xl p-8"
                  style={{ border: '1px solid var(--color-hairline)', background: 'var(--color-surface-card)', boxShadow: '0 4px 24px rgba(38,37,30,0.08)' }}
                >
                  <h2
                    className="mb-1 text-lg font-semibold"
                    style={{ color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
                  >
                    Bring in your room
                  </h2>
                  <p className="mb-6 text-center text-sm" style={{ color: 'var(--color-muted)', fontFamily: "'CursorGothic', sans-serif" }}>
                    Upload the .glb you scanned with your iPhone.
                  </p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".glb,model/gltf-binary"
                    className="sr-only"
                    onChange={onFileChosen}
                  />
                  <button
                    type="button"
                    onClick={pickFile}
                    className="w-full rounded-xl py-3 text-sm font-semibold transition hover:opacity-90 cursor-pointer"
                    style={{ background: 'var(--color-ink)', color: 'var(--color-canvas)', fontFamily: "'CursorGothic', sans-serif", border: 'none' }}
                  >
                    Upload room scan (.glb)
                  </button>

                  <div className="my-6 flex w-full items-center gap-3 text-xs" style={{ color: 'var(--color-muted-soft)', fontFamily: "'CursorGothic', sans-serif" }}>
                    <span className="h-px flex-1" style={{ background: 'var(--color-hairline)' }} />
                    or
                    <span className="h-px flex-1" style={{ background: 'var(--color-hairline)' }} />
                  </div>

                  <button
                    type="button"
                    onClick={loadSample}
                    className="w-full rounded-xl py-2.5 text-sm font-medium transition hover:opacity-70 cursor-pointer"
                    style={{ border: '1px solid var(--color-hairline-strong)', background: 'var(--color-canvas)', color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif" }}
                  >
                    Load sample room
                  </button>
                  <p className="mt-3 text-center text-xs" style={{ color: 'var(--color-muted-soft)', fontFamily: "'CursorGothic', sans-serif" }}>
                    …or drag a .glb file anywhere onto this window.
                  </p>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside
          className="flex w-80 shrink-0 flex-col"
          style={{ borderLeft: '1px solid var(--color-hairline)', background: 'var(--color-canvas)' }}
        >
          <LabelsPanel scene={agent.scene} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PlanPanel plan={agent.plan} currentStepIndex={agent.currentStepIndex} />
          </div>
          <HistoryPanel
            history={agent.history}
            isReplaying={agent.isReplaying}
            onReplay={(rec) => agentRef.current.replayRun(rec)}
          />
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
        <div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
          style={{ border: '3px dashed var(--color-primary)', background: 'rgba(245,78,0,0.05)' }}
        >
          <span
            className="rounded-xl px-6 py-3 text-lg font-medium"
            style={{ background: 'var(--color-surface-card)', color: 'var(--color-ink)', fontFamily: "'CursorGothic', sans-serif", border: '1px solid var(--color-hairline)' }}
          >
            Drop your .glb to load the room
          </span>
        </div>
      )}

      <OrderModal open={orderOpen} onClose={() => setOrderOpen(false)} />
    </div>
  );
}
