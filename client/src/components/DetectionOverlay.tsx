import { displayName } from "@aoh/shared";
import type { Detection } from "../vision/protocol";

export type BoxTone = "focus" | "dim" | "hit" | "own" | "weak" | "hidden";

export interface OverlayBox {
  det: Detection;
  tone: BoxTone;
  caption?: string;
}

/** AR-style bounding boxes drawn over the camera, in normalised screen coordinates. */
export function DetectionOverlay({ boxes }: { boxes: OverlayBox[] }) {
  return (
    <svg className="det-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {boxes.map(({ det, tone, caption }, i) => {
        const { x, y, w, h } = det.box;
        const X = x * 100;
        const Y = y * 100;
        const W = w * 100;
        const H = h * 100;
        const c = Math.min(W, H) * 0.22;
        return (
          <g key={i} className={`det det-${tone}`}>
            <rect x={X} y={Y} width={W} height={H} className="det-fill" />
            <path
              className="det-corners"
              d={`M${X},${Y + c}V${Y}H${X + c} M${X + W - c},${Y}H${X + W}V${Y + c} M${X + W},${Y + H - c}V${Y + H}H${X + W - c} M${X + c},${Y + H}H${X}V${Y + H - c}`}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {/* Labels are rendered as HTML (see .det-label) so text isn't stretched. */}
    </svg>
  );
}

export function DetectionLabels({ boxes }: { boxes: OverlayBox[] }) {
  return (
    <>
      {boxes
        .filter((b) => b.tone !== "dim" || b.caption)
        .map(({ det, tone, caption }, i) => (
          <div
            key={i}
            className={`det-label det-label-${tone}`}
            style={{ left: `${det.box.x * 100}%`, top: `${Math.max(0, det.box.y * 100)}%` }}
          >
            {caption ?? `${displayName(det.label)} ${Math.round(det.score * 100)}%`}
          </div>
        ))}
    </>
  );
}
