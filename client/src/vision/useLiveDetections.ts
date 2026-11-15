import { useEffect, useRef, useState } from "react";
import { FrameSampler, type SampledFrame } from "../camera/FrameSampler";
import { vision } from "./VisionEngine";
import type { Detection, DetectRequest } from "./protocol";

export interface LiveFrame {
  detections: Detection[];
  /** performance.now() when the frame was captured. */
  capturedAt: number;
  view: { width: number; height: number };
  detectMs: number;
}

interface Options {
  enabled: boolean;
  fps: number;
  request: Omit<DetectRequest, "type" | "id" | "frame" | "size">;
  /** Called for every analysed frame (in addition to the returned state). */
  onFrame?: (f: LiveFrame) => void;
}

/**
 * Runs the vision engine continuously on the live camera. Adapts the detector resolution
 * to the phone's speed so slower devices still get several analyses per second.
 */
export function useLiveDetections(video: HTMLVideoElement | null, { enabled, fps, request, onFrame }: Options) {
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sizeRef = useRef(480);
  const avgMs = useRef(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const reqRef = useRef(request);
  reqRef.current = request;

  useEffect(() => {
    if (!video || !enabled) return;
    let alive = true;
    const sampler = new FrameSampler(video, {
      fps,
      maxDimension: 640,
      viewSize: () => ({ width: video.clientWidth, height: video.clientHeight }),
      onFrame: async (f: SampledFrame) => {
        try {
          const r = await vision.detect(f.canvas as HTMLCanvasElement, { ...reqRef.current, size: sizeRef.current });
          if (!alive) return;
          // Adaptive resolution: keep total detect time ≲ 450 ms.
          avgMs.current = avgMs.current ? avgMs.current * 0.7 + r.detectMs * 0.3 : r.detectMs;
          if (avgMs.current > 450 && sizeRef.current > 320) sizeRef.current -= 64;
          else if (avgMs.current < 180 && sizeRef.current < 480) sizeRef.current += 64;
          const lf: LiveFrame = { detections: r.detections, capturedAt: f.capturedAt, view: { width: f.viewWidth, height: f.viewHeight }, detectMs: r.detectMs };
          setFrame(lf);
          setError(null);
          onFrameRef.current?.(lf);
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
    sampler.start();
    return () => {
      alive = false;
      sampler.stop();
    };
  }, [video, enabled, fps]);

  return { frame, error, detectorSize: sizeRef.current };
}
