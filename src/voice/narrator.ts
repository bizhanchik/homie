// The narrator facade: ONE Narrator that auto-picks an implementation.
// connect() tries the OpenAI Realtime (WebRTC) narrator first; on ANY failure —
// mock mode, no key, denied mic, network — it transparently falls back to the
// zero-key local speechSynthesis narrator. The UI only ever talks to this facade
// and reads `state` ('live' = Realtime, 'fallback' = browser).
//
// To flip Realtime ON for the demo: drop OPENAI_API_KEY into .env.local and
// reload — the /api/realtime-session route then mints a token instead of
// returning { ok:false, error:'mock-mode' }, and connect() lands on 'live'.

import { NarratorBase, type Narrator, type NarratorState } from './base';
import { RealtimeNarrator } from './realtime';
import { LocalNarrator } from './local';

export type { Narrator, NarratorState } from './base';
export { speechRecognitionSupported } from './local';

class FacadeNarrator extends NarratorBase {
  private impl: Narrator | null = null;
  private connecting = false;

  private bind(impl: Narrator): void {
    this.impl = impl;
    impl.onStateChange((s) => this.setState(s));
    impl.onCommand((u) => this.emitCommand(u));
    this.setState(impl.state); // sync current after binding future changes
  }

  async connect(): Promise<void> {
    if (this.impl || this.connecting) return;
    this.connecting = true;
    this.setState('connecting');
    try {
      // 1. Try Realtime. Bind only AFTER a clean connect so a failed attempt's
      //    transient states don't leak to the UI.
      const rt = new RealtimeNarrator();
      try {
        await rt.connect();
        this.bind(rt);
        return;
      } catch {
        try {
          rt.disconnect();
        } catch {
          /* ignore */
        }
      }
      // 2. Fall back to the local narrator (always succeeds -> 'fallback').
      const local = new LocalNarrator();
      await local.connect();
      this.bind(local);
    } finally {
      this.connecting = false;
    }
  }

  disconnect(): void {
    const impl = this.impl;
    this.impl = null;
    try {
      impl?.disconnect();
    } catch {
      /* ignore */
    }
    this.setState('off');
  }

  speak(text: string): void {
    this.impl?.speak(text);
  }

  async setMicEnabled(on: boolean): Promise<void> {
    await this.impl?.setMicEnabled(on);
  }
}

export function createNarrator(): Narrator {
  return new FacadeNarrator();
}
