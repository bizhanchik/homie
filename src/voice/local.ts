// Zero-key fallback narrator: the browser speaks and listens with no OpenAI key.
//   speak()          -> SpeechSynthesisUtterance, queued via onend (never overlaps)
//   setMicEnabled()  -> Web Speech API (webkitSpeechRecognition / SpeechRecognition)
// State is always 'fallback' once connected. If SpeechRecognition is missing the
// mic button is shown disabled with a "Voice input needs Chrome" tooltip (the UI
// checks speechRecognitionSupported()).

import { NarratorBase } from './base';

// Minimal typings for the non-standard Web Speech API (not in lib.dom).
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

const MIC_TAIL_MS = 500;
const RESTART_DELAY_MS = 250;

export class LocalNarrator extends NarratorBase {
  private queue: string[] = [];
  private speaking = false;
  private voice: SpeechSynthesisVoice | null = null;

  private userMicEnabled = false;
  private recognition: SpeechRecognitionLike | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressUntil = 0; // don't listen until this time (echo tail)

  async connect(): Promise<void> {
    this.loadVoice();
    this.setState('fallback');
  }

  private loadVoice(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const pick = () => {
      const voices = synth.getVoices();
      this.voice = voices.find((v) => /^en/i.test(v.lang)) ?? voices[0] ?? null;
    };
    pick();
    // getVoices() is often empty until 'voiceschanged' fires.
    if (!this.voice) synth.onvoiceschanged = pick;
  }

  speak(text: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const line = text.trim();
    if (!line) return;
    this.queue.push(line);
    this.drain();
  }

  private drain(): void {
    if (this.speaking) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.speaking = true;
    // Echo safety: stop listening while Homie talks so TTS isn't transcribed.
    this.suppressRecognition();

    const u = new SpeechSynthesisUtterance(next);
    // Guard: a stale/invalid voice object must never break narration.
    if (this.voice) {
      try {
        u.voice = this.voice;
      } catch {
        /* keep the default voice */
      }
    }
    u.rate = 1.05;
    const done = () => {
      this.speaking = false;
      this.afterSpeech();
      this.drain();
    };
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  private afterSpeech(): void {
    if (this.speaking || this.queue.length > 0) return;
    // 500ms tail before we resume listening.
    this.suppressUntil = Date.now() + MIC_TAIL_MS;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (this.userMicEnabled) this.startRecognition();
    }, MIC_TAIL_MS);
  }

  private suppressRecognition(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
    }
  }

  async setMicEnabled(on: boolean): Promise<void> {
    this.userMicEnabled = on;
    if (on) {
      if (!speechRecognitionSupported()) return; // UI shows the disabled tooltip
      if (!this.speaking && Date.now() >= this.suppressUntil) this.startRecognition();
    } else {
      this.stopRecognition();
    }
  }

  private startRecognition(): void {
    if (!this.userMicEnabled || this.speaking) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
    }
    const rec = new Ctor();
    rec.continuous = false; // one phrase per turn; we restart on end
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript ?? '';
      if (t) this.emitCommand(t);
    };
    rec.onend = () => {
      if (
        this.userMicEnabled &&
        !this.speaking &&
        Date.now() >= this.suppressUntil
      ) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.startRecognition(), RESTART_DELAY_MS);
      }
    };
    rec.onerror = () => {
      /* onend fires next; restart logic there */
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch {
      /* start() throws if already started; ignore */
    }
  }

  private stopRecognition(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
      this.recognition = null;
    }
  }

  disconnect(): void {
    this.stopRecognition();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.queue = [];
    this.speaking = false;
    this.userMicEnabled = false;
    this.setState('off');
  }
}
