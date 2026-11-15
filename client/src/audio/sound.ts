/**
 * Synthesized sound effects via the Web Audio API — no audio files to download, works
 * offline, and latency is a few ms. Browsers (iOS especially) only allow audio after a
 * user gesture, so `unlock()` is called from the first tap (splash screen) and on every
 * pointerdown until it succeeds.
 */
export type SoundName =
  | "click"
  | "back"
  | "join"
  | "registered"
  | "ready"
  | "tick"
  | "go"
  | "sweep"
  | "warning"
  | "victory"
  | "defeat"
  | "error";

interface Note {
  /** Frequency in Hz (end frequency for glides via `to`). */
  f: number;
  to?: number;
  /** Start offset and duration, seconds. */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

const SOUNDS: Record<SoundName, Note[]> = {
  click: [{ f: 1400, to: 900, at: 0, dur: 0.05, type: "square", gain: 0.08 }],
  back: [{ f: 700, to: 420, at: 0, dur: 0.07, type: "square", gain: 0.07 }],
  join: [
    { f: 520, at: 0, dur: 0.09, type: "triangle" },
    { f: 780, at: 0.09, dur: 0.14, type: "triangle" },
  ],
  registered: [
    { f: 660, at: 0, dur: 0.08, type: "sine" },
    { f: 990, at: 0.08, dur: 0.08, type: "sine" },
    { f: 1320, at: 0.16, dur: 0.18, type: "sine" },
  ],
  ready: [
    { f: 440, at: 0, dur: 0.1, type: "sawtooth", gain: 0.08 },
    { f: 880, at: 0.1, dur: 0.2, type: "sawtooth", gain: 0.08 },
  ],
  tick: [{ f: 880, at: 0, dur: 0.12, type: "square", gain: 0.1 }],
  go: [
    { f: 440, to: 1760, at: 0, dur: 0.35, type: "sawtooth", gain: 0.12 },
    { f: 1760, at: 0.35, dur: 0.25, type: "square", gain: 0.08 },
  ],
  sweep: [{ f: 220, to: 330, at: 0, dur: 0.6, type: "sine", gain: 0.05 }],
  warning: [
    { f: 1000, at: 0, dur: 0.08, type: "square", gain: 0.09 },
    { f: 1000, at: 0.14, dur: 0.08, type: "square", gain: 0.09 },
  ],
  victory: [
    { f: 523, at: 0, dur: 0.14, type: "triangle" },
    { f: 659, at: 0.14, dur: 0.14, type: "triangle" },
    { f: 784, at: 0.28, dur: 0.14, type: "triangle" },
    { f: 1047, at: 0.42, dur: 0.5, type: "triangle" },
  ],
  defeat: [
    { f: 392, at: 0, dur: 0.22, type: "sawtooth", gain: 0.08 },
    { f: 330, at: 0.22, dur: 0.22, type: "sawtooth", gain: 0.08 },
    { f: 262, to: 196, at: 0.44, dur: 0.6, type: "sawtooth", gain: 0.08 },
  ],
  error: [{ f: 200, at: 0, dur: 0.18, type: "square", gain: 0.08 }],
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Call from inside a user gesture handler. Safe to call repeatedly. */
  unlock(): void {
    const ctx = this.ensure();
    if (!ctx || ctx.state === "running") return;
    void ctx.resume();
    // iOS needs a sound started inside the gesture to fully unlock output.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  get unlocked(): boolean {
    return this.ctx?.state === "running";
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.01);
  }

  play(name: SoundName): void {
    if (this.muted) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.master) return;
    const t0 = ctx.currentTime + 0.005;
    for (const n of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.setValueAtTime(n.f, t0 + n.at);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.at + n.dur);
      const peak = n.gain ?? 0.12;
      g.gain.setValueAtTime(0.0001, t0 + n.at);
      g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.connect(g).connect(this.master);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  }
}

export const sound = new SoundEngine();

if (typeof window !== "undefined") {
  const tryUnlock = () => {
    sound.unlock();
    if (sound.unlocked) window.removeEventListener("pointerdown", tryUnlock, true);
  };
  window.addEventListener("pointerdown", tryUnlock, true);
}
