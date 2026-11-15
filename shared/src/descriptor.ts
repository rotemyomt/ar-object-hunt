/**
 * Object signatures ("descriptors") and the maths for comparing them.
 *
 * A registered object is a set of VIEWS (one per angle the player scanned). Each view has
 *  - an appearance embedding: L2-normalised 1280-d MobileNetV2 pooled features of the crop
 *  - a colour signature: 36-bin centre-weighted HSV histogram of the crop
 *
 * Wire format (a flat number[] so it travels as plain JSON and is easy to validate):
 *   [VERSION, nViews, EMBED_DIM, COLOR_BINS, ...nViews*EMBED_DIM, ...nViews*COLOR_BINS]
 *
 * Shared by client (live matching) and server (similar-objects warning, sanity checks).
 */

export const DESCRIPTOR_VERSION = 1;
export const EMBED_DIM = 1280;
export const COLOR_BINS = 36;
export const MIN_VIEWS = 3;
export const MAX_VIEWS = 6;
const HEADER = 4;

/** Weights of the combined score. Appearance carries shape/texture, colour separates look-alikes. */
export const APPEARANCE_WEIGHT = 0.7;
export const COLOR_WEIGHT = 0.3;

export interface View {
  embedding: Float32Array | number[];
  color: Float32Array | number[];
}

export interface ObjectSignature {
  views: View[];
}

export function descriptorLength(nViews: number): number {
  return HEADER + nViews * (EMBED_DIM + COLOR_BINS);
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function encodeDescriptor(sig: ObjectSignature): number[] {
  const n = sig.views.length;
  if (n < 1 || n > MAX_VIEWS) throw new Error(`descriptor needs 1..${MAX_VIEWS} views`);
  const out: number[] = [DESCRIPTOR_VERSION, n, EMBED_DIM, COLOR_BINS];
  for (const v of sig.views) {
    if (v.embedding.length !== EMBED_DIM) throw new Error("bad embedding size");
    for (const x of v.embedding) out.push(round4(x));
  }
  for (const v of sig.views) {
    if (v.color.length !== COLOR_BINS) throw new Error("bad colour size");
    for (const x of v.color) out.push(round4(x));
  }
  return out;
}

/** Parse and validate; returns null for anything malformed (never throws on bad input). */
export function decodeDescriptor(d: readonly number[]): ObjectSignature | null {
  if (!Array.isArray(d) || d.length < HEADER) return null;
  const [version, n, ed, cb] = d as number[];
  if (version !== DESCRIPTOR_VERSION || ed !== EMBED_DIM || cb !== COLOR_BINS) return null;
  if (!Number.isInteger(n) || n! < 1 || n! > MAX_VIEWS || d.length !== descriptorLength(n!)) return null;
  for (const x of d) if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const views: View[] = [];
  const colorStart = HEADER + n! * EMBED_DIM;
  for (let i = 0; i < n!; i++) {
    views.push({
      embedding: Float32Array.from(d.slice(HEADER + i * EMBED_DIM, HEADER + (i + 1) * EMBED_DIM)),
      color: Float32Array.from(d.slice(colorStart + i * COLOR_BINS, colorStart + (i + 1) * COLOR_BINS)),
    });
  }
  return { views };
}

export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

/** Cosine similarity of two L2-normalised vectors (= dot product). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** Histogram intersection of two normalised histograms, in [0, 1]. */
export function histogramIntersection(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.min(a[i]!, b[i]!);
  return s;
}

export interface MatchScore {
  /** Mean of the two best view similarities (robust to one odd view). */
  appearance: number;
  /** Best colour agreement with any view. */
  color: number;
  /** Weighted combination used for decisions. */
  score: number;
}

/** How well one observed crop matches a registered object. */
export function scoreAgainst(candidate: View, sig: ObjectSignature): MatchScore {
  const sims = sig.views.map((v) => cosine(candidate.embedding, v.embedding)).sort((a, b) => b - a);
  const top = sims.slice(0, Math.min(2, sims.length));
  const appearance = top.reduce((a, b) => a + b, 0) / (top.length || 1);
  const color = Math.max(0, ...sig.views.map((v) => histogramIntersection(candidate.color, v.color)));
  return { appearance, color, score: APPEARANCE_WEIGHT * appearance + COLOR_WEIGHT * color };
}

/**
 * Self-consistency of a registration: how alike its views are to each other (leave-one-out).
 * High = the object looks stable across angles; used to calibrate the match threshold.
 */
export function selfConsistency(sig: ObjectSignature): number {
  const n = sig.views.length;
  if (n < 2) return 0.75;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const others = { views: sig.views.filter((_, j) => j !== i) };
    total += scoreAgainst(sig.views[i]!, others).score;
  }
  return total / n;
}

/** Similarity between two registered objects (max over view pairs). Used to warn about look-alikes. */
export function objectSimilarity(a: ObjectSignature, b: ObjectSignature): number {
  let best = 0;
  for (const v of a.views) best = Math.max(best, scoreAgainst(v, b).score);
  return best;
}

export interface MatchThresholds {
  /** Minimum combined score against the target. */
  accept: number;
  /** Required lead of target score over own-object score. */
  margin: number;
}

/**
 * Per-target threshold calibrated from its registration: an object whose views agree
 * strongly must also be matched strongly. Bounded so it's never trivially low or
 * impossibly high.
 */
export function calibrateThresholds(target: ObjectSignature): MatchThresholds {
  const c = selfConsistency(target);
  return { accept: Math.min(0.8, Math.max(0.55, c - 0.15)), margin: 0.08 };
}

/** Objects at least this similar trigger a "your objects look alike" warning. */
export const LOOKALIKE_WARNING = 0.72;
