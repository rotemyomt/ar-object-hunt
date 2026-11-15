/**
 * Socket.IO event contract between client and server.
 *
 * Implemented: time sync (Phase 1); rooms, membership, camera/registration status,
 * readiness, server-scheduled match start, reconnection and rematch (Phase 2).
 * Detection submission is added in Phase 4.
 */
import type { CameraStatus, PlayerSlot, RoomState } from "./types.js";

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: ErrorCode; message: string };
export type Ack<T> = (response: AckResult<T>) => void;

export type ErrorCode =
  | "BAD_REQUEST"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_IN_ROOM"
  | "INVALID_PHASE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "INTERNAL";

export interface SessionCredentials {
  roomCode: string;
  slot: PlayerSlot;
  /** Opaque secret issued by the server on create/join; proves room membership on reconnect. */
  sessionToken: string;
}

/**
 * What a player registers. The descriptor is a compact visual signature produced on the
 * device (Phase 3: embedding + colour signature). The server never sees images; it only
 * stores this vector for the match and relays it to the opponent, who must find it.
 */
export interface ObjectRegistration {
  /** Detector category, e.g. "bottle". */
  label: string;
  /** Visual signature. Bounded length; finite numbers only. */
  descriptor: number[];
  /** Number of reference views captured (multi-angle registration). */
  views: number;
}

/** 4 header values + up to 6 views × (1280 embedding + 36 colour). */
export const DESCRIPTOR_MAX_LENGTH = 8192;
export const LABEL_MAX_LENGTH = 40;

/** Sent privately to each player when a match is scheduled: what they must hunt. */
export interface MatchTarget {
  round: number;
  /** The opponent's registered object. */
  target: ObjectRegistration;
  /** Your own object — the recogniser uses it to make sure you can't win with it. */
  own: ObjectRegistration;
}

/**
 * A device's claim that it has confirmed the opponent's object. The server re-checks
 * everything it can without seeing video: match phase & round, timing against its own
 * clock, that the box was outside the sweep obstruction at that moment, multi-frame
 * evidence, score margins over the player's own object, and category consistency.
 */
export interface DetectionReport {
  round: number;
  /** Estimated server time (ms) at which the confirming frame was captured. */
  at: number;
  label: string;
  /** Normalised on-screen box of the confirmed detection. */
  box: { x: number; y: number; w: number; h: number };
  /** CSS-pixel size of the camera viewport (needed to re-compute the sweep geometry). */
  view: { width: number; height: number };
  score: number;
  ownScore: number;
  hits: number;
}

/** Late detections captured before the end may still arrive this long after it. */
export const DETECTION_GRACE_MS = 750;

export type RoomClosedReason = "idle" | "host_left" | "server_shutdown";

export interface ServerToClientEvents {
  "server:hello": (info: { serverTime: number; version: string }) => void;
  "room:state": (state: RoomState) => void;
  "room:closed": (info: { reason: RoomClosedReason }) => void;
  "match:target": (target: MatchTarget) => void;
}

export interface ClientToServerEvents {
  /** NTP-style ping: client sends its local send time, server replies with its clock. */
  "time:sync": (clientSentAt: number, ack: (serverTime: number) => void) => void;

  "room:create": (req: { name: string }, ack: Ack<SessionCredentials & { state: RoomState }>) => void;
  "room:join": (req: { code: string; name: string }, ack: Ack<SessionCredentials & { state: RoomState }>) => void;
  "room:resume": (req: SessionCredentials, ack: Ack<{ state: RoomState; target: MatchTarget | null }>) => void;
  "room:leave": (ack?: Ack<null>) => void;
  "player:camera": (status: CameraStatus) => void;
  "object:register": (reg: ObjectRegistration, ack: Ack<{ state: RoomState }>) => void;
  "object:clear": (ack: Ack<{ state: RoomState }>) => void;
  "player:ready": (ready: boolean, ack: Ack<{ state: RoomState }>) => void;
  "match:rematch": (ack: Ack<{ state: RoomState }>) => void;
  "match:detect": (report: DetectionReport, ack: Ack<{ accepted: boolean; reason?: string; state: RoomState }>) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: string;
  slot?: PlayerSlot;
}
