import { useEffect, useMemo, useState } from "react";
import { SUPPORTED_LABELS, displayName, type ObjectRegistration, decodeDescriptor } from "@aoh/shared";
import { CameraView } from "../camera/CameraView";
import { useCamera } from "../camera/CameraProvider";
import { useLiveDetections } from "../vision/useLiveDetections";
import { useVision } from "../vision/useVision";
import { TargetMatcher, type FrameVerdict } from "../vision/matcher";
import { DetectionLabels, DetectionOverlay, type OverlayBox } from "../components/DetectionOverlay";
import { Icon, IconButton, MuteButton } from "../components/ui";
import { VisionLoading } from "../components/VisionLoading";
import { sound } from "../audio/sound";
import { haptic } from "../audio/haptics";

/**
 * Solo recognition test: after scanning an object, point the camera at things and see
 * live match scores against it. Lets players check recognition works with their object
 * and lighting before a real match (and is the best way to judge real-world accuracy).
 */
export function PracticeScreen({ registration, onBack }: { registration: ObjectRegistration; onBack: () => void }) {
  const { ensure, stop, status } = useCamera();
  const visionStatus = useVision(true);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [verdict, setVerdict] = useState<FrameVerdict>({ kind: "none" });
  const [confirmations, setConfirmations] = useState(0);
  const matcher = useMemo(() => {
    const sig = decodeDescriptor(registration.descriptor);
    return sig ? new TargetMatcher(registration.label, sig, null) : null;
  }, [registration]);

  useEffect(() => {
    void ensure();
    return () => stop();
  }, [ensure, stop]);

  useLiveDetections(video, {
    enabled: status === "live" && visionStatus.state === "ready" && !!matcher,
    fps: 5,
    request: { embedLabels: [...SUPPORTED_LABELS], maxEmbeds: 2, minScore: 0.35 },
    onFrame: (f) => {
      if (!matcher) return;
      const { verdict: v, confirmed } = matcher.update(f.detections, Date.now(), () => 1);
      setVerdict(v);
      if (confirmed) {
        setConfirmations((n) => n + 1);
        sound.play("registered");
        haptic("success");
        matcher.reset();
      }
    },
  });

  const boxes: OverlayBox[] =
    "det" in verdict
      ? [{ det: verdict.det, tone: verdict.kind === "hit" ? "hit" : "weak", caption: "score" in verdict ? `match ${Math.round(verdict.score * 100)}%` : undefined }]
      : [];
  const needed = matcher ? Math.round(matcher.thresholds.accept * 100) : 0;

  return (
    <div className="screen camera-screen" data-testid="practice">
      <CameraView ref={setVideo} />
      <div className="camera-vignette" aria-hidden />
      <DetectionOverlay boxes={boxes} />
      <DetectionLabels boxes={boxes} />
      <header className="hud-top">
        <IconButton label="Back" onClick={onBack} sfx="back">
          <Icon.Back />
        </IconButton>
        <span className="hud-title">RECOGNITION TEST</span>
        <MuteButton />
      </header>
      {visionStatus.state !== "ready" && <VisionLoading status={visionStatus} />}
      <section className="hud-bottom">
        <div className={`hud-verdict v-${verdict.kind}`} role="status" data-testid="practice-verdict">
          {verdict.kind === "hit"
            ? `Match! (${verdict.hits}/3)`
            : verdict.kind === "weak"
              ? `Not a match — ${Math.round(verdict.score * 100)}% (needs ${needed}%)`
              : `Show your ${displayName(registration.label)} — or another object to compare`}
        </div>
        <div className="hud-panel practice-panel">
          <div>
            <strong data-testid="practice-confirmations">{confirmations}</strong> confirmed recognitions
          </div>
          <p className="field-hint">
            A confirmation needs 3 matching frames in a row. Try other objects too — they should never confirm.
          </p>
        </div>
      </section>
    </div>
  );
}
