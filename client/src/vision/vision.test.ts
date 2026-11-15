import { describe, expect, it } from "vitest";
import { COLOR_BINS, EMBED_DIM, l2normalize } from "@aoh/shared";
import { TargetMatcher, CONFIRM_HITS } from "./matcher";
import { colorSignature, iou, squareCrop, toNCHW } from "./imageOps";
import type { Detection } from "./protocol";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1;
}
function identity(base: number) {
  const r = rng(base);
  return Float32Array.from({ length: EMBED_DIM }, () => r());
}
function view(core: Float32Array, seed: number, noise = 0.2, hue = 2) {
  const r = rng(seed);
  const color = new Float32Array(COLOR_BINS);
  color[hue * 2] = 1;
  return { embedding: l2normalize(Float32Array.from(core, (x) => x + noise * r())), color };
}
const TARGET = identity(11);
const OWN = identity(22);
const target = { views: [1, 2, 3].map((i) => view(TARGET, i)) };
const own = { views: [1, 2, 3].map((i) => view(OWN, 100 + i, 0.2, 9)) };
const det = (core: Float32Array, seed: number, label = "cup", box = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 }, hue = 2): Detection => ({
  label,
  score: 0.9,
  box,
  ...view(core, seed, 0.25, hue),
});
const allVisible = () => 1;

describe("TargetMatcher", () => {
  it(`confirms only after ${CONFIRM_HITS} consistent hits`, () => {
    const m = new TargetMatcher("cup", target, own);
    let confirmed = null;
    for (let i = 0; i < CONFIRM_HITS; i++) {
      const r = m.update([det(TARGET, 50 + i)], 1000 + i * 300, allVisible);
      expect(r.verdict.kind).toBe("hit");
      confirmed = r.confirmed;
      if (i < CONFIRM_HITS - 1) expect(confirmed).toBeNull();
    }
    expect(confirmed).not.toBeNull();
    expect(confirmed!.hits).toBe(CONFIRM_HITS);
  });

  it("never confirms the player's own object", () => {
    const m = new TargetMatcher("cup", target, own);
    for (let i = 0; i < 10; i++) {
      const r = m.update([det(OWN, 70 + i, "cup", undefined, 9)], 1000 + i * 300, allVisible);
      expect(r.verdict.kind).toBe("own");
      expect(r.confirmed).toBeNull();
    }
  });

  it("ignores other objects and other categories", () => {
    const m = new TargetMatcher("cup", target, own);
    const stranger = identity(33);
    for (let i = 0; i < 6; i++) {
      expect(m.update([det(stranger, 80 + i, "cup", undefined, 12)], 1000 + i * 300, allVisible).confirmed).toBeNull();
      expect(m.update([det(TARGET, 90 + i, "book")], 1100 + i * 300, allVisible).verdict.kind).toBe("none");
    }
  });

  it("does not count detections hidden behind the obstruction", () => {
    const m = new TargetMatcher("cup", target, own);
    for (let i = 0; i < 6; i++) {
      const r = m.update([det(TARGET, 60 + i)], 1000 + i * 300, () => 0.2);
      expect(r.verdict.kind).toBe("hidden");
      expect(r.confirmed).toBeNull();
    }
  });

  it("requires the hits to be recent and spatially consistent", () => {
    const slow = new TargetMatcher("cup", target, own);
    for (let i = 0; i < 4; i++) expect(slow.update([det(TARGET, 60 + i)], 1000 + i * 2000, allVisible).confirmed).toBeNull();
    const jumpy = new TargetMatcher("cup", target, own);
    const corners = [{ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.8, y: 0.8, w: 0.2, h: 0.2 }, { x: 0, y: 0.8, w: 0.2, h: 0.2 }];
    for (let i = 0; i < 3; i++) expect(jumpy.update([det(TARGET, 60 + i, "cup", corners[i])], 1000 + i * 200, allVisible).confirmed).toBeNull();
  });

  it("accepts a confusable category in the same group (cup seen as vase)", () => {
    const m = new TargetMatcher("cup", target, own);
    let c = null;
    for (let i = 0; i < 3; i++) c = m.update([det(TARGET, 40 + i, i === 1 ? "vase" : "cup")], 1000 + i * 300, allVisible).confirmed;
    expect(c).not.toBeNull();
  });
});

describe("image ops", () => {
  it("normalises pixels into NCHW planes", () => {
    const px = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255]);
    const t = toNCHW(px, 2, 1, 0.5, 0.5);
    expect(Array.from(t).map((v) => +v.toFixed(2))).toEqual([1, -1, -1, 1, 0, -1]);
  });

  it("colour signature is a normalised histogram that separates red from blue", () => {
    const solid = (r: number, g: number, b: number) => {
      const a = new Uint8ClampedArray(32 * 32 * 4);
      for (let i = 0; i < a.length; i += 4) [a[i], a[i + 1], a[i + 2], a[i + 3]] = [r, g, b, 255];
      return colorSignature(a, 32, 32);
    };
    const red = solid(220, 20, 20);
    const blue = solid(20, 20, 220);
    const sum = (h: Float32Array) => h.reduce((a, b) => a + b, 0);
    expect(sum(red)).toBeCloseTo(1, 5);
    const inter = red.reduce((a, v, i) => a + Math.min(v, blue[i]!), 0);
    expect(inter).toBeLessThan(0.05);
  });

  it("square crops are centred on the box and iou behaves", () => {
    const c = squareCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.25 }, 400, 800, 0);
    expect(c.size).toBe(200);
    expect(c.sx + c.size / 2).toBe(200);
    expect(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0.5, h: 1 })).toBeCloseTo(0.5);
  });
});
