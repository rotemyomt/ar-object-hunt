import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchTarget, RoomState } from "@aoh/shared";
import { GameError, RoomManager, sanitizeName, type Timing } from "../src/rooms/RoomManager.js";
import { registration } from "./fixtures.js";

const T: Timing = {
  startLeadMs: 800,
  countdownMs: 3000,
  matchDurationMs: 60_000,
  disconnectGraceMs: 15_000,
  emptyRoomTtlMs: 180_000,
  idleTimeoutMs: 900_000,
};

const reg = (label: string, seed: number) => registration(label, seed);

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
    expect(rm.stateOf(code)!.phase).toBe("playing"); // grace window for in-flight detections
    vi.advanceTimersByTime(750);
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

describe("detections (server-authoritative winner)", () => {
  const view = { width: 400, height: 800 };
  // Left half stays visible until 50% coverage (sweep starts at 12 o'clock, clockwise).
  const leftBox = { x: 0.05, y: 0.4, w: 0.3, h: 0.2 };
  const rightBox = { x: 0.65, y: 0.4, w: 0.3, h: 0.2 };
  function playing() {
    const ctx = readyMatch();
    vi.advanceTimersByTime(T.startLeadMs + T.countdownMs + 1000); // 1 s into the hunt
    const s = ctx.rm.stateOf(ctx.code)!;
    expect(s.phase).toBe("playing");
    const report = (over: Partial<Parameters<RoomManager["detect"]>[2]> = {}) => ({
      round: s.round,
      at: Date.now() - 100,
      label: "cup", // host hunts the guest's cup
      box: leftBox,
      view,
      score: 0.82,
      ownScore: 0.4,
      hits: 3,
      ...over,
    });
    return { ...ctx, report };
  }

  it("a valid detection wins immediately for the reporter", () => {
    const { rm, code, report } = playing();
    const r = rm.detect(code, 1, report());
    expect(r.accepted).toBe(true);
    expect(r.state.outcome).toEqual({ kind: "win", winner: 1, reason: "detection" });
  });

  it("near-simultaneous detections: first processed wins, the second is refused", () => {
    const { rm, code, report } = playing();
    const a = rm.detect(code, 2, report({ label: "bottle" }));
    const b = rm.detect(code, 1, report());
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(false);
    expect(b.reason).toMatch(/already decided/);
    expect(rm.stateOf(code)!.outcome).toEqual({ kind: "win", winner: 2, reason: "detection" });
  });

  it("rejects detections behind the sweep, using the server's geometry and clock", () => {
    const { rm, code, report } = playing();
    vi.advanceTimersByTime(30_000); // ~52% covered: the right half is dark
    expect(rm.detect(code, 1, report({ at: Date.now() - 100, box: rightBox })).reason).toMatch(/behind the sweep/);
    expect(rm.detect(code, 1, report({ at: Date.now() - 100, box: leftBox })).accepted).toBe(true);
  });

  it("rejects the wrong category, weak evidence, own-object look-alikes and bad timing", () => {
    const { rm, code, report } = playing();
    expect(rm.detect(code, 1, report({ label: "book" })).reason).toMatch(/Wrong kind/);
    expect(rm.detect(code, 1, report({ hits: 1 })).reason).toMatch(/evidence/);
    expect(rm.detect(code, 1, report({ score: 0.6, ownScore: 0.58 })).reason).toMatch(/confidence/);
    expect(rm.detect(code, 1, report({ at: Date.now() + 5000 })).reason).toMatch(/plausible/);
    expect(rm.detect(code, 1, report({ at: Date.now() - 60_000 })).reason).toMatch(/outside the match/);
    expect(rm.detect(code, 1, report({ round: 99 })).reason).toMatch(/previous round/);
    expect(rm.stateOf(code)!.phase).toBe("playing");
  });

  it("refuses detections during the countdown and after time is up", () => {
    const { rm, code } = readyMatch();
    const s = rm.stateOf(code)!;
    const r = { round: s.round, at: Date.now(), label: "cup", box: leftBox, view, score: 0.9, ownScore: 0.1, hits: 3 };
    expect(rm.detect(code, 1, r).reason).toMatch(/isn't running/);
    vi.advanceTimersByTime(T.startLeadMs + T.countdownMs + T.matchDurationMs + 1000);
    expect(rm.stateOf(code)!.outcome).toEqual({ kind: "timeout" });
    expect(rm.detect(code, 1, { ...r, at: Date.now() }).accepted).toBe(false);
  });

  it("accepts a detection that arrives shortly after it was captured", () => {
    const { rm, code, report } = playing();
    const s = rm.stateOf(code)!;
    vi.setSystemTime(s.matchStartsAt! + 10_000);
    const early = report({ at: Date.now() });
    vi.setSystemTime(s.matchStartsAt! + 10_500);
    expect(rm.detect(code, 1, early).accepted).toBe(true);
  });
});

describe("lookalike warning", () => {
  it("flags two very similar objects of the same kind, not different ones", () => {
    const { rm, code } = twoPlayers();
    rm.register(code, 1, registration("bottle", 5));
    rm.register(code, 2, registration("bottle", 5)); // same identity seed → near-identical
    expect(rm.stateOf(code)!.lookalikeWarning).toBe(true);
    rm.register(code, 2, registration("bottle", 77));
    expect(rm.stateOf(code)!.lookalikeWarning).toBe(false);
  });
});
