/**
 * Core domain types. These describe the server-authoritative match state that every
 * client renders. Clients never decide match outcomes; they only submit evidence.
 */

export type PlayerSlot = 1 | 2;

export type MatchPhase =
  | "lobby" // waiting for players / registration
  | "ready_check" // both registered, waiting for both "I'm Ready"
  | "countdown" // server has fixed the start time; 3-2-1 running
  | "playing" // 60-second hunt
  | "finished"; // result decided

export type CameraStatus = "unknown" | "granted" | "denied" | "unavailable";

export interface PlayerState {
  slot: PlayerSlot;
  name: string;
  connected: boolean;
  cameraStatus: CameraStatus;
  objectRegistered: boolean;
  /** Human-readable label of the registered object (e.g. "bottle"); never the visual signature. */
  objectLabel: string | null;
  ready: boolean;
}

export type MatchOutcome =
  | { kind: "win"; winner: PlayerSlot; reason: "detection" | "opponent_forfeit" }
  | { kind: "timeout" };

export interface RoomState {
  code: string;
  phase: MatchPhase;
  players: Partial<Record<PlayerSlot, PlayerState>>;
  /** Server epoch ms at which the countdown begins (phase countdown/playing). */
  countdownStartsAt: number | null;
  /** Server epoch ms at which the 60-second hunt begins (= countdownStartsAt + COUNTDOWN_MS). */
  matchStartsAt: number | null;
  /** Server epoch ms at which the hunt ends. */
  matchEndsAt: number | null;
  outcome: MatchOutcome | null;
  /** Monotonically increasing; lets clients discard stale snapshots after reconnects. */
  version: number;
  /** Incremented on each rematch so late events from a previous round are rejected. */
  round: number;
}
