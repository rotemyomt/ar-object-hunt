import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@aoh/shared";
import { estimateClockOffset } from "@aoh/shared";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { RateLimiter } from "../src/validation/rateLimit.js";

let app: App;
let url: string;

beforeAll(async () => {
  app = createApp({ ...loadConfig(), port: 0, production: false });
  await new Promise<void>((r) => app.http.listen(0, r));
  url = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
});

function client(): Socket<ServerToClientEvents, ClientToServerEvents> {
  return connect(url, { transports: ["websocket"], forceNew: true });
}

describe("http", () => {
  it("serves a health check with server time and security headers", async () => {
    const before = Date.now();
    const res = await fetch(`${url}/api/health`);
    const body = (await res.json()) as { ok: boolean; serverTime: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.serverTime).toBeGreaterThanOrEqual(before);
    expect(res.headers.get("permissions-policy")).toContain("camera=(self)");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("socket", () => {
  it("greets new connections with the server clock", async () => {
    const s = client();
    const hello = await new Promise<{ serverTime: number }>((r) => s.once("server:hello", r));
    expect(Math.abs(hello.serverTime - Date.now())).toBeLessThan(1000);
    s.close();
  });

  it("answers time:sync so clients can estimate the clock offset", async () => {
    const s = client();
    await new Promise<void>((r) => s.once("connect", () => r()));
    const samples = [];
    for (let i = 0; i < 6; i++) {
      const clientSentAt = Date.now();
      const serverTime = await new Promise<number>((r) => s.emit("time:sync", clientSentAt, r));
      samples.push({ clientSentAt, serverTime, clientReceivedAt: Date.now() });
    }
    // Same machine → true offset is 0; estimate must be within the RTT bound.
    const est = estimateClockOffset(samples);
    expect(Math.abs(est.offsetMs)).toBeLessThanOrEqual(Math.max(5, est.bestRttMs));
    s.close();
  });

  it("ignores malformed time:sync payloads", async () => {
    const s = client();
    await new Promise<void>((r) => s.once("connect", () => r()));
    const answered = await Promise.race([
      new Promise<boolean>((r) => s.emit("time:sync", "nope" as unknown as number, () => r(true))),
      new Promise<boolean>((r) => setTimeout(() => r(false), 300)),
    ]);
    expect(answered).toBe(false);
    s.close();
  });
});

describe("rate limiter", () => {
  it("allows bursts up to capacity then refills over time", () => {
    let t = 0;
    const rl = new RateLimiter(3, 1, () => t);
    expect([rl.take("a"), rl.take("a"), rl.take("a"), rl.take("a")]).toEqual([true, true, true, false]);
    t += 1000;
    expect(rl.take("a")).toBe(true);
    expect(rl.take("a")).toBe(false);
    expect(rl.take("b")).toBe(true);
    rl.clear("a");
    expect(rl.size).toBe(1);
  });
});
