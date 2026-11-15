/**
 * Mapping between camera-frame pixels and on-screen CSS pixels for a video shown with
 * `object-fit: cover`. The vision pipeline only ever sees the part of the frame that is
 * actually on screen, so detections line up with what the player sees and with the
 * obstruction mask.
 */
export interface CoverTransform {
  /** Source rectangle (in video pixels) that is visible on screen. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** CSS pixels per video pixel. */
  scale: number;
}

export function coverTransform(videoW: number, videoH: number, viewW: number, viewH: number): CoverTransform {
  if (videoW <= 0 || videoH <= 0 || viewW <= 0 || viewH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, videoW), sh: Math.max(0, videoH), scale: 1 };
  }
  const scale = Math.max(viewW / videoW, viewH / videoH);
  const sw = viewW / scale;
  const sh = viewH / scale;
  return { sx: (videoW - sw) / 2, sy: (videoH - sh) / 2, sw, sh, scale };
}

/** Size of a downscaled analysis frame that keeps the aspect ratio of the visible region. */
export function analysisSize(sw: number, sh: number, maxDim: number): { width: number; height: number } {
  if (sw <= 0 || sh <= 0) return { width: 0, height: 0 };
  const k = Math.min(1, maxDim / Math.max(sw, sh));
  return { width: Math.max(1, Math.round(sw * k)), height: Math.max(1, Math.round(sh * k)) };
}
