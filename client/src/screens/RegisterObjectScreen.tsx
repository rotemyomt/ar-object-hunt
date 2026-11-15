import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_VIEWS,
  MIN_VIEWS,
  SUPPORTED_EXAMPLES,
  SUPPORTED_LABELS,
  displayName,
  encodeDescriptor,
  sameGroup,
  scoreAgainst,
  selfConsistency,
  type ObjectRegistration,
  type View,
} from "@aoh/shared";
import { CameraView } from "../camera/CameraView";
import { useCamera } from "../camera/CameraProvider";
import { useLiveDetections } from "../vision/useLiveDetections";
import { useVision } from "../vision/useVision";
import type { Detection } from "../vision/protocol";
import { iou } from "../vision/imageOps";
import { DetectionLabels, DetectionOverlay, type OverlayBox } from "../components/DetectionOverlay";
import { Icon, IconButton, MuteButton, NeonButton } from "../components/ui";
import { VisionLoading } from "../components/VisionLoading";
import { useSettings } from "../game/settings";
import { sound } from "../audio/sound";
import { haptic } from "../audio/haptics";

const PROMPTS = ["Front", "Turn it a little left", "Turn it a little right", "Show the back", "Tilt it towards you", "Any other angle"];

interface Captured extends View {
  label: string;
  thumbUrl: string | null;
}

