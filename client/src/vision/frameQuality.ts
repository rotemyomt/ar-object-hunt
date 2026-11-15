/**
 * Cheap per-frame image quality metrics, computed on the downscaled analysis frame.
 * Used by Camera Check now, and in Phase 3 to reject blurry / dark registration shots
 * (bad reference images are the #1 cause of poor object matching).
 */
export interface FrameQuality {
  /** Mean luma, 0–255. */
  brightness: number;
  /** Mean absolute gradient of luma — higher is sharper. Roughly 0–60 for typical scenes. */
  sharpness: number;
  verdict: "ok" | "too_dark" | "too_bright" | "blurry";
}

export const QUALITY_THRESHOLDS = { dark: 45, bright: 225, blurry: 4.5 } as const;

/** `rgba` is an RGBA byte array (ImageData.data) of size width*height*4. */
export function measureFrameQuality(rgba: Uint8ClampedArray, width: number, height: number, step = 2): FrameQuality {
  if (width < 3 || height < 3) return { brightness: 0, sharpness: 0, verdict: "too_dark" };
  let lumaSum = 0;
  let gradSum = 0;
  let n = 0;
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
  };
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const c = luma(x, y);
      lumaSum += c;
      gradSum += Math.abs(luma(x + 1, y) - luma(x - 1, y)) + Math.abs(luma(x, y + 1) - luma(x, y - 1));
      n++;
    }
  }
  const brightness = lumaSum / n;
  const sharpness = gradSum / n / 2;
  const t = QUALITY_THRESHOLDS;
  const verdict =
    brightness < t.dark ? "too_dark" : brightness > t.bright ? "too_bright" : sharpness < t.blurry ? "blurry" : "ok";
  return { brightness, sharpness, verdict };
}
