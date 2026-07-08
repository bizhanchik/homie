// Shared voice-narrator seam. Two impls (Realtime over WebRTC, and a zero-key
// speechSynthesis fallback) implement ONE interface so the studio UI never cares
// which one is live. Kept in its own file so narrator.ts (the facade) and the two
// impls can all import `NarratorBase` without a circular import.

export type NarratorState = 'off' | 'connecting' | 'live' | 'fallback' | 'error';

export type Narrator = {
  readonly state: NarratorState;
  /** Try Realtime; on ANY failure the facade transparently falls back. */
  connect(): Promise<void>;
  disconnect(): void;
  /** Queued; lines never overlap. */
  speak(text: string): void;
  setMicEnabled(on: boolean): Promise<void>;
  /** User speech (a spoken task command) -> utterance text. */
  onCommand(fn: (utterance: string) => void): void;
  onStateChange(fn: (s: NarratorState) => void): void;
};

/**
 * Common listener + state plumbing shared by every Narrator implementation
 * (Realtime, local fallback, and the facade). Subclasses drive `setState` and
 * `emitCommand`; everything else is provided.
 */
export abstract class NarratorBase implements Narrator {
  protected _state: NarratorState = 'off';
  private stateFns = new Set<(s: NarratorState) => void>();
  private commandFns = new Set<(u: string) => void>();

  get state(): NarratorState {
    return this._state;
  }

  protected setState(s: NarratorState): void {
    if (this._state === s) return;
    this._state = s;
    for (const fn of this.stateFns) {
      try {
        fn(s);
      } catch {
        /* a listener throwing must not break the narrator */
      }
    }
  }

  protected emitCommand(utterance: string): void {
    const t = utterance.trim();
    if (!t) return;
    for (const fn of this.commandFns) {
      try {
        fn(t);
      } catch {
        /* ignore */
      }
    }
  }

  onStateChange(fn: (s: NarratorState) => void): void {
    this.stateFns.add(fn);
  }

  onCommand(fn: (u: string) => void): void {
    this.commandFns.add(fn);
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract speak(text: string): void;
  abstract setMicEnabled(on: boolean): Promise<void>;
}
