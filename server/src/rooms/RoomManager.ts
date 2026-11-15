import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  COUNTDOWN_MS,
  EMPTY_ROOM_TTL_MS,
  MATCH_DISCONNECT_GRACE_MS,
  MATCH_DURATION_MS,
  START_LEAD_MS,
  generateRoomCode,
  DETECTION_GRACE_MS,
  LOOKALIKE_WARNING,
  angleForCoveredFraction,
  decodeDescriptor,
  objectSimilarity,
  obstructionProgress,
  sameGroup,
  visibleFractionOfBox,
  type DetectionReport,
  type CameraStatus,
  type ErrorCode,
  type MatchOutcome,
  type MatchPhase,
  type MatchTarget,
  type ObjectRegistration,
  type PlayerSlot,
  type RoomClosedReason,
  type RoomState,
} from "@aoh/shared";

/** A rule violation the client is told about (never a crash). */
export class GameError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface Player {
  slot: PlayerSlot;
  name: string;
  token: string;
  socketId: string | null;
  disconnectedAt: number | null;
  cameraStatus: CameraStatus;
  registration: ObjectRegistration | null;
  ready: boolean;
}

interface Room {
  code: string;
  phase: MatchPhase;
  players: Map<PlayerSlot, Player>;
  countdownStartsAt: number | null;
  matchStartsAt: number | null;
  matchEndsAt: number | null;
  outcome: MatchOutcome | null;
  version: number;
  round: number;
  lastActivity: number;
  timers: Set<ReturnType<typeof setTimeout>>;
  lookalike: boolean;
}

export interface Timing {
  startLeadMs: number;
  countdownMs: number;
  matchDurationMs: number;
  disconnectGraceMs: number;
  emptyRoomTtlMs: number;
  idleTimeoutMs: number;
}

export const DEFAULT_TIMING: Timing = {
  startLeadMs: START_LEAD_MS,
  countdownMs: COUNTDOWN_MS,
  matchDurationMs: MATCH_DURATION_MS,
  disconnectGraceMs: MATCH_DISCONNECT_GRACE_MS,
  emptyRoomTtlMs: EMPTY_ROOM_TTL_MS,
  idleTimeoutMs: 15 * 60_000,
};

/** Callbacks the networking layer implements to push changes to sockets. */
export interface RoomEvents {
  stateChanged(code: string, state: RoomState): void;
  targetsAssigned(code: string, targets: Array<{ socketId: string | null; target: MatchTarget }>): void;
  roomClosed(code: string, reason: RoomClosedReason, socketIds: string[]): void;
}

const other = (slot: PlayerSlot): PlayerSlot => (slot === 1 ? 2 : 1);