/** Pick the supported detection the player is most likely aiming at: big, central, confident. */
function pickFocus(dets: Detection[]): Detection | null {
  let best: Detection | null = null;
  let bestScore = 0;
  for (const d of dets) {
    if (!SUPPORTED_LABELS.has(d.label) || !d.embedding) continue;
    const cx = d.box.x + d.box.w / 2 - 0.5;
    const cy = d.box.y + d.box.h / 2 - 0.5;
    const centrality = 1 - Math.min(1, Math.hypot(cx, cy) * 1.6);
    const s = d.score * Math.sqrt(d.box.w * d.box.h) * (0.4 + centrality);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

const thumbCache = new WeakMap<ImageBitmap, string>();

/** Converts a crop bitmap to a small JPEG data URL (cached: the same detection may be captured twice). */
async function thumbToUrl(bmp: ImageBitmap | undefined): Promise<string | null> {
  if (!bmp) return null;
  const cached = thumbCache.get(bmp);
  if (cached) return cached;
  try {
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    const url = c.toDataURL("image/jpeg", 0.8);
    thumbCache.set(bmp, url);
    return url;
  } catch {
    return null; // bitmap already released — the capture still works, just without a thumbnail
  }
}

export interface RegisterResult {
  registration: ObjectRegistration;
  thumbs: string[];
}

/**
 * Object registration: scan the object from several angles. Each capture stores an
 * appearance embedding + colour signature (never the image itself — thumbnails stay on
 * this phone only). Ends in a confirmation step.
 */
export function RegisterObjectScreen({
  onCancel,
  onConfirm,
  confirmLabel = "Register Object",
}: {
  onCancel: () => void;
  onConfirm: (r: RegisterResult) => Promise<{ ok: boolean; message?: string }>;
  confirmLabel?: string;
}) {
  const { ensure, stop, status } = useCamera();
  const { batterySaver } = useSettings();
  const visionStatus = useVision(true);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [views, setViews] = useState<Captured[]>([]);
  const [stage, setStage] = useState<"scan" | "confirm">("scan");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stableRef = useRef<{ det: Detection; count: number } | null>(null);
  const [lockCount, setLockCount] = useState(0);

  useEffect(() => {
    void ensure();
    return () => stop();
  }, [ensure, stop]);

  const live = useLiveDetections(video, {
    enabled: stage === "scan" && status === "live" && visionStatus.state === "ready",
    fps: batterySaver ? 2 : 4,
    request: { embedLabels: "supported", maxEmbeds: 1, minScore: 0.4, wantThumbs: true },
    // "Locked" = the same object seen in consecutive analysed frames (steady aim).
    onFrame: (f) => {
      const d = pickFocus(f.detections);
      const prev = stableRef.current;
      if (!d) stableRef.current = null;
      else if (prev && prev.det.label === d.label && iou(prev.det.box, d.box) > 0.3) stableRef.current = { det: d, count: prev.count + 1 };
      else stableRef.current = { det: d, count: 1 };
      setLockCount(stableRef.current?.count ?? 0);
    },
  });

  const dets = live.frame?.detections ?? [];
  const focus = useMemo(() => pickFocus(dets), [live.frame]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = !!focus && lockCount >= 2;

  const firstLabel = views[0]?.label;
  const unsupported = dets.find((d) => !SUPPORTED_LABELS.has(d.label) && d.score > 0.5);
  let hint: string;
  if (visionStatus.state !== "ready") hint = "Loading recognition…";
  else if (!live.frame) hint = "Starting scanner…";
  else if (focus && firstLabel && !sameGroup(focus.label, firstLabel) && focus.label !== firstLabel)
    hint = `That's a ${displayName(focus.label)} — keep scanning your ${displayName(firstLabel)}`;
  else if (focus) hint = locked ? `${PROMPTS[views.length] ?? "Capture"} — tap Capture` : "Hold steady…";
  else if (unsupported) hint = `A ${displayName(unsupported.label)} isn't supported. Try: ${SUPPORTED_EXAMPLES.slice(0, 5).join(", ")}`;
  else hint = "Point the camera at your object, filling about a third of the screen";

  const boxes: OverlayBox[] = dets
    .filter((d) => SUPPORTED_LABELS.has(d.label))
    .map((d) => ({ det: d, tone: d === focus ? (locked ? "hit" : "focus") : "dim" }));

  const showToast = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2200);
  };

  const capture = async () => {
    if (!focus?.embedding || !focus.color || !locked) return;
    if (firstLabel && !sameGroup(focus.label, firstLabel) && focus.label !== firstLabel) {
      showToast(`Keep scanning the same ${displayName(firstLabel)}`);
      sound.play("error");
      return;
    }
    const view: View = { embedding: focus.embedding, color: focus.color };
    if (views.length > 0 && scoreAgainst(view, { views }).score > 0.97) {
      showToast("Same angle as before — turn the object a little");
      sound.play("error");
      return;
    }
    const thumbUrl = await thumbToUrl(focus.thumb);
    sound.play("registered");
    haptic("success");
    const next = [...views, { ...view, label: focus.label, thumbUrl }];
    setViews(next);
    if (next.length >= MAX_VIEWS) setStage("confirm");
  };

  // Majority label across views (the detector may flip between e.g. cup/vase).
  const label = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of views) counts.set(v.label, (counts.get(v.label) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [views]);
  const consistency = views.length >= 2 ? selfConsistency({ views }) : 0;
  const strength = consistency > 0.8 ? "Strong" : consistency > 0.68 ? "Good" : "Weak";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const registration: ObjectRegistration = {
      label,
      descriptor: encodeDescriptor({ views: views.map(({ embedding, color }) => ({ embedding, color })) }),
      views: views.length,
    };
    const r = await onConfirm({ registration, thumbs: views.map((v) => v.thumbUrl).filter((u): u is string => !!u) });
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? "Couldn't register the object.");
      sound.play("error");
    }
  };

  if (stage === "confirm") {
    return (
      <div className="screen screen-enter confirm-object" data-testid="confirm-object">
        <header className="screen-header">
          <div className="header-slot">
            <IconButton label="Back" onClick={() => setStage("scan")} sfx="back">
              <Icon.Back />
            </IconButton>
          </div>
          <h1 className="screen-title">Confirm Object</h1>
          <div className="header-slot header-slot-end">
            <MuteButton />
          </div>
        </header>
        <main className="screen-body">
          <section className="card confirm-card">
            <span className="field-label">Your object</span>
            <h2 className="confirm-label" data-testid="confirm-label">{displayName(label)}</h2>
            <div className="thumbs">
              {views.map((v, i) => (v.thumbUrl ? <img key={i} src={v.thumbUrl} alt={`View ${i + 1}`} /> : <div key={i} className="thumb-ph" />))}
            </div>
            <div className={`strength strength-${strength.toLowerCase()}`} data-testid="strength">
              Recognition: {strength} · {views.length} angles
            </div>
            {strength === "Weak" && (
              <p className="field-hint">The views look quite different from each other. Better light, a plainer background or rescanning will help.</p>
            )}
            <p className="field-hint">Only a numeric signature is shared with your opponent's phone — never images.</p>
          </section>
          {error && <p className="form-error" role="alert">{error}</p>}
        </main>
        <footer className="screen-footer lobby-footer">
          <NeonButton block disabled={busy} onClick={() => void confirm()} sfx="ready" data-testid="confirm-register">
            {busy ? "Saving…" : confirmLabel}
          </NeonButton>
          <NeonButton
            block
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setViews([]);
              setStage("scan");
            }}
          >
            Start Over
          </NeonButton>
        </footer>
      </div>
    );
  }

  return (
    <div className="screen camera-screen register" data-testid="register-object">
      <CameraView ref={setVideo} />
      <div className="camera-vignette" aria-hidden />
      <DetectionOverlay boxes={boxes} />
      <DetectionLabels boxes={boxes} />

      <header className="hud-top">
        <IconButton label="Back" onClick={onCancel} sfx="back">
          <Icon.Back />
        </IconButton>
        <span className="hud-title">SCAN MY OBJECT</span>
        <MuteButton />
      </header>

      {visionStatus.state !== "ready" && <VisionLoading status={visionStatus} />}

      <section className="hud-bottom">
        <div className={`hud-verdict${focus && locked ? " v-ok" : ""}`} data-testid="scan-hint" role="status">
          {live.error ? `Recognition error: ${live.error}` : hint}
        </div>
        {toast && <div className="hud-toast" role="alert">{toast}</div>}
        <div className="view-strip" aria-label="Captured angles">
          {Array.from({ length: MAX_VIEWS }, (_, i) => (
            <div key={i} className={`view-slot${views[i] ? " filled" : ""}${i < MIN_VIEWS ? " required" : ""}`}>
              {views[i]?.thumbUrl ? <img src={views[i]!.thumbUrl!} alt="" /> : <span>{i + 1}</span>}
            </div>
          ))}
        </div>
        <div className="register-actions">
          <NeonButton block disabled={!locked} onClick={() => void capture()} icon={<Icon.Camera />} sfx={null} data-testid="capture-view">
            Capture {views.length + 1}/{MAX_VIEWS}
          </NeonButton>
          {views.length >= MIN_VIEWS && (
            <NeonButton variant="secondary" onClick={() => setStage("confirm")} data-testid="finish-scan">
              Done
            </NeonButton>
          )}
        </div>
      </section>
    </div>
  );
}
