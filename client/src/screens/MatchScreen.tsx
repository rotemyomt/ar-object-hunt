import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SUPPORTED_LABELS,
  angleForCoveredFraction,
  decodeDescriptor,
  displayName,
  obstructionProgress,
  visibleFractionOfBox,
  type DetectionReport,
  type PlayerSlot,
} from "@aoh/shared";
import { CameraView } from "../camera/CameraView";
import { useCamera } from "../camera/CameraProvider";
import { useServer } from "../multiplayer/ServerProvider";
import { useRoom } from "../multiplayer/RoomProvider";
import { useLiveDetections, type LiveFrame } from "../vision/useLiveDetections";
import { useVision } from "../vision/useVision";
import { TargetMatcher, type FrameVerdict } from "../vision/matcher";
import { DetectionLabels, DetectionOverlay, type OverlayBox } from "../components/DetectionOverlay";
import { SweepObstruction } from "../animations/SweepObstruction";
import { Confetti } from "../animations/Confetti";
import { MuteButton, NeonButton } from "../components/ui";
import { VisionLoading } from "../components/VisionLoading";
import { useWakeLock } from "../game/useWakeLock";
import { useSettings } from "../game/settings";
import { sound } from "../audio/sound";
import { setUpdateBlocked } from "../pwa";
import { haptic } from "../audio/haptics";

/** Re-render on every animation frame-ish tick (for timers/countdown text). */
function useTicker(ms = 100) {
  const [, set] = useState(0);
  useEffect(() => {
    const h = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(h);
  }, [ms]);
}

const VERDICT_TEXT: Record<FrameVerdict["kind"], string> = {
  none: "Scanning…",
  weak: "Not their object",
  own: "That's YOUR object!",
  hidden: "Behind the sweep — doesn't count",
  hit: "Locking on…",
};

