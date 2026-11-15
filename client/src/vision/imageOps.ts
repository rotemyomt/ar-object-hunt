import { COLOR_BINS } from "@aoh/shared";

/**
 * Pixel-level helpers shared by the worker (and unit tests). Pure functions on RGBA bytes.
 */

/** RGBA bytes → NCHW float32, value = (px/255 - mean) / std per channel. */
export function toNCHW(rgba: Uint8ClampedArray, w: number, h: number, mean: number, std: number): Float32Array {
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; p < plane; p++, i += 4) {
    out[p] = (rgba[i]! / 255 - mean) / std;
    out[plane + p] = (rgba[i + 1]! / 255 - mean) / std;
    out[2 * plane + p] = (rgba[i + 2]! / 255 - mean) / std;
  }
  return out;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/**
 * 36-bin colour signature of a square crop: 16 hues × 2 saturation levels for coloured
 * pixels + 4 brightness levels for grey/dark pixels. Pixels are weighted by an ellipse
 * centred in the crop, so the object counts more than the background around it.
 */
export function colorSignature(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const hist = new Float32Array(COLOR_BINS);
  const cx = w / 2;
  const cy = h / 2;
  let total = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const nx = (x - cx) / (w * 0.45);
      const ny = (y - cy) / (h * 0.5);
      const weight = 1 - (nx * nx + ny * ny);
      if (weight <= 0) continue;
      const i = (y * w + x) * 4;
      const [hue, sat, val] = rgbToHsv(rgba[i]! / 255, rgba[i + 1]! / 255, rgba[i + 2]! / 255);
      let bin: number;
      if (sat < 0.2 || val < 0.15) bin = 32 + Math.min(3, Math.floor(val * 4));
      else bin = (Math.floor(hue * 16) % 16) * 2 + (sat > 0.55 ? 1 : 0);
      hist[bin]! += weight;
      total += weight;
    }
  }
  if (total > 0) for (let i = 0; i < COLOR_BINS; i++) hist[i]! /= total;
  return hist;
}

/** Square crop region around a normalised box, padded and clamped to the frame (pixels). */
export function squareCrop(
  box: { x: number; y: number; w: number; h: number },
  frameW: number,
  frameH: number,
  pad = 0.1,
): { sx: number; sy: number; size: number } {
  const bw = box.w * frameW;
  const bh = box.h * frameH;
  const size = Math.min(Math.max(bw, bh) * (1 + pad), Math.min(frameW, frameH) * 2);
  const cx = (box.x + box.w / 2) * frameW;
  const cy = (box.y + box.h / 2) * frameH;
  return { sx: cx - size / 2, sy: cy - size / 2, size };
}

export function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
