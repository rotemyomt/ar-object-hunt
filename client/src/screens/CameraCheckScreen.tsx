import { useEffect, useRef, useState } from "react";
import { CameraView } from "../camera/CameraView";
import { useCamera } from "../camera/CameraProvider";
import { FrameSampler } from "../camera/FrameSampler";
import { measureFrameQuality, type FrameQuality } from "../vision/frameQuality";
import { Reticle } from "../components/Reticle";
import { Icon, IconButton, MuteButton } from "../components/ui";
import { useSettings } from "../game/settings";

const ANALYSIS_MAX_DIM = 320;

interface Stats {
  quality: FrameQuality | null;
  frame: { width: number; height: number } | null;
  sampleFps: number;
  processMs: number;
}

const VERDICT_TEXT: Record<FrameQuality["verdict"], string> = {
  ok: "Good conditions for scanning",
  too_dark: "Too dark — find more light",
  too_bright: "Too bright — avoid pointing at lights",
  blurry: "Blurry — hold steady or move back",
};

/**
 * Live camera diagnostic: proves the full capture → crop → downscale → analyse pipeline the
 * vision system will use, with real brightness/sharpness measurements from each frame.
 */
export function CameraCheckScreen({ onBack, onPractice }: { onBack: () => void; onPractice?: () => void }) {
  const { status, info, error, flip, ensure, stop } = useCamera();
  const { batterySaver, update } = useSettings();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const samplerRef = useRef<FrameSampler | null>(null);
  const [stats, setStats] = useState<Stats>({ quality: null, frame: null, sampleFps: 0, processMs: 0 });

  // Make sure the camera is on while this screen is shown, and off when we leave.
  useEffect(() => {
    void ensure();
    return () => stop();
  }, [ensure, stop]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || status !== "live") return;
    const sampler = new FrameSampler(video, {
      fps: batterySaver ? 4 : 10,
      maxDimension: ANALYSIS_MAX_DIM,
      viewSize: () => ({ width: video.clientWidth, height: video.clientHeight }),
      onFrame: (f) => {
        const ctx = f.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
        const img = ctx.getImageData(0, 0, f.width, f.height);
        const quality = measureFrameQuality(img.data, f.width, f.height);
        const thumb = thumbRef.current;
        if (thumb) {
          if (thumb.width !== f.width || thumb.height !== f.height) {
            thumb.width = f.width;
            thumb.height = f.height;
          }
          thumb.getContext("2d")?.putImageData(img, 0, 0);
        }
        setStats({
          quality,
          frame: { width: f.width, height: f.height },
          sampleFps: sampler.effectiveFps,
          processMs: sampler.avgProcessMs,
        });
      },
    });
    samplerRef.current = sampler;
    sampler.start();
    return () => {
      sampler.stop();
      samplerRef.current = null;
    };
  }, [status, info?.facing, batterySaver]);

  const q = stats.quality;
  return (
    <div className="screen camera-screen" data-testid="camera-check">
      <CameraView ref={videoRef} />
      <div className="camera-vignette" aria-hidden />
      <Reticle state={status === "live" ? (q?.verdict === "ok" ? "locked" : "scanning") : "idle"} />

      <header className="hud-top">
        <IconButton label="Back" onClick={onBack} sfx="back">
          <Icon.Back />
        </IconButton>
        <span className="hud-title">CAMERA CHECK</span>
        <MuteButton />
      </header>

      <section className="hud-bottom">
        <div className={`hud-verdict ${q ? `v-${q.verdict}` : ""}`} data-testid="quality-verdict">
          {status === "live"
            ? q
              ? VERDICT_TEXT[q.verdict]
              : "Analysing…"
            : status === "error"
              ? `${error?.title ?? "Camera error"} — go back to fix`
              : status === "paused"
                ? "Camera paused"
                : "Starting camera…"}
        </div>
        <div className="hud-panel">
          <canvas ref={thumbRef} className="hud-thumb" aria-label="What the recognition system sees" />
          <dl className="hud-stats">
            <div><dt>Camera</dt><dd data-testid="cam-res">{info ? `${info.width}×${info.height}` : "—"}</dd></div>
            <div><dt>Lens</dt><dd>{info ? (info.facing === "environment" ? "Rear" : "Front") : "—"}</dd></div>
            <div><dt>Analysis</dt><dd data-testid="analysis-res">{stats.frame ? `${stats.frame.width}×${stats.frame.height}` : "—"}</dd></div>
            <div><dt>Rate</dt><dd data-testid="sample-fps">{stats.sampleFps.toFixed(1)} fps</dd></div>
            <div><dt>Light</dt><dd>{q ? Math.round(q.brightness) : "—"}</dd></div>
            <div><dt>Sharp</dt><dd>{q ? q.sharpness.toFixed(1) : "—"}</dd></div>
          </dl>
        </div>
        <div className="hud-actions">
          <button
            type="button"
            className={`toggle${batterySaver ? " on" : ""}`}
            aria-pressed={batterySaver}
            onClick={() => update({ batterySaver: !batterySaver })}
          >
            <Icon.Bolt /> Battery saver
          </button>
          {onPractice && (
            <button type="button" className="toggle" onClick={onPractice} data-testid="practice-start">
              <Icon.Target /> Test recognition
            </button>
          )}
          <IconButton label="Switch camera" onClick={() => void flip()}>
            <Icon.Flip />
          </IconButton>
        </div>
      </section>
    </div>
  );
}
