// Homie's voice via OpenAI Realtime over WebRTC (GA surface, openai@6).
//
// Handshake (verified against node_modules/openai realtime resources — the SDK
// exposes the SERVER pieces: client.realtime.clientSecrets.create for the
// ephemeral token, and client.realtime.calls.* for SIP; there is NO browser
// WebRTC helper, so we drive RTCPeerConnection ourselves):
//   1. POST /api/realtime-session -> { ok, data:{ clientSecret, model } }.
//      In mock mode this returns { ok:false, error:'mock-mode' } -> we throw ->
//      the facade falls back to the local speechSynthesis narrator. Expected.
//   2. new RTCPeerConnection; attach remote audio track to a hidden <audio>.
//   3. getUserMedia mic track added but DISABLED until setMicEnabled(true).
//   4. data channel 'oai-events' for events in/out.
//   5. POST the SDP offer to https://api.openai.com/v1/realtime/calls?model=<m>
//      with Authorization: Bearer <ephemeral> + Content-Type: application/sdp,
//      falling back to the older /v1/realtime?model=<m> on 404. Answer SDP ->
//      setRemoteDescription.
//
// speak(): enqueue, one at a time — conversation.item.create (user message
// 'NARRATE: <line>') + response.create instructing a verbatim readback; wait for
// the matching response.done before the next line. VAD turns do NOT auto-respond
// (create_response:false) so Homie never improvises or echo-loops.
//
// Echo safety: the mic is auto-muted while the speak() queue is draining plus a
// 500ms tail. For the live demo prefer push-to-talk (toggle the mic only while
// giving a command) — see the mic button.

import type { ApiResult } from '@/lib/types';
import { NarratorBase } from './base';

type SessionData = { clientSecret: string; model: string; expiresAt?: number };

const OPENAI_REALTIME_GA = 'https://api.openai.com/v1/realtime/calls';
const OPENAI_REALTIME_LEGACY = 'https://api.openai.com/v1/realtime';
const CONNECT_TIMEOUT_MS = 12000;
const MIC_TAIL_MS = 500;

// Minimal shape of the Realtime events we act on (the wire has many more).
type RealtimeEvent = {
  type: string;
  transcript?: string;
  response?: { id?: string };
  error?: { message?: string } | string;
};

export class RealtimeNarrator extends NarratorBase {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private micStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;

  // speak() queue — never overlapping.
  private queue: string[] = [];
  private speaking = false;
  private activeResponseId: string | null = null;

  // Echo safety.
  private userMicEnabled = false;
  private suppressMic = false; // true while speaking + tail
  private tailTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(): Promise<void> {
    if (this.pc) return;
    this.setState('connecting');
    try {
      const session = await this.fetchSession();
      await this.openPeer(session);
    } catch (e) {
      this.teardown();
      this.setState('off'); // hand back a clean slate; facade will fall back
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  private async fetchSession(): Promise<SessionData> {
    const res = await fetch('/api/realtime-session', { method: 'POST' });
    const data = (await res.json()) as ApiResult<SessionData>;
    if (!data.ok) throw new Error(`realtime-session: ${data.error}`);
    if (!data.data?.clientSecret) throw new Error('realtime-session: no client secret');
    return data.data;
  }

  private async openPeer(session: SessionData): Promise<void> {
    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Remote audio -> hidden <audio>. (Headless has no speakers; audio still
    // decodes — verification spies speak() calls, not sound.)
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', '');
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    this.audioEl = audioEl;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0] ?? null;
    };

    // Mic in — added but disabled until setMicEnabled(true). If the user denies
    // the mic we still want to RECEIVE Homie's voice, so add a recvonly line.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micStream = stream;
      const track = stream.getAudioTracks()[0] ?? null;
      if (track) {
        track.enabled = false;
        this.micTrack = track;
        pc.addTrack(track, stream);
      } else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
    } catch {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onmessage = (e) => this.onEvent(e);
    dc.onopen = () => {
      this.configureSession();
      this.setState('live');
      this.drain(); // flush anything queued before we went live
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if ((st === 'failed' || st === 'closed') && this._state !== 'off') {
        this.setState('error');
      }
    };

    // Offer -> exchange SDP -> answer.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const answerSdp = await this.exchangeSdp(
      session.clientSecret,
      session.model,
      offer.sdp ?? '',
    );
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    // Guard against a wedged handshake (SDP ok but data channel never opens).
    await this.waitForLive();
  }

