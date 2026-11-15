/**
 * Socket.IO event contract between client and server.
 *
 * Phase 1 implements `time:sync` (used for server-clock estimation) and `server:hello`.
 * The remaining events are the agreed contract that Phase 2+ implements; they are typed
 * here now so both sides compile against a single source of truth.
 */
import type { CameraStatus, PlayerSlot, RoomState } from "./types.js";

export type Ack<T> = (response: { ok: true; data: T } | { ok: false; error: ErrorCode; message: string }) => void;

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

export interface ServerToClientEvents {
  "server:hello": (info: { serverTime: number; version: string }) => void;
  "room:state": (state: RoomState) => void;
  "room:closed": (info: { reason: "idle" | "host_left" | "server_shutdown" }) => void;
}

export interface ClientToServerEvents {
  /** NTP-style ping: client sends its local send time, server replies with its clock. */
  "time:sync": (clientSentAt: number, ack: (serverTime: number) => void) => void;

  // ---- Phase 2: rooms & readiness ----
  "room:create": (req: { name: string }, ack: Ack<SessionCredentials & { state: RoomState }>) => void;
  "room:join": (req: { code: string; name: string }, ack: Ack<SessionCredentials & { state: RoomState }>) => void;
  "room:resume": (req: SessionCredentials, ack: Ack<{ state: RoomState }>) => void;
  "room:leave": () => void;
  "player:camera": (status: CameraStatus) => void;
  "player:ready": (ready: boolean, ack: Ack<{ state: RoomState }>) => void;
  "match:rematch": (ack: Ack<{ state: RoomState }>) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: string;
  slot?: PlayerSlot;
}