export function MatchScreen({ onExit }: { onExit: () => void }) {
  const room = useRoom();
  const { serverNow, socket } = useServer();
  const camera = useCamera();
  const { batterySaver } = useSettings();
  const visionStatus = useVision(true);
  const state = room.state!;
  const me = room.slot!;
  const oppSlot: PlayerSlot = me === 1 ? 2 : 1;
  const opp = state.players[oppSlot];
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [verdict, setVerdict] = useState<FrameVerdict>({ kind: "none" });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useTicker(100);

  const live = state.phase === "countdown" || state.phase === "playing";
  useWakeLock(live);
  // Never reload for an app update in the middle of a match.
  useEffect(() => {
    setUpdateBlocked(live);
    return () => setUpdateBlocked(false);
  }, [live]);

  // Camera on for the whole match; off when we leave.
  useEffect(() => {
    void camera.ensure();
    return () => camera.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const matcher = useMemo(() => {
    const t = room.target;
    if (!t || t.round !== state.round) return null;
    const target = decodeDescriptor(t.target.descriptor);
    const own = decodeDescriptor(t.own.descriptor);
    return target ? new TargetMatcher(t.target.label, target, own) : null;
  }, [room.target, state.round]);

  // --- countdown ---------------------------------------------------------------------
  const now = serverNow();
  const toStart = (state.matchStartsAt ?? 0) - now;
  const countdownN = state.phase === "countdown" ? Math.ceil(toStart / 1000) : 0;
  const lastBeep = useRef<number | null>(null);
  useEffect(() => {
    if (state.phase !== "countdown") return;
    if (countdownN >= 1 && countdownN <= 3 && lastBeep.current !== countdownN) {
      lastBeep.current = countdownN;
      sound.play("tick");
      haptic("tick");
    }
  }, [countdownN, state.phase]);
  const goShownUntil = useRef(0);
  useEffect(() => {
    if (state.phase === "playing" && lastBeep.current !== 0) {
      lastBeep.current = 0;
      goShownUntil.current = performance.now() + 900;
      sound.play("go");
      haptic("go");
    }
  }, [state.phase]);

  // --- timer + final-10s cues ----------------------------------------------------------
  const remainingMs = Math.max(0, (state.matchEndsAt ?? 0) - now);
  const secs = Math.ceil(remainingMs / 1000);
  const lastWarn = useRef<number | null>(null);
  useEffect(() => {
    if (state.phase === "playing" && secs <= 10 && secs >= 1 && lastWarn.current !== secs) {
      lastWarn.current = secs;
      sound.play("warning");
      if (secs <= 3) haptic("warning");
    }
  }, [secs, state.phase]);
  const lastQuarter = useRef(-1);
  const onSweepProgress = useCallback((p: number) => {
    const q = Math.floor(p * 4);
    if (q !== lastQuarter.current && q > 0 && q < 4) sound.play("sweep");
    lastQuarter.current = q;
  }, []);

  // --- live recognition ------------------------------------------------------------------
  const submit = useCallback(
    async (report: DetectionReport) => {
      setSubmitting(true);
      const r = await new Promise<{ ok: boolean; accepted?: boolean; reason?: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false }), 6000);
        socket.emit("match:detect", report, (res) => {
          clearTimeout(timer);
          resolve(res.ok ? { ok: true, accepted: res.data.accepted, reason: res.data.reason } : { ok: false, reason: res.message });
        });
      });
      setSubmitting(false);
      if (!r.accepted) {
        // Server said no (e.g. opponent already won, or box was behind the sweep): keep hunting.
        if (r.reason) setNotice(r.reason);
        setTimeout(() => setNotice(null), 2500);
        matcher?.reset();
      }
    },
    [socket, matcher],
  );

  const onFrame = useCallback(
    (f: LiveFrame) => {
      if (!matcher || state.phase !== "playing" || submitting) return;
      // Map the frame's capture time onto the server clock.
      const at = serverNow() - (performance.now() - f.capturedAt);
      const progress = obstructionProgress(at - (state.matchStartsAt ?? at), (state.matchEndsAt ?? 0) - (state.matchStartsAt ?? 0));
      const angle = angleForCoveredFraction(progress, f.view);
      const visible = (b: { x: number; y: number; w: number; h: number }) =>
        visibleFractionOfBox(
          { x: b.x * f.view.width, y: b.y * f.view.height, width: b.w * f.view.width, height: b.h * f.view.height },
          f.view,
          angle,
        );
      const { verdict: v, confirmed } = matcher.update(f.detections, at, visible);
      setVerdict(v);
      if (v.kind === "hit") haptic("tap");
      if (v.kind === "own") haptic("error");
      if (confirmed) {
        void submit({
          round: state.round,
          at: confirmed.at,
          label: confirmed.label,
          box: confirmed.box,
          view: f.view,
          score: Math.min(1, confirmed.score),
          ownScore: confirmed.ownScore,
          hits: confirmed.hits,
        });
      }
    },
    [matcher, state.phase, state.round, state.matchStartsAt, state.matchEndsAt, submitting, serverNow, submit],
  );

  const recognising = live && camera.status === "live" && visionStatus.state === "ready" && !!matcher;
  const liveDet = useLiveDetections(video, {
    enabled: recognising,
    fps: batterySaver ? 3 : 6,
    request: {
      // Only spend embedding time on categories that could be the target.
      embedLabels: matcher ? [...SUPPORTED_LABELS].filter((l) => matcher.isCandidateLabel(l)) : "none",
      maxEmbeds: 2,
      minScore: 0.35,
    },
    onFrame,
  });

  const boxes: OverlayBox[] = [];
  if (state.phase === "playing" && "det" in verdict) {
    const tone = verdict.kind === "hit" ? "hit" : verdict.kind === "own" ? "own" : verdict.kind === "hidden" ? "hidden" : "weak";
    const caption = verdict.kind === "hit" ? `LOCK ${verdict.hits}/3` : verdict.kind === "own" ? "YOUR OBJECT" : undefined;
    boxes.push({ det: verdict.det, tone, caption });
  }

  // --- results -------------------------------------------------------------------------
  const outcome = state.phase === "finished" ? state.outcome : null;
  const iWon = outcome?.kind === "win" && outcome.winner === me;
  const played = useRef(false);
  useEffect(() => {
    if (!outcome || played.current) return;
    played.current = true;
    if (iWon) {
      sound.play("victory");
      haptic("victory");
    } else {
      sound.play("defeat");
      haptic("defeat");
    }
  }, [outcome, iWon]);

  const targetName = room.target ? displayName(room.target.target.label) : opp?.objectLabel ? displayName(opp.objectLabel) : "object";

  return (
    <div className={`screen camera-screen match${outcome ? " has-result" : ""}`} data-testid="match">
      <CameraView ref={setVideo} />
      <div className="camera-vignette" aria-hidden />
      {state.phase !== "countdown" && state.matchStartsAt && state.matchEndsAt && (
        <SweepObstruction startsAt={state.matchStartsAt} endsAt={state.matchEndsAt} serverNow={serverNow} onProgress={onSweepProgress} />
      )}
      {state.phase === "playing" && <DetectionOverlay boxes={boxes} />}
      {state.phase === "playing" && <DetectionLabels boxes={boxes} />}

      {/* HUD */}
      <header className="hud-top match-hud">
        <div className={`opp-chip${opp?.connected ? "" : " offline"}`} data-testid="opponent-status">
          <span className="pill-dot" />
          {opp?.name ?? "Opponent"}
          {!opp?.connected && " · reconnecting"}
        </div>
        <div className={`timer${secs <= 10 && state.phase === "playing" ? " urgent" : ""}`} data-testid="timer" aria-live="off">
          {state.phase === "countdown" ? "1:00" : `0:${String(Math.min(60, secs)).padStart(2, "0")}`}
        </div>
        <MuteButton />
      </header>

      {state.phase === "playing" && (
        <div className="target-chip" data-testid="target-chip">
          <span className="field-label">Find</span> {opp?.name ?? "Opponent"}'s {targetName}
        </div>
      )}

      {state.phase === "countdown" && (
        <div className="countdown" data-testid="countdown" aria-live="assertive">
          <div className="countdown-stack">
            {countdownN > 3 ? (
              <span className="countdown-ready">GET READY</span>
            ) : (
              <span key={countdownN} className="countdown-num">{Math.max(1, countdownN)}</span>
            )}
            <div className="countdown-hint">
              <strong>Hide your object!</strong>
              <span>Then find {opp?.name ?? "your opponent"}'s {targetName}</span>
            </div>
          </div>
        </div>
      )}
      {state.phase === "playing" && performance.now() < goShownUntil.current && (
        <div className="countdown"><span className="countdown-num go">GO!</span></div>
      )}

      {state.phase === "playing" && (
        <section className="hud-bottom match-bottom">
          {!recognising && visionStatus.state !== "ready" ? (
            <VisionLoading status={visionStatus} compact />
          ) : (
            <div className={`hud-verdict v-${verdict.kind}`} data-testid="verdict" role="status">
              {submitting ? "Target found — verifying…" : notice ?? VERDICT_TEXT[verdict.kind]}
            </div>
          )}
          {liveDet.error && <div className="hud-toast">Recognition error: {liveDet.error}</div>}
        </section>
      )}

      {outcome && (
        <div className={`result ${iWon ? "won" : outcome.kind === "timeout" ? "timeout" : "lost"}`} data-testid="result" role="alert">
          {iWon && <Confetti />}
          <div className="result-card">
            {outcome.kind === "timeout" ? (
              <>
                <h1>Time's Up!</h1>
                <p className="result-sub">No Winner — Both Players Lost</p>
              </>
            ) : iWon ? (
              <>
                <h1>You Won! :)</h1>
                <p className="result-sub">
                  {outcome.reason === "detection" ? `You found ${opp?.name ?? "their"}'s ${targetName}!` : `${opp?.name ?? "Your opponent"} left the match.`}
                </p>
              </>
            ) : (
              <>
                <h1>You Lost! :(</h1>
                <p className="result-sub">
                  {outcome.reason === "detection" ? `${opp?.name ?? "Your opponent"} found your object first.` : "You left or lost connection during the match."}
                </p>
              </>
            )}
            <div className="result-actions">
              <NeonButton block onClick={() => void room.rematch()} data-testid="rematch">
                Rematch
              </NeonButton>
              <NeonButton block variant="ghost" onClick={onExit}>
                Back to Lobby
              </NeonButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