  private waitForLive(): Promise<void> {
    if (this.dc?.readyState === 'open') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      // dc.onopen flips state; poll cheaply as a backstop. Always tear down BOTH
      // timers on any exit so a timed-out connect doesn't leak a polling loop.
      const iv = setInterval(() => {
        if (this.dc?.readyState === 'open') {
          cleanup();
          resolve();
        } else if (this.pc?.connectionState === 'failed') {
          cleanup();
          reject(new Error('realtime peer connection failed'));
        }
      }, 150);
      const t = setTimeout(() => {
        cleanup();
        reject(new Error('realtime connect timed out'));
      }, CONNECT_TIMEOUT_MS);
      const cleanup = () => {
        clearInterval(iv);
        clearTimeout(t);
      };
    });
  }

  private async exchangeSdp(secret: string, model: string, sdp: string): Promise<string> {
    const post = (base: string) =>
      fetch(`${base}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        body: sdp,
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/sdp',
        },
      });

    let res = await post(OPENAI_REALTIME_GA);
    if (res.status === 404) res = await post(OPENAI_REALTIME_LEGACY);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SDP exchange HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.text();
  }

  // Ensure the session never auto-responds to a VAD turn: we drive every spoken
  // response explicitly via response.create, so create_response must be false or
  // Homie will improvise and echo-loop off its own audio.
  private configureSession(): void {
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        audio: {
          input: {
            turn_detection: {
              type: 'server_vad',
              create_response: false,
              interrupt_response: false,
            },
            transcription: { model: 'gpt-4o-mini-transcribe' },
          },
        },
      },
    });
  }

  private send(obj: unknown): void {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(obj));
    }
  }

  private onEvent(e: MessageEvent): void {
    let msg: RealtimeEvent;
    try {
      msg = JSON.parse(e.data as string) as RealtimeEvent;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'response.created':
        if (this.speaking) this.activeResponseId = msg.response?.id ?? null;
        break;
      case 'response.done': {
        if (!this.speaking) break;
        const id = msg.response?.id;
        // Only advance on OUR response (ignore any stray auto-response).
        if (this.activeResponseId && id && id !== this.activeResponseId) break;
        this.speaking = false;
        this.activeResponseId = null;
        this.drain();
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) this.emitCommand(msg.transcript);
        break;
      case 'error': {
        const detail =
          typeof msg.error === 'string' ? msg.error : msg.error?.message ?? 'unknown';
        // eslint-disable-next-line no-console
        console.warn('[homie/realtime] event error:', detail);
        break;
      }
      default:
        break;
    }
  }

  speak(text: string): void {
    const line = text.trim();
    if (!line) return;
    this.queue.push(line);
    this.drain();
  }

  private drain(): void {
    if (this.speaking) return;
    if (!this.dc || this.dc.readyState !== 'open') return; // flushed on dc.onopen
    const next = this.queue.shift();
    if (next === undefined) {
      this.endSpeechTail();
      return;
    }
    this.speaking = true;
    this.activeResponseId = null;
    this.beginSpeech();

    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `NARRATE: ${next}` }],
      },
    });
    this.send({
      type: 'response.create',
      response: {
        instructions:
          'Say exactly the narration line, verbatim, in an energetic little-robot ' +
          `vibe. Do not add, drop, or reorder any words: ${next}`,
      },
    });
  }

  // --- echo safety: mute mic while speaking + a short tail ------------------
  private beginSpeech(): void {
    this.suppressMic = true;
    if (this.tailTimer) {
      clearTimeout(this.tailTimer);
      this.tailTimer = null;
    }
    this.syncMic();
  }

  private endSpeechTail(): void {
    if (this.speaking || this.queue.length > 0) return;
    if (this.tailTimer) clearTimeout(this.tailTimer);
    this.tailTimer = setTimeout(() => {
      this.suppressMic = false;
      this.syncMic();
    }, MIC_TAIL_MS);
  }

  private syncMic(): void {
    if (this.micTrack) this.micTrack.enabled = this.userMicEnabled && !this.suppressMic;
  }

  async setMicEnabled(on: boolean): Promise<void> {
    this.userMicEnabled = on;
    // Mic must have been granted at connect() to be in the SDP; if it wasn't,
    // there is no track to toggle (renegotiation isn't supported here). The
    // button still reflects intent; narration keeps working.
    this.syncMic();
  }

  disconnect(): void {
    this.teardown();
    this.setState('off');
  }

  private teardown(): void {
    if (this.tailTimer) {
      clearTimeout(this.tailTimer);
      this.tailTimer = null;
    }
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    this.dc = null;
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micTrack = null;
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
    this.queue = [];
    this.speaking = false;
    this.activeResponseId = null;
    this.suppressMic = false;
    this.userMicEnabled = false;
  }
}
