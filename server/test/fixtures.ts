import { COLOR_BINS, EMBED_DIM, encodeDescriptor, l2normalize, type ObjectRegistration } from "@aoh/shared";

/** Deterministic pseudo-random generator so tests are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1;
}

/**
 * A synthetic but well-formed object signature: `base` decides the object's identity;
 * each view is the base embedding plus small per-view noise (like different angles).
 */
export function signature(base: number, views = 3, noise = 0.15) {
  const r0 = rng(base);
  const core = Float32Array.from({ length: EMBED_DIM }, () => r0());
  const hue = base % 16;
  return {
    views: Array.from({ length: views }, (_, i) => {
      const r = rng(base * 1000 + i + 1);
      const emb = l2normalize(Float32Array.from(core, (x) => x + noise * r()));
      const color = new Float32Array(COLOR_BINS);
      color[hue * 2] = 0.8;
      color[32 + (i % 4)] = 0.2;
      return { embedding: emb, color };
    }),
  };
}

export function registration(label: string, base: number, views = 3): ObjectRegistration {
  return { label, descriptor: encodeDescriptor(signature(base, views)), views };
}
