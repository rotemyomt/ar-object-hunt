/**
 * Vibration feedback. Supported on Android Chrome / Samsung Internet; iOS Safari has no
 * Vibration API, so calls are silently ignored there.
 */
export const HAPTICS = {
  tap: 10,
  success: [20, 40, 30],
  ready: [30, 60, 30],
  tick: 25,
  go: [60, 40, 120],
  warning: [15, 85, 15],
  victory: [50, 50, 50, 50, 200],
  defeat: [300],
  error: [80, 50, 80],
} as const satisfies Record<string, number | readonly number[]>;

let enabled = true;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

export function haptic(kind: keyof typeof HAPTICS) {
  if (!enabled || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    const p = HAPTICS[kind];
    navigator.vibrate(typeof p === "number" ? p : [...p]);
  } catch {
    /* some browsers throw if called without user activation */
  }
}

export const hapticsSupported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
