import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  angleForCoveredFraction,
  coveredFractionForAngle,
  estimateClockOffset,
  generateRoomCode,
  isPointVisible,
  isValidRoomCode,
  normalizeRoomCode,
  obstructionProgress,
  visibleFractionOfBox,
} from "./index.js";

describe("room codes", () => {
  it("generates valid codes from the unambiguous alphabet", () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 9301 + 49297) % 233280) % n;
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(rnd);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it("normalizes user input", () => {
    expect(normalizeRoomCode(" ab-c d9 ")).toBe("ABCD9");
    expect(normalizeRoomCode("abcdefgh")).toBe("ABCDE");
  });

  it("rejects ambiguous characters and wrong lengths", () => {
    expect(isValidRoomCode("ABCD")).toBe(false);
    expect(isValidRoomCode("ABCD0")).toBe(false);
    expect(isValidRoomCode("ABCDO")).toBe(false);
    expect(isValidRoomCode("ABCDI")).toBe(false);
    expect(isValidRoomCode("ABCD2")).toBe(true);
  });
});

describe("clock offset estimation", () => {
  it("recovers a known offset under symmetric latency", () => {
    const offset = 12_345;
    const samples = [40, 25, 90, 30, 300, 28].map((rtt, i) => {
      const t0 = 1_000 + i * 500;
      return { clientSentAt: t0, serverTime: t0 + rtt / 2 + offset, clientReceivedAt: t0 + rtt };
    });
    const est = estimateClockOffset(samples);
    expect(Math.abs(est.offsetMs - offset)).toBeLessThanOrEqual(1);
    expect(est.bestRttMs).toBe(25);
  });

  it("is robust to one asymmetric outlier", () => {
    const offset = -500;
    const samples = [20, 22, 21, 24].map((rtt, i) => {
      const t0 = i * 100;
      return { clientSentAt: t0, serverTime: t0 + rtt / 2 + offset, clientReceivedAt: t0 + rtt };
    });
    samples.push({ clientSentAt: 1000, serverTime: 1000 + 400 + offset, clientReceivedAt: 1000 + 450 });
    expect(Math.abs(estimateClockOffset(samples).offsetMs - offset)).toBeLessThanOrEqual(2);
  });
});

describe("obstruction geometry", () => {
  const sizes = [
    { width: 390, height: 844 }, // iPhone 14 portrait
    { width: 412, height: 915 }, // Pixel / Galaxy portrait
    { width: 500, height: 500 },
  ];

  it("maps time to area progress linearly and clamps", () => {
    expect(obstructionProgress(-5, 60_000)).toBe(0);
    expect(obstructionProgress(15_000, 60_000)).toBe(0.25);
    expect(obstructionProgress(30_000, 60_000)).toBe(0.5);
    expect(obstructionProgress(45_000, 60_000)).toBe(0.75);
    expect(obstructionProgress(90_000, 60_000)).toBe(1);
  });

  it.each(sizes)("covers exactly 25/50/75/100%% of a %o screen by area", (size) => {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const angle = angleForCoveredFraction(f, size);
      expect(coveredFractionForAngle(angle, size)).toBeCloseTo(f, 6);
    }
  });

  it("covered area is monotonic in angle", () => {
    const size = sizes[0]!;
    let prev = -1;
    for (let a = 0; a <= Math.PI * 2; a += 0.05) {
      const f = coveredFractionForAngle(a, size);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = f;
    }
  });

  it("masks points and boxes behind the sweep", () => {
    const size = { width: 400, height: 800 };
    const half = angleForCoveredFraction(0.5, size); // right half covered (sweep 0..π)
    expect(half).toBeCloseTo(Math.PI, 6);
    expect(isPointVisible(350, 400, size, half)).toBe(false); // right side → covered
    expect(isPointVisible(50, 400, size, half)).toBe(true); // left side → visible
    expect(visibleFractionOfBox({ x: 250, y: 300, width: 100, height: 200 }, size, half)).toBe(0);
    expect(visibleFractionOfBox({ x: 50, y: 300, width: 100, height: 200 }, size, half)).toBe(1);
    expect(visibleFractionOfBox({ x: 150, y: 300, width: 100, height: 200 }, size, half)).toBeCloseTo(0.5, 1);
    expect(visibleFractionOfBox({ x: 50, y: 300, width: 100, height: 200 }, size, Math.PI * 2)).toBe(0);
  });
});
