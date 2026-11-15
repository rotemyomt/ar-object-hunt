import type { VisionStatus } from "../vision/VisionEngine";
import { vision } from "../vision/VisionEngine";
import { NeonButton } from "./ui";

/** Progress card while the recognition models download / start (first time ≈ 20 MB, then cached). */
export function VisionLoading({ status, compact }: { status: VisionStatus; compact?: boolean }) {
  if (status.state === "ready" || status.state === "idle") return null;
  if (status.state === "error") {
    return (
      <div className={`vision-loading card${compact ? " compact" : ""}`} role="alert">
        <strong>Recognition couldn't start</strong>
        <p>{status.message}</p>
        <NeonButton variant="secondary" onClick={() => void vision.load().catch(() => {})}>
          Try Again
        </NeonButton>
      </div>
    );
  }
  const pct = Math.round(status.progress * 100);
  return (
    <div className={`vision-loading card${compact ? " compact" : ""}`} role="status" data-testid="vision-loading">
      <strong>{pct < 100 ? "Downloading recognition models" : "Starting recognition…"}</strong>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      {!compact && <p>{pct < 100 ? `${pct}% · first time only, then works offline` : "Almost ready"}</p>}
    </div>
  );
}
