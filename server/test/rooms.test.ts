import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchTarget, RoomState } from "@aoh/shared";
import { GameError, RoomManager, sanitizeName, type Timing } from "../src/rooms/RoomManager.js";

const T: Timing = {
  startLeadMs: 800,
  countdownMs: 3000,
  matchDurationMs: 60_000,
  disconnectGraceMs: 15_000,
  emptyRoomTtlMs: 180_000,
  idleTimeoutMs: 900_000,
};

const reg = (label: string, seed: number) => ({ label, descriptor: [seed, seed + 1, seed + 2], views: 3 });

function setup() {
  const states: RoomState[] = [];
  const targets: Array<Array<{ socketId: string | null; target: MatchTarget }>> = [];
  const closed: Array<{ reason: string; sockets: string[] }> = [];
  const rm = new RoomManager(
    {
      stateChanged: (_c, s) => states.push(s),
      targetsAssigned: (_c, t) => targets.push(t),
      roomClosed: (_c, reason, sockets) => closed.push({ reason, sockets }),
    },
    T,
    () => Date.now(),
  );
  const last = () => states[states.length - 1]!;
  return { rm, states, targets, closed, last };
}

function twoPlayers() {
  const ctx = setup();
  const host = ctx.rm.create("Alice", "s1");
  const guest = ctx.rm.join(host.roomCode, "Bob", "s2");
  return { ...ctx, code: host.roomCode, host, guest };
}

