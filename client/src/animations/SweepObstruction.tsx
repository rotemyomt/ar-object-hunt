import { useEffect, useRef } from "react";
import { angleForCoveredFraction, obstructionProgress, rayToEdge, sweptPolygon } from "@aoh/shared";

interface Props {
  /** Server epoch ms when the hunt starts / ends. */
  startsAt: number;
  endsAt: number;
  /** Current server time estimate. */
  serverNow: () => number;
  /** Called about 4× per second with progress (0..1), for HUD/audio cues. */
  onProgress?: (p: number) => void;
}

const TRAIL = 0.55; // radians of fading radar trail behind the sweep line

/**
 * The 60-second radial-sweep obstruction. A real visual barrier: the swept region is
 * painted (near-)opaque over the camera, using the exact same geometry the detection mask
 * and the server use. Progress comes from the server clock, so both phones match.
 */
export function SweepObstruction({ startsAt, endsAt, serverNow, onProgress }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressCb = useRef(onProgress);
  progressCb.current = onProgress;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let lastReport = 0;
    let pattern: CanvasPattern | null = null;

    const makePattern = (dpr: number) => {
      const p = document.createElement("canvas");
      p.width = p.height = Math.round(24 * dpr);
      const g = p.getContext("2d")!;
      g.fillStyle = "rgba(3,7,14,0.965)";
      g.fillRect(0, 0, p.width, p.height);
      g.strokeStyle = "rgba(0,229,255,0.07)";
      g.lineWidth = dpr;
      g.beginPath();
      g.moveTo(0, 0.5);
      g.lineTo(p.width, 0.5);
      g.moveTo(0.5, 0);
      g.lineTo(0.5, p.height);
      g.stroke();
      return ctx.createPattern(p, "repeat");
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        pattern = makePattern(dpr);
      }
      const size = { width: w, height: h };
      const p = obstructionProgress(serverNow() - startsAt, endsAt - startsAt);
      const angle = angleForCoveredFraction(p, size);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Covered region (the actual barrier).
      const poly = sweptPolygon(angle, size);
      if (poly.length) {
        ctx.beginPath();
        poly.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
        ctx.closePath();
        ctx.fillStyle = pattern ?? "rgba(3,7,14,0.965)";
        ctx.fill();
      }

      if (p < 1) {
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.hypot(cx, cy);
        // Radar trail: a soft wedge just ahead of the covered area... drawn into the visible side.
        const toCanvas = (a: number) => a - Math.PI / 2; // our 0 = 12 o'clock, canvas 0 = 3 o'clock
        const grad = ctx.createConicGradient?.(toCanvas(angle) , cx, cy);
        if (grad) {
          const t = TRAIL / (Math.PI * 2);
          grad.addColorStop(0, "rgba(0,229,255,0.0)");
          grad.addColorStop(Math.max(0.0001, 1 - t), "rgba(0,229,255,0.0)");
          grad.addColorStop(0.9999, "rgba(0,229,255,0.16)");
          grad.addColorStop(1, "rgba(0,229,255,0.0)");
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, R, toCanvas(angle - TRAIL), toCanvas(angle));
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.fill();
        }
        // The sweep line: bright core + glow.
        const edge = rayToEdge(angle, size);
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(0,229,255,0.9)";
        ctx.shadowBlur = 18;
        ctx.strokeStyle = "rgba(125,249,255,0.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(edge.x, edge.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Hub
        ctx.fillStyle = "#7df9ff";
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,229,255,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      const now = performance.now();
      if (now - lastReport > 250) {
        lastReport = now;
        progressCb.current?.(p);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [startsAt, endsAt, serverNow]);

  return <canvas ref={canvasRef} className="sweep" data-testid="sweep" aria-hidden />;
}
