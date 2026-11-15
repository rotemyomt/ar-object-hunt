import { analysisSize, coverTransform } from "./geometry";

export interface SampledFrame {
  /** Downscaled frame of exactly the on-screen region of the video. */
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  /** performance.now() when the frame was captured. */
  capturedAt: number;
  /** CSS-pixel size of the viewport the frame corresponds to. */
  viewWidth: number;
  viewHeight: number;
}

export interface FrameSamplerOptions {
  /** Target analysis rate. Adjustable at runtime (battery saver / adaptive). */
  fps: number;
  /** Longest side of the analysis frame, in pixels. Small frames keep inference fast. */
  maxDimension: number;
  /** Returns the current on-screen size of the video element. */
  viewSize: () => { width: number; height: number };
  /** Processing callback. Awaited — no new frame is captured until it resolves. */
  onFrame: (frame: SampledFrame) => void | Promise<void>;
}

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Pulls frames from a <video> at a bounded rate for computer vision.
 *
 * - Crops to the visible `object-fit: cover` region so vision sees what the player sees.
 * - Downscales before processing (never runs a model on a full 720p/1080p frame).
 * - Never overlaps work: if inference is slower than the target fps, frames are dropped.
 * - Idles while the page is hidden.
 * - Uses requestVideoFrameCallback when available so we only sample genuinely new frames.
 */
export class FrameSampler {
  private running = false;
  private busy = false;
  private lastCapture = 0;
  private handle: number | null = null;
  private usingRVFC = false;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  /** Rolling average processing time in ms (exposed for adaptive throttling + HUD). */
  avgProcessMs = 0;
  /** Measured effective sampling rate. */
  effectiveFps = 0;
  private fpsWindow: number[] = [];

  constructor(
    private readonly video: HTMLVideoElement,
    private opts: FrameSamplerOptions,
  ) {
    this.canvas =
      typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true, alpha: false } as CanvasRenderingContext2DSettings);
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  }

  setFps(fps: number) {
    this.opts = { ...this.opts, fps: Math.max(0.5, Math.min(30, fps)) };
  }

  get fps() {
    return this.opts.fps;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.handle !== null) {
      const v = this.video as VideoWithRVFC;
      if (this.usingRVFC) v.cancelVideoFrameCallback?.(this.handle);
      else cancelAnimationFrame(this.handle);
      this.handle = null;
    }
  }

  private schedule() {
    if (!this.running) return;
    const v = this.video as VideoWithRVFC;
    this.usingRVFC = typeof v.requestVideoFrameCallback === "function";
    this.handle = this.usingRVFC ? v.requestVideoFrameCallback!(() => this.tick()) : requestAnimationFrame(() => this.tick());
  }

  private tick() {
    this.handle = null;
    if (!this.running) return;
    const now = performance.now();
    const interval = 1000 / this.opts.fps;
    const ready = this.video.readyState >= 2 && this.video.videoWidth > 0;
    if (ready && !this.busy && document.visibilityState === "visible" && now - this.lastCapture >= interval - 2) {
      this.lastCapture = now;
      void this.capture(now);
    }
    this.schedule();
  }

  private async capture(now: number) {
    const view = this.opts.viewSize();
    const t = coverTransform(this.video.videoWidth, this.video.videoHeight, view.width, view.height);
    const size = analysisSize(t.sw, t.sh, this.opts.maxDimension);
    if (size.width === 0) return;
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    this.ctx.drawImage(this.video, t.sx, t.sy, t.sw, t.sh, 0, 0, size.width, size.height);

    this.fpsWindow.push(now);
    while (this.fpsWindow.length > 0 && now - this.fpsWindow[0]! > 2000) this.fpsWindow.shift();
    this.effectiveFps = this.fpsWindow.length / 2;

    this.busy = true;
    const t0 = performance.now();
    try {
      await this.opts.onFrame({
        canvas: this.canvas,
        width: size.width,
        height: size.height,
        capturedAt: now,
        viewWidth: view.width,
        viewHeight: view.height,
      });
    } finally {
      const dt = performance.now() - t0;
      this.avgProcessMs = this.avgProcessMs === 0 ? dt : this.avgProcessMs * 0.85 + dt * 0.15;
      this.busy = false;
    }
  }
}
