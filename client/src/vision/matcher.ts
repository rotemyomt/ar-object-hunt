import {
  calibrateThresholds,
  sameGroup,
  scoreAgainst,
  type MatchThresholds,
  type ObjectSignature,
} from "@aoh/shared";
import type { Detection } from "./protocol";
import { iou } from "./imageOps";

/**
 * Decides when the opponent's object has REALLY been seen. A single frame never wins.
 *
 * Per frame, a detection is a "hit" only if ALL hold:
 *  1. Its category is compatible with the target's (same detector group).
 *  2. Its combined appearance+colour score ≥ the target's calibrated threshold.
 *  3. It matches the target clearly better than the player's OWN object (margin), so
 *     you can never win by showing your own object, even a similar-looking one.
 *  4. Enough of its box is in the still-visible part of the screen (obstruction mask).
 *
 * A confirmation needs CONFIRM_HITS hits within the last WINDOW frames, inside
 * WINDOW_MS, on boxes that overlap/move plausibly (same physical object, not two
 * random look-alikes in different places).
 */
export const CONFIRM_HITS = 3;
export const WINDOW = 5;
export const WINDOW_MS = 2500;
export const MIN_VISIBLE_FRACTION = 0.6;
export const MIN_DETECTOR_SCORE = 0.35;

export type FrameVerdict =
  | { kind: "none" }
  | { kind: "own"; det: Detection; ownScore: number }
  | { kind: "hidden"; det: Detection }
  | { kind: "weak"; det: Detection; score: number; needed: number }
  | { kind: "hit"; det: Detection; score: number; ownScore: number; hits: number };

export interface Confirmation {
  box: Detection["box"];
  label: string;
  score: number;
  ownScore: number;
  hits: number;
  /** Server-clock time of the confirming frame. */
  at: number;
}

interface Hit {
  t: number;
  box: Detection["box"];
}

export class TargetMatcher {
  readonly thresholds: MatchThresholds;
  private history: Array<Hit | null> = [];

  constructor(
    private readonly targetLabel: string,
    private readonly target: ObjectSignature,
    private readonly own: ObjectSignature | null,
    thresholds?: MatchThresholds,
  ) {
    this.thresholds = thresholds ?? calibrateThresholds(target);
  }

  /** Labels worth spending embedding time on this frame. */
  isCandidateLabel(label: string): boolean {
    return label === this.targetLabel || sameGroup(label, this.targetLabel);
  }

  reset() {
    this.history = [];
  }

  /**
   * Feed one analysed frame. `visibleFraction(box)` reports how much of a box is outside
   * the obstruction at capture time. Returns the frame verdict and, if the evidence is
   * now sufficient, a confirmation.
   */
  update(
    detections: Detection[],
    at: number,
    visibleFraction: (box: Detection["box"]) => number,
  ): { verdict: FrameVerdict; confirmed: Confirmation | null } {
    let best: FrameVerdict = { kind: "none" };
    let bestRank = -1;
    const rank = (v: FrameVerdict) => ({ none: 0, hidden: 1, own: 2, weak: 3, hit: 4 })[v.kind];

    for (const det of detections) {
      if (!det.embedding || !det.color || det.score < MIN_DETECTOR_SCORE || !this.isCandidateLabel(det.label)) continue;
      const view = { embedding: det.embedding, color: det.color };
      const t = scoreAgainst(view, this.target).score;
      const o = this.own ? scoreAgainst(view, this.own).score : 0;
      let v: FrameVerdict;
      if (this.own && o >= t) v = { kind: "own", det, ownScore: o };
      else if (t < this.thresholds.accept || t - o < this.thresholds.margin) v = { kind: "weak", det, score: t, needed: this.thresholds.accept };
      else if (visibleFraction(det.box) < MIN_VISIBLE_FRACTION) v = { kind: "hidden", det };
      else v = { kind: "hit", det, score: t, ownScore: o, hits: 0 };
      const r = rank(v);
      // Prefer the strongest verdict; among hits/weak, the higher score.
      const better =
        r > bestRank ||
        (r === bestRank && "score" in v && "score" in best && (v as { score: number }).score > (best as { score: number }).score);
      if (better) {
        best = v;
        bestRank = r;
      }
    }

    this.history.push(best.kind === "hit" ? { t: at, box: best.det.box } : null);
    if (this.history.length > WINDOW) this.history.shift();

    if (best.kind !== "hit") return { verdict: best, confirmed: null };

    // Count recent hits that plausibly belong to the same physical object as this one.
    const recent = this.history.filter((h): h is Hit => h !== null && at - h.t <= WINDOW_MS);
    const consistent = recent.filter((h) => iou(h.box, best.det.box) > 0.1 || centerDistance(h.box, best.det.box) < 0.3);
    const hits = consistent.length;
    const verdict: FrameVerdict = { ...best, hits };
    if (hits >= CONFIRM_HITS) {
      return {
        verdict,
        confirmed: { box: best.det.box, label: best.det.label, score: best.score, ownScore: best.ownScore, hits, at },
      };
    }
    return { verdict, confirmed: null };
  }
}

function centerDistance(a: Detection["box"], b: Detection["box"]): number {
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  return Math.hypot(dx, dy);
}
