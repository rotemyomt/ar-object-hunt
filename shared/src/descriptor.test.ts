import { describe, expect, it } from "vitest";
import {
  COLOR_BINS,
  EMBED_DIM,
  calibrateThresholds,
  decodeDescriptor,
  descriptorLength,
  encodeDescriptor,
  l2normalize,
  objectSimilarity,
  scoreAgainst,
  selfConsistency,
  sameGroup,
  SUPPORTED_LABELS,
} from "./index.js";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1;
}
function sig(base: number, n = 4, noise = 0.2, hue = 3) {
  const r0 = rng(base);
  const core = Float32Array.from({ length: EMBED_DIM }, () => r0());
  return {
    views: Array.from({ length: n }, (_, i) => {
      const r = rng(base * 97 + i);
      const color = new Float32Array(COLOR_BINS);
      color[hue * 2] = 1;
      return { embedding: l2normalize(Float32Array.from(core, (x) => x + noise * r())), color };
    }),
  };
}

describe("descriptor codec", () => {
  it("round-trips and has the documented size", () => {
    const s = sig(1, 5);
    const d = encodeDescriptor(s);
    expect(d).toHaveLength(descriptorLength(5));
    expect(d.length).toBeLessThanOrEqual(8192);
    const back = decodeDescriptor(d)!;
    expect(back.views).toHaveLength(5);
    expect(back.views[2]!.embedding[10]).toBeCloseTo(s.views[2]!.embedding[10]!, 3);
  });

  it("rejects malformed input instead of throwing", () => {
    const d = encodeDescriptor(sig(1, 3));
    expect(decodeDescriptor([])).toBeNull();
    expect(decodeDescriptor([2, ...d.slice(1)])).toBeNull(); // wrong version
    expect(decodeDescriptor(d.slice(0, -1))).toBeNull(); // truncated
    expect(decodeDescriptor([...d.slice(0, -1), Number.NaN])).toBeNull();
    expect(decodeDescriptor([1, 9, EMBED_DIM, COLOR_BINS])).toBeNull(); // too many views
  });
});

describe("matching maths", () => {
  it("scores the same object far above a different one", () => {
    const a = sig(1);
    const b = sig(2, 4, 0.2, 9);
    const probe = sig(1, 1, 0.25).views[0]!;
    expect(scoreAgainst(probe, a).score).toBeGreaterThan(0.8);
    expect(scoreAgainst(probe, b).score).toBeLessThan(0.3);
    expect(objectSimilarity(a, b)).toBeLessThan(0.3);
    expect(objectSimilarity(a, sig(1, 3, 0.2))).toBeGreaterThan(0.8);
  });

  it("calibrates thresholds from registration consistency, within bounds", () => {
    const tight = sig(3, 4, 0.05);
    const loose = sig(4, 4, 1.5);
    expect(selfConsistency(tight)).toBeGreaterThan(selfConsistency(loose));
    const t = calibrateThresholds(tight);
    const l = calibrateThresholds(loose);
    expect(t.accept).toBeLessThanOrEqual(0.8);
    expect(l.accept).toBeGreaterThanOrEqual(0.55);
    expect(t.accept).toBeGreaterThanOrEqual(l.accept);
  });

  it("groups confusable categories", () => {
    expect(sameGroup("cup", "vase")).toBe(true);
    expect(sameGroup("cup", "book")).toBe(false);
    expect(sameGroup("car", "car")).toBe(false); // unsupported
    expect(SUPPORTED_LABELS.has("bottle")).toBe(true);
    expect(SUPPORTED_LABELS.has("person")).toBe(false);
  });
});