function readyMatch() {
  const ctx = twoPlayers();
  ctx.rm.register(ctx.code, 1, reg("bottle", 1));
  ctx.rm.register(ctx.code, 2, reg("cup", 9));
  ctx.rm.setReady(ctx.code, 1, true);
  ctx.rm.setReady(ctx.code, 2, true);
  return ctx;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("membership", () => {
  it("creates a room with the host in slot 1 and a secret token", () => {
    const { rm, last } = setup();
    const res = rm.create("  Alice\u0000 ", "s1");
    expect(res.slot).toBe(1);
    expect(res.sessionToken.length).toBeGreaterThanOrEqual(32);
    expect(res.state.players[1]).toMatchObject({ name: "Alice", connected: true, ready: false, objectRegistered: false });
    expect(JSON.stringify(last())).not.toContain(res.sessionToken); // tokens never broadcast
  });

  it("lets exactly one guest join, by code", () => {
    const { rm, code } = twoPlayers();
    expect(rm.stateOf(code)!.players[2]!.name).toBe("Bob");
    expect(() => rm.join(code, "Eve", "s3")).toThrowError(GameError);
    expect(() => rm.join("ZZZZZ", "Eve", "s3")).toThrow(/No game/);
  });

  it("sanitizes names and falls back to Player N", () => {
    expect(sanitizeName("   ", 2)).toBe("Player 2");
    expect(sanitizeName("a‮b\nc", 1)).toBe("ab c");
    expect(sanitizeName("x".repeat(40), 1)).toHaveLength(16);
    expect(sanitizeName(42, 1)).toBe("Player 1");
  });

  it("resumes only with the right token, and marks the player connected again", () => {
    const { rm, code, guest } = twoPlayers();
    rm.disconnect(code, 2, "s2");
    expect(rm.stateOf(code)!.players[2]!.connected).toBe(false);
    expect(() => rm.resume(code, 2, "wrong-token-wrong-token", "s9")).toThrow(/ended/);
    expect(() => rm.resume(code, 1, guest.sessionToken, "s9")).toThrow(/ended/); // token is per-seat
    const r = rm.resume(code, 2, guest.sessionToken, "s9");
    expect(r.state.players[2]!.connected).toBe(true);
    expect(rm.socketIdOf(code, 2)).toBe("s9");
  });

  it("ignores disconnects from a socket that was already replaced", () => {
    const { rm, code, guest } = twoPlayers();
    rm.resume(code, 2, guest.sessionToken, "s-new");
    rm.disconnect(code, 2, "s2"); // old socket finally times out
    expect(rm.stateOf(code)!.players[2]!.connected).toBe(true);
  });

  it("guest leaving frees the seat; host leaving closes the room", () => {
    const { rm, code, closed } = twoPlayers();
    rm.leave(code, 2);
    expect(rm.stateOf(code)!.players[2]).toBeUndefined();
    rm.join(code, "Carol", "s3");
    rm.leave(code, 1);
    expect(rm.stateOf(code)).toBeNull();
    expect(closed[0]).toEqual({ reason: "host_left", sockets: ["s3"] });
  });
});

describe("registration and readiness", () => {
  it("moves to ready_check only when both objects are registered", () => {
    const { rm, code } = twoPlayers();
    rm.register(code, 1, reg("bottle", 1));
    expect(rm.stateOf(code)!.phase).toBe("lobby");
    expect(() => rm.setReady(code, 1, true)).toThrow(/register/);
    rm.register(code, 2, reg("cup", 5));
    const s = rm.stateOf(code)!;
    expect(s.phase).toBe("ready_check");
    expect(s.players[1]!.objectLabel).toBe("bottle");
    expect(JSON.stringify(s)).not.toContain("descriptor"); // signatures stay private
  });

  it("re-registering or clearing resets readiness", () => {
    const { rm, code } = twoPlayers();
    rm.register(code, 1, reg("bottle", 1));
    rm.register(code, 2, reg("cup", 5));
    rm.setReady(code, 1, true);
    rm.register(code, 2, reg("book", 7));
    expect(rm.stateOf(code)!.players[1]!.ready).toBe(false);
    rm.setReady(code, 1, true);
    rm.clearRegistration(code, 2);
    expect(rm.stateOf(code)!.phase).toBe("lobby");
    expect(rm.stateOf(code)!.players[1]!.ready).toBe(false);
  });

  it("one ready player waits; un-ready is allowed", () => {
    const { rm, code } = twoPlayers();
    rm.register(code, 1, reg("bottle", 1));
    rm.register(code, 2, reg("cup", 5));
    rm.setReady(code, 1, true);
    expect(rm.stateOf(code)!.phase).toBe("ready_check");
    rm.setReady(code, 1, false);
    expect(rm.stateOf(code)!.players[1]!.ready).toBe(false);
  });

  it("does not start while the other player is disconnected", () => {
    const { rm, code } = twoPlayers();
    rm.register(code, 1, reg("bottle", 1));
    rm.register(code, 2, reg("cup", 5));
    rm.setReady(code, 2, true);
    rm.disconnect(code, 2, "s2");
    rm.setReady(code, 1, true);
    expect(rm.stateOf(code)!.phase).toBe("ready_check");
  });
});

describe("server-scheduled match", () => {
  it("fixes one official timeline when both are ready", () => {
    const { rm, code } = readyMatch();
    const s = rm.stateOf(code)!;
    expect(s.phase).toBe("countdown");
    expect(s.countdownStartsAt).toBe(1_000_000 + 800);
    expect(s.matchStartsAt).toBe(s.countdownStartsAt! + 3000);
    expect(s.matchEndsAt).toBe(s.matchStartsAt! + 60_000);
  });

  it("sends each player the OPPONENT's object as their target", () => {
    const { targets } = readyMatch();
    const [assign] = targets;
    const forHost = assign!.find((t) => t.socketId === "s1")!.target;
    const forGuest = assign!.find((t) => t.socketId === "s2")!.target;
    expect(forHost.target.label).toBe("cup");
    expect(forHost.own.label).toBe("bottle");
    expect(forGuest.target.label).toBe("bottle");
    expect(forGuest.own.label).toBe("cup");
  });

  it("goes countdown → playing → finished(timeout) on the server clock", () => {
    const { rm, code } = readyMatch();
    vi.advanceTimersByTime(800 + 3000 - 1);
    expect(rm.stateOf(code)!.phase).toBe("countdown");
    vi.advanceTimersByTime(1);
    expect(rm.stateOf(code)!.phase).toBe("playing");
    vi.advanceTimersByTime(60_000);
    const s = rm.stateOf(code)!;
    expect(s.phase).toBe("finished");
    expect(s.outcome).toEqual({ kind: "timeout" });
  });

  it("a brief disconnect during a match is forgiven", () => {
    const { rm, code, guest } = readyMatch();
    vi.advanceTimersByTime(5000);
    rm.disconnect(code, 2, "s2");
    vi.advanceTimersByTime(10_000);
    rm.resume(code, 2, guest.sessionToken, "s2b");
    vi.advanceTimersByTime(10_000);
    expect(rm.stateOf(code)!.phase).toBe("playing");
  });

  it("a long disconnect during a match forfeits to the connected player", () => {
    const { rm, code } = readyMatch();
    vi.advanceTimersByTime(5000);
    rm.disconnect(code, 2, "s2");
    vi.advanceTimersByTime(15_000);
    expect(rm.stateOf(code)!.outcome).toEqual({ kind: "win", winner: 1, reason: "opponent_forfeit" });
  });

  it("leaving mid-match forfeits, and the result can't change afterwards", () => {
    const { rm, code } = readyMatch();
    vi.advanceTimersByTime(5000);
    rm.leave(code, 2);
    const s = rm.stateOf(code)!;
    expect(s.outcome).toEqual({ kind: "win", winner: 1, reason: "opponent_forfeit" });
    vi.advanceTimersByTime(120_000); // old match timers must not overwrite the result
    expect(rm.stateOf(code)!.outcome).toEqual({ kind: "win", winner: 1, reason: "opponent_forfeit" });
  });

  it("rejects registration changes once the match is scheduled", () => {
    const { rm, code } = readyMatch();
    expect(() => rm.register(code, 1, reg("book", 3))).toThrow(/before the match/);
  });

  it("rematch starts a new round with objects kept and readiness cleared", () => {
    const { rm, code } = readyMatch();
    expect(() => rm.rematch(code, 1)).toThrow(/finished/);
    vi.advanceTimersByTime(70_000);
    const s = rm.rematch(code, 2);
    expect(s.round).toBe(2);
    expect(s.phase).toBe("ready_check");
    expect(s.outcome).toBeNull();
    expect(s.players[1]!.ready || s.players[2]!.ready).toBe(false);
  });

  it("versions increase monotonically", () => {
    const { states } = readyMatch();
    for (let i = 1; i < states.length; i++) expect(states[i]!.version).toBeGreaterThan(states[i - 1]!.version);
  });
});

describe("cleanup", () => {
  it("closes rooms nobody is connected to after the TTL", () => {
    const { rm, code, closed } = twoPlayers();
    rm.disconnect(code, 1, "s1");
    rm.disconnect(code, 2, "s2");
    vi.advanceTimersByTime(T.emptyRoomTtlMs + 1);
    rm.sweep();
    expect(rm.stateOf(code)).toBeNull();
    expect(closed[0]!.reason).toBe("idle");
  });

  it("keeps rooms with someone connected", () => {
    const { rm, code } = twoPlayers();
    rm.disconnect(code, 2, "s2");
    vi.advanceTimersByTime(T.emptyRoomTtlMs + 1);
    rm.sweep();
    expect(rm.stateOf(code)).not.toBeNull();
  });
});