export function sanitizeName(raw: unknown, slot: PlayerSlot, max = 16): string {
  const s = typeof raw === "string" ? raw : "";
  // Strip control characters and collapse whitespace; names are rendered as text, never HTML.
  const clean = s
    .replace(/\s+/g, " ") // newlines/tabs become spaces first
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
  return Array.from(clean).slice(0, max).join("") || `Player ${slot}`;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Server-authoritative room & match state machine.
 *
 *   lobby ──(both present & registered)──▶ ready_check ──(both ready)──▶ countdown
 *     ▲                                        │                             │ (timer)
 *     └──────(player leaves / clears object)───┘                          playing
 *                                                                           │ (timer / win / forfeit)
 *   lobby/ready_check ◀───────────(rematch)─────────────────────────── finished
 *
 * All timestamps are the server's clock. Clients render from `RoomState` and never
 * decide transitions themselves.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly events: RoomEvents,
    private readonly timing: Timing = DEFAULT_TIMING,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- lifecycle

  startSweeper(intervalMs = 30_000) {
    this.sweepTimer ??= setInterval(() => this.sweep(), intervalMs);
    this.sweepTimer.unref?.();
  }

  dispose() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
  }

  get roomCount() {
    return this.rooms.size;
  }

  /** Close idle or abandoned rooms. */
  sweep() {
    const t = this.now();
    for (const room of [...this.rooms.values()]) {
      const live = room.phase === "countdown" || room.phase === "playing";
      const anyoneConnected = [...room.players.values()].some((p) => p.socketId !== null);
      if (!live && !anyoneConnected && t - room.lastActivity > this.timing.emptyRoomTtlMs) this.close(room, "idle");
      else if (!live && t - room.lastActivity > this.timing.idleTimeoutMs) this.close(room, "idle");
    }
  }

  // ---------------------------------------------------------------- membership

  create(name: unknown, socketId: string) {
    let code = "";
    for (let i = 0; i < 50 && (!code || this.rooms.has(code)); i++) code = generateRoomCode(randomInt);
    if (this.rooms.has(code)) throw new GameError("INTERNAL", "Could not allocate a room code");
    const room: Room = {
      code,
      phase: "lobby",
      players: new Map(),
      countdownStartsAt: null,
      matchStartsAt: null,
      matchEndsAt: null,
      outcome: null,
      version: 0,
      round: 1,
      lastActivity: this.now(),
      timers: new Set(),
      lookalike: false,
    };
    this.rooms.set(code, room);
    const player = this.addPlayer(room, 1, name, socketId);
    this.changed(room);
    return { roomCode: code, slot: player.slot, sessionToken: player.token, state: this.toState(room) };
  }

  join(code: string, name: unknown, socketId: string) {
    const room = this.rooms.get(code);
    if (!room) throw new GameError("ROOM_NOT_FOUND", "No game with that code. Check the code with the host.");
    if (room.players.has(2)) throw new GameError("ROOM_FULL", "This game already has two players.");
    if (room.phase !== "lobby") throw new GameError("INVALID_PHASE", "This game has already started.");
    const player = this.addPlayer(room, 2, name, socketId);
    this.changed(room);
    return { roomCode: code, slot: player.slot, sessionToken: player.token, state: this.toState(room) };
  }

  /** Re-bind a returning device (reload, network switch) using its session token. */
  resume(code: string, slot: PlayerSlot, token: string, socketId: string) {
    const room = this.rooms.get(code);
    const player = room?.players.get(slot);
    if (!room || !player || !safeEqual(player.token, token)) {
      throw new GameError("UNAUTHORIZED", "That game session has ended.");
    }
    const previousSocket = player.socketId;
    player.socketId = socketId;
    player.disconnectedAt = null;
    this.changed(room);
    return { state: this.toState(room), target: this.targetFor(room, slot), previousSocket };
  }

  /** Socket dropped. The seat is kept; during a live match a forfeit timer starts. */
  disconnect(code: string, slot: PlayerSlot, socketId: string) {
    const room = this.rooms.get(code);
    const player = room?.players.get(slot);
    if (!room || !player || player.socketId !== socketId) return; // stale socket (already replaced)
    player.socketId = null;
    player.disconnectedAt = this.now();
    if (room.phase === "countdown" || room.phase === "playing") {
      const since = player.disconnectedAt;
      this.schedule(room, this.timing.disconnectGraceMs, () => {
        const p = room.players.get(slot);
        if (p && p.socketId === null && p.disconnectedAt === since && (room.phase === "countdown" || room.phase === "playing")) {
          const opponent = room.players.get(other(slot));
          if (opponent && opponent.socketId !== null) this.finish(room, { kind: "win", winner: opponent.slot, reason: "opponent_forfeit" });
          else this.finish(room, { kind: "timeout" });
        }
      });
    }
    this.changed(room);
  }

  /** Deliberate exit. Host leaving closes the room; guest leaving frees the seat. */
  leave(code: string, slot: PlayerSlot) {
    const room = this.rooms.get(code);
    if (!room || !room.players.has(slot)) return;
    if (room.phase === "countdown" || room.phase === "playing") {
      this.finish(room, { kind: "win", winner: other(slot), reason: "opponent_forfeit" });
    }
    if (slot === 1) {
      room.players.delete(1);
      this.close(room, "host_left");
      return;
    }
    room.players.delete(slot);
    if (room.phase !== "finished") this.resetToLobby(room);
    this.changed(room);
  }

  // ---------------------------------------------------------------- player status

  setCamera(code: string, slot: PlayerSlot, status: CameraStatus) {
    const { room, player } = this.member(code, slot);
    if (player.cameraStatus === status) return this.toState(room);
    player.cameraStatus = status;
    this.changed(room);
    return this.toState(room);
  }

  register(code: string, slot: PlayerSlot, reg: ObjectRegistration) {
    const { room, player } = this.member(code, slot);
    if (room.phase !== "lobby" && room.phase !== "ready_check") {
      throw new GameError("INVALID_PHASE", "Objects can only be registered before the match starts.");
    }
    player.registration = reg;
    // A new object invalidates both players' readiness.
    for (const p of room.players.values()) p.ready = false;
    this.advanceFromLobby(room);
    this.changed(room);
    return this.toState(room);
  }

  clearRegistration(code: string, slot: PlayerSlot) {
    const { room, player } = this.member(code, slot);
    if (room.phase !== "lobby" && room.phase !== "ready_check") throw new GameError("INVALID_PHASE", "Match in progress.");
    player.registration = null;
    this.resetToLobby(room);
    this.changed(room);
    return this.toState(room);
  }

  setReady(code: string, slot: PlayerSlot, ready: boolean) {
    const { room, player } = this.member(code, slot);
    if (room.phase !== "ready_check") {
      throw new GameError("INVALID_PHASE", "Both players must register their objects first.");
    }
    player.ready = ready;
    const players = [...room.players.values()];
    if (players.length === 2 && players.every((p) => p.ready && p.socketId !== null)) this.scheduleMatch(room);
    this.changed(room);
    return this.toState(room);
  }

  rematch(code: string, slot: PlayerSlot) {
    const { room } = this.member(code, slot);
    if (room.phase !== "finished") throw new GameError("INVALID_PHASE", "The current match hasn't finished.");
    room.round += 1;
    this.resetToLobby(room);
    this.changed(room);
    return this.toState(room);
  }

  /**
   * A device reports it has confirmed the opponent's object. Validated against the
   * server's own clock and the shared sweep geometry; the FIRST valid report processed
   * wins and ends the match. Node handles events one at a time, so two near-simultaneous
   * reports are strictly ordered: the second finds the match already decided.
   */
  detect(code: string, slot: PlayerSlot, r: DetectionReport): { accepted: boolean; reason?: string; state: RoomState } {
    const { room, player } = this.member(code, slot);
    const reject = (reason: string) => ({ accepted: false, reason, state: this.toState(room) });
    if (room.phase === "finished") return reject("The match is already decided.");
    if (room.phase !== "playing" || !room.matchStartsAt || !room.matchEndsAt) return reject("The match isn't running.");
    if (r.round !== room.round) return reject("That detection belongs to a previous round.");

    const t = this.now();
    if (t > room.matchEndsAt + DETECTION_GRACE_MS) return reject("Too late — time was up.");
    // Capture time must be inside the match and consistent with the server clock (allowing for clock-sync error).
    if (r.at < room.matchStartsAt - 250 || r.at > room.matchEndsAt) return reject("Detection was outside the match time.");
    if (r.at > t + 1000 || t - r.at > 4000) return reject("Detection timestamp is not plausible.");

    const opponent = room.players.get(other(slot));
    const target = opponent?.registration;
    if (!target || !player.registration) return reject("No target registered.");
    if (r.label !== target.label && !sameGroup(r.label, target.label)) return reject("Wrong kind of object.");
    if (r.hits < 3) return reject("Not enough evidence.");
    if (r.score < 0.5 || r.score > 1.0001 || r.score - r.ownScore < 0.05) return reject("Match confidence too low.");

    // Fairness: the box must have been in the still-visible part of the screen at capture time.
    const elapsed = r.at - room.matchStartsAt;
    const progress = obstructionProgress(elapsed, room.matchEndsAt - room.matchStartsAt);
    const size = { width: r.view.width, height: r.view.height };
    const angle = angleForCoveredFraction(progress, size);
    const px = { x: r.box.x * size.width, y: r.box.y * size.height, width: r.box.w * size.width, height: r.box.h * size.height };
    // 0.5 rather than the client's 0.6: tolerates ~a few hundred ms of clock-estimate error.
    if (visibleFractionOfBox(px, size, angle) < 0.5) return reject("The object was behind the sweep.");

    this.finish(room, { kind: "win", winner: slot, reason: "detection" });
    return { accepted: true, state: this.toState(room) };
  }

  // ---------------------------------------------------------------- queries

  stateOf(code: string): RoomState | null {
    const room = this.rooms.get(code);
    return room ? this.toState(room) : null;
  }

  socketIdOf(code: string, slot: PlayerSlot): string | null {
    return this.rooms.get(code)?.players.get(slot)?.socketId ?? null;
  }

  // ---------------------------------------------------------------- internals

  private addPlayer(room: Room, slot: PlayerSlot, name: unknown, socketId: string): Player {
    const player: Player = {
      slot,
      name: sanitizeName(name, slot),
      token: randomBytes(24).toString("base64url"),
      socketId,
      disconnectedAt: null,
      cameraStatus: "unknown",
      registration: null,
      ready: false,
    };
    room.players.set(slot, player);
    return player;
  }

  private member(code: string, slot: PlayerSlot) {
    const room = this.rooms.get(code);
    const player = room?.players.get(slot);
    if (!room || !player) throw new GameError("NOT_IN_ROOM", "You're not in this game.");
    return { room, player };
  }

  private advanceFromLobby(room: Room) {
    const players = [...room.players.values()];
    const bothRegistered = players.length === 2 && players.every((p) => p.registration !== null);
    if (room.phase === "lobby" && bothRegistered) room.phase = "ready_check";
    if (room.phase === "ready_check" && !bothRegistered) room.phase = "lobby";
    room.lookalike = false;
    if (bothRegistered) {
      const [a, b] = players.map((p) => p.registration!);
      const sa = decodeDescriptor(a!.descriptor);
      const sb = decodeDescriptor(b!.descriptor);
      if (sa && sb && sameGroup(a!.label, b!.label)) {
        room.lookalike = Math.max(objectSimilarity(sa, sb), objectSimilarity(sb, sa)) >= LOOKALIKE_WARNING;
      }
    }
  }

  private resetToLobby(room: Room) {
    this.clearTimers(room);
    room.phase = "lobby";
    room.countdownStartsAt = room.matchStartsAt = room.matchEndsAt = null;
    room.outcome = null;
    for (const p of room.players.values()) p.ready = false;
    this.advanceFromLobby(room);
  }

  private scheduleMatch(room: Room) {
    const t = this.now();
    room.phase = "countdown";
    room.countdownStartsAt = t + this.timing.startLeadMs;
    room.matchStartsAt = room.countdownStartsAt + this.timing.countdownMs;
    room.matchEndsAt = room.matchStartsAt + this.timing.matchDurationMs;
    room.outcome = null;
    const round = room.round;

    this.schedule(room, room.matchStartsAt - t, () => {
      if (room.round === round && room.phase === "countdown") {
        room.phase = "playing";
        this.changed(room);
      }
    });
    // Detections captured just before the end may still be in flight: allow a short grace.
    this.schedule(room, room.matchEndsAt - t + DETECTION_GRACE_MS, () => {
      if (room.round === round && (room.phase === "playing" || room.phase === "countdown")) {
        this.finish(room, { kind: "timeout" });
      }
    });

    this.events.targetsAssigned(
      room.code,
      [...room.players.values()].map((p) => ({ socketId: p.socketId, target: this.targetFor(room, p.slot)! })),
    );
  }

  /**
   * Ends the match exactly once. Later calls (late detections, duplicate timers,
   * simultaneous events) are ignored, so a match can never produce two results.
   */
  private finish(room: Room, outcome: MatchOutcome) {
    if (room.phase === "finished") return false;
    room.phase = "finished";
    room.outcome = outcome;
    this.clearTimers(room);
    for (const p of room.players.values()) p.ready = false;
    this.changed(room);
    return true;
  }

  private targetFor(room: Room, slot: PlayerSlot): MatchTarget | null {
    if (room.phase !== "countdown" && room.phase !== "playing") return null;
    const own = room.players.get(slot)?.registration;
    const target = room.players.get(other(slot))?.registration;
    return own && target ? { round: room.round, target, own } : null;
  }

  private schedule(room: Room, delayMs: number, fn: () => void) {
    const h = setTimeout(() => {
      room.timers.delete(h);
      fn();
    }, Math.max(0, delayMs));
    h.unref?.();
    room.timers.add(h);
  }

  private clearTimers(room: Room) {
    for (const h of room.timers) clearTimeout(h);
    room.timers.clear();
  }

  private close(room: Room, reason: RoomClosedReason) {
    this.clearTimers(room);
    this.rooms.delete(room.code);
    const sockets = [...room.players.values()].map((p) => p.socketId).filter((s): s is string => s !== null);
    this.events.roomClosed(room.code, reason, sockets);
  }

  private changed(room: Room) {
    room.version += 1;
    room.lastActivity = this.now();
    this.events.stateChanged(room.code, this.toState(room));
  }

  private toState(room: Room): RoomState {
    const players: RoomState["players"] = {};
    for (const p of room.players.values()) {
      players[p.slot] = {
        slot: p.slot,
        name: p.name,
        connected: p.socketId !== null,
        cameraStatus: p.cameraStatus,
        objectRegistered: p.registration !== null,
        objectLabel: p.registration?.label ?? null,
        ready: p.ready,
      };
    }
    return {
      code: room.code,
      phase: room.phase,
      players,
      countdownStartsAt: room.countdownStartsAt,
      matchStartsAt: room.matchStartsAt,
      matchEndsAt: room.matchEndsAt,
      outcome: room.outcome,
      version: room.version,
      round: room.round,
      lookalikeWarning: room.lookalike,
    };
  }
}
