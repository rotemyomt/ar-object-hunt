/**
 * Geometry of the 60-second radial-sweep obstruction.
 *
 * The obstruction is a circular wipe centred on the screen, starting at 12 o'clock and
 * sweeping clockwise. On a non-square (portrait) screen, equal angles do NOT cover equal
 * areas, so we solve for the sweep angle whose covered area equals the target fraction.
 * That makes "25% at 15 s, 50% at 30 s, 75% at 45 s, 100% at 60 s" literally true by area.
 *
 * This module is shared so the same maths drives both the rendered overlay and the
 * detection visibility mask (a detection hidden behind the obstruction must not count),
 * and the server can re-check submitted detection boxes against the match clock.
 *
 * Conventions: screen coordinates, origin top-left, y down. Angles in radians measured
 * clockwise from straight up.
 */

const TAU = Math.PI * 2;

export interface Size {
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Linear area progress for a given elapsed time; 0 at start, 1 at the end. */
export function obstructionProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

/** Point where the ray from the centre at `angle` exits the rectangle. */
export function rayToEdge(angle: number, size: Size): { x: number; y: number } {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const tx = Math.abs(dx) < 1e-12 ? Infinity : cx / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-12 ? Infinity : cy / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Polygon (in screen coordinates) covering the swept region from 0 to `angle`.
 * Includes the rectangle corners passed by the sweep so it can be filled directly.
 */
export function sweptPolygon(angle: number, size: Size): Array<{ x: number; y: number }> {
  const a = Math.min(TAU, Math.max(0, angle));
  const { width: w, height: h } = size;
  const c = { x: w / 2, y: h / 2 };
  if (a <= 0) return [];
  if (a >= TAU) {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  // Corner angles (clockwise from up): top-right, bottom-right, bottom-left, top-left.
  const corners = [
    { x: w, y: 0, ang: Math.atan2(w / 2, h / 2) },
    { x: w, y: h, ang: Math.PI - Math.atan2(w / 2, h / 2) },
    { x: 0, y: h, ang: Math.PI + Math.atan2(w / 2, h / 2) },
    { x: 0, y: 0, ang: TAU - Math.atan2(w / 2, h / 2) },
  ];
  const pts = [c, { x: w / 2, y: 0 }];
  for (const k of corners) if (k.ang < a) pts.push({ x: k.x, y: k.y });
  pts.push(rayToEdge(a, size));
  return pts;
}

function polygonArea(pts: Array<{ x: number; y: number }>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

/** Fraction of the screen area covered by a sweep of `angle` radians. */
export function coveredFractionForAngle(angle: number, size: Size): number {
  const total = size.width * size.height;
  if (total <= 0) return 0;
  return polygonArea(sweptPolygon(angle, size)) / total;
}

/** Inverse of coveredFractionForAngle: sweep angle that covers `fraction` of the area. */
export function angleForCoveredFraction(fraction: number, size: Size): number {
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return 0;
  if (f >= 1) return TAU;
  let lo = 0;
  let hi = TAU;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (coveredFractionForAngle(mid, size) < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Clockwise-from-up angle of a point relative to the screen centre, in [0, 2π). */
export function pointAngle(x: number, y: number, size: Size): number {
  const a = Math.atan2(x - size.width / 2, -(y - size.height / 2));
  return a < 0 ? a + TAU : a;
}

export function isPointVisible(x: number, y: number, size: Size, sweepAngle: number): boolean {
  if (sweepAngle >= TAU) return false;
  return pointAngle(x, y, size) >= sweepAngle;
}

/**
 * Fraction of a box that lies in the still-visible region, estimated on a grid.
 * Used to reject detections that are mostly behind the obstruction.
 */
export function visibleFractionOfBox(box: Box, size: Size, sweepAngle: number, grid = 8): number {
  if (sweepAngle <= 0) return 1;
  if (sweepAngle >= TAU) return 0;
  if (grid < 1) return 0;
  let visible = 0;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = box.x + ((i + 0.5) / grid) * box.width;
      const y = box.y + ((j + 0.5) / grid) * box.height;
      if (x < 0 || y < 0 || x > size.width || y > size.height) continue; // off-screen counts as not visible
      if (isPointVisible(x, y, size, sweepAngle)) visible++;
    }
  }
  return visible / (grid * grid);
}
