import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import type { AckResult, ClientToServerEvents, MatchTarget, RoomState, ServerToClientEvents, SessionCredentials } from "@aoh/shared";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";

type C = Socket<ServerToClientEvents, ClientToServerEvents>;
let app: App;
let url: string;

beforeAll(async () => {
  app = createApp({ ...loadConfig(), port: 0, production: false }, {
    startLeadMs: 100,
    countdownMs: 200,
    matchDurationMs: 600,
    disconnectGraceMs: 300,
    emptyRoomTtlMs: 60_000,
    idleTimeoutMs: 60_000,
  });
  await new Promise<void>((r) => app.http.listen(0, r));
  url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

async function client(): Promise<C> {
  const s: C = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  await new Promise<void>((r) => s.once("connect", () => r()));
  return s;
}

function call<T>(emit: (ack: (r: AckResult<T>) => void) => void): Promise<AckResult<T>> {
  return new Promise((resolve) => emit(resolve));
}
function ok<T>(r: AckResult<T>): T {
  if (!r.ok) throw new Error(`${r.error}: ${r.message}`);
  return r.data;
}
function nextState(s: C, pred: (st: RoomState) => boolean = () => true, ms = 2000): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out waiting for room:state")), ms);
    const h = (st: RoomState) => {
      if (pred(st)) {
        clearTimeout(t);
        s.off("room:state", h);
        resolve(st);
      }
    };
    s.on("room:state", h);
  });
}

const reg = (label: string) => ({ label, descriptor: Array.from({ length: 64 }, (_, i) => Math.sin(i + label.length)), views: 4 });

async function pair() {
  const a = await client();
  const b = await client();
  const host = ok(await call<SessionCredentials & { state: RoomState }>((cb) => a.emit("room:create", { name: "Alice" }, cb)));
  const aSeesB = nextState(a, (s) => !!s.players[2]?.connected);
  const guest = ok(await call<SessionCredentials & { state: RoomState }>((cb) => b.emit("room:join", { code: host.roomCode.toLowerCase(), name: "Bob" }, cb)));
  await aSeesB;
  return { a, b, host, guest, code: host.roomCode };
}

describe("two players over real sockets", () => {
  it("create → join by code: both devices see both players connected", async () => {
    const { a, b, guest, code } = await pair();
    expect(guest.slot).toBe(2);
    expect(guest.state.players[1]!.name).toBe("Alice");
    expect(guest.state.players[2]!.name).toBe("Bob");
    expect(app.rooms.stateOf(code)!.players[2]!.connected).toBe(true);
    a.close();
    b.close();
  });

  it("rejects wrong codes, full rooms and non-members", async () => {
    const { a, b, code } = await pair();
    const c = await client();
    expect(await call((cb) => c.emit("room:join", { code: "ZZZZZ", name: "x" }, cb))).toMatchObject({ ok: false, error: "ROOM_NOT_FOUND" });
    expect(await call((cb) => c.emit("room:join", { code, name: "x" }, cb))).toMatchObject({ ok: false, error: "ROOM_FULL" });
    expect(await call((cb) => c.emit("player:ready", true, cb))).toMatchObject({ ok: false, error: "NOT_IN_ROOM" });
    expect(await call((cb) => c.emit("room:join", { code: 123 as unknown as string, name: "x" }, cb))).toMatchObject({ ok: false, error: "BAD_REQUEST" });
    [a, b, c].forEach((s) => s.close());
  });

  it("validates registrations", async () => {
    const { a, b } = await pair();
    const bad = await call((cb) => a.emit("object:register", { label: "bottle", descriptor: [1, Number.NaN], views: 2 }, cb));
    expect(bad).toMatchObject({ ok: false, error: "BAD_REQUEST" });
    const huge = await call((cb) => a.emit("object:register", { label: "bottle", descriptor: new Array(5000).fill(0), views: 2 }, cb));
    expect(huge).toMatchObject({ ok: false, error: "BAD_REQUEST" });
    a.close();
    b.close();
  });

  it("synchronized readiness → identical server timeline + private targets → timeout", async () => {
    const { a, b } = await pair();
    ok(await call((cb) => a.emit("object:register", reg("bottle"), cb)));
    const bReady = nextState(b, (s) => s.phase === "ready_check");
    ok(await call((cb) => b.emit("object:register", reg("cup"), cb)));
    await bReady;

    const r1 = ok(await call<{ state: RoomState }>((cb) => a.emit("player:ready", true, cb)));
    expect(r1.state.phase).toBe("ready_check");
    expect(r1.state.players[1]!.ready).toBe(true);

    const aTarget = new Promise<MatchTarget>((r) => a.once("match:target", r));
    const bTarget = new Promise<MatchTarget>((r) => b.once("match:target", r));
    const aCountdown = nextState(a, (s) => s.phase === "countdown");
    const bCountdown = nextState(b, (s) => s.phase === "countdown");
    ok(await call((cb) => b.emit("player:ready", true, cb)));
    const [sa, sb] = await Promise.all([aCountdown, bCountdown]);
    expect(sa.matchStartsAt).toBe(sb.matchStartsAt);
    expect(sa.matchEndsAt).toBe(sb.matchEndsAt);

    const [ta, tb] = await Promise.all([aTarget, bTarget]);
    expect(ta.target.label).toBe("cup");
    expect(tb.target.label).toBe("bottle");

    await nextState(a, (s) => s.phase === "playing");
    const end = await nextState(b, (s) => s.phase === "finished", 3000);
    expect(end.outcome).toEqual({ kind: "timeout" });

    const re = ok(await call<{ state: RoomState }>((cb) => a.emit("match:rematch", cb)));
    expect(re.state.round).toBe(2);
    expect(re.state.phase).toBe("ready_check");
    a.close();
    b.close();
  });

  it("a dropped device resumes its seat with its session token", async () => {
    const { a, b, guest, code } = await pair();
    const aSeesDrop = nextState(a, (s) => s.players[2]?.connected === false);
    b.close();
    await aSeesDrop;

    const b2 = await client();
    const aSeesBack = nextState(a, (s) => s.players[2]?.connected === true);
    const res = ok(await call<{ state: RoomState }>((cb) => b2.emit("room:resume", guest, cb)));
    expect(res.state.code).toBe(code);
    await aSeesBack;

    const forged = await client();
    expect(await call((cb) => forged.emit("room:resume", { ...guest, sessionToken: "x".repeat(32) }, cb))).toMatchObject({ ok: false, error: "UNAUTHORIZED" });
    [a, b2, forged].forEach((s) => s.close());
  });

  it("host leaving closes the room for the guest", async () => {
    const { a, b, code } = await pair();
    const closed = new Promise<{ reason: string }>((r) => b.once("room:closed", r));
    ok(await call((cb) => a.emit("room:leave", cb)));
    expect((await closed).reason).toBe("host_left");
    expect(app.rooms.stateOf(code)).toBeNull();
    a.close();
    b.close();
  });

  it("rate-limits room spam", async () => {
    const s = await client();
    const results = [];
    for (let i = 0; i < 10; i++) results.push(await call((cb) => s.emit("room:join", { code: "ZZZZZ", name: "x" }, cb)));
    expect(results.some((r) => !r.ok && r.error === "RATE_LIMITED")).toBe(true);
    s.close();
  });
});
