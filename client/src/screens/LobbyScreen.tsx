import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { PlayerSlot, PlayerState, RoomState } from "@aoh/shared";
import { Icon, NeonButton, ScreenShell, StatusPill } from "../components/ui";
import { useRoom } from "../multiplayer/RoomProvider";
import { useCamera } from "../camera/CameraProvider";
import { sound } from "../audio/sound";
import { haptic } from "../audio/haptics";

export function inviteUrl(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}join/${code}`;
}

/** Plays feedback when the *opponent* changes state (joins, leaves, gets ready). */
function useOpponentFeedback(state: RoomState, me: PlayerSlot) {
  const prev = useRef<PlayerState | undefined>(undefined);
  const opp = state.players[me === 1 ? 2 : 1];
  useEffect(() => {
    const p = prev.current;
    if (opp?.connected && !p?.connected) {
      sound.play("join");
      haptic("success");
    }
    if (opp?.objectRegistered && !p?.objectRegistered) sound.play("registered");
    if (opp?.ready && !p?.ready) {
      sound.play("ready");
      haptic("ready");
    }
    prev.current = opp;
  }, [opp]);
}

function InviteCard({ code }: { code: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(true);
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(code);

  useEffect(() => {
    // Dark-on-white is what phone camera apps scan most reliably.
    QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#04060c", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  const share = async () => {
    const data = { title: "AR Object Hunt", text: `Join my AR Object Hunt game — code ${code}`, url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      /* user cancelled share sheet — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  };

  return (
    <section className="card invite-card">
      <span className="field-label">Room code</span>
      <div className="room-code" data-testid="room-code" aria-label={`Room code ${code.split("").join(" ")}`}>
        {code.split("").map((ch, i) => (
          <span key={i}>{ch}</span>
        ))}
      </div>
      {showQr && qr && (
        <div className="qr-wrap">
          <img src={qr} alt={`QR code to join room ${code}`} className="qr" width={180} height={180} />
          <p className="field-hint">The other player scans this with their phone camera.</p>
        </div>
      )}
      <div className="invite-actions">
        <NeonButton variant="secondary" onClick={() => void share()} icon={<Icon.Share />}>
          {copied ? "Link copied" : "Share invite"}
        </NeonButton>
        <NeonButton variant="ghost" onClick={() => setShowQr((v) => !v)}>
          {showQr ? "Hide QR" : "Show QR"}
        </NeonButton>
      </div>
    </section>
  );
}

const CAMERA_LABEL = { granted: "Camera ready", denied: "Camera blocked", unavailable: "No camera", unknown: "Camera not checked" } as const;

function PlayerCard({ player, slot, isMe }: { player: PlayerState | undefined; slot: PlayerSlot; isMe: boolean }) {
  if (!player) {
    return (
      <article className="card player-card empty" data-testid={`player-card-${slot}`}>
        <div className="player-avatar waiting">{slot}</div>
        <div className="player-info">
          <h3>Waiting for player {slot}…</h3>
          <p className="field-hint">Share the code or QR invite.</p>
        </div>
      </article>
    );
  }
  return (
    <article className={`card player-card${isMe ? " me" : " opp"}${player.ready ? " is-ready" : ""}`} data-testid={`player-card-${slot}`}>
      <div className="player-avatar">{slot}</div>
      <div className="player-info">
        <h3>
          {player.name}
          {isMe && <span className="you-tag">YOU</span>}
          {slot === 1 && <span className="host-tag">HOST</span>}
        </h3>
        <div className="player-status">
          <StatusPill tone={player.connected ? "ok" : "warn"} testId={`p${slot}-connection`}>
            {player.connected ? `Player ${slot}: Connected` : "Reconnecting…"}
          </StatusPill>
          <StatusPill tone={player.cameraStatus === "granted" ? "ok" : player.cameraStatus === "unknown" ? "idle" : "bad"}>
            {CAMERA_LABEL[player.cameraStatus]}
          </StatusPill>
          <StatusPill tone={player.objectRegistered ? "ok" : "idle"} testId={`p${slot}-object`}>
            {player.objectRegistered ? `Object: ${player.objectLabel}` : "Object not registered"}
          </StatusPill>
          {player.ready && <StatusPill tone="ok" testId={`p${slot}-ready`}>Ready</StatusPill>}
        </div>
      </div>
    </article>
  );
}

export function LobbyScreen({ onCameraSetup }: { onCameraSetup: () => void }) {
  const room = useRoom();
  const camera = useCamera();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const state = room.state!;
  const me = room.slot!;
  const oppSlot: PlayerSlot = me === 1 ? 2 : 1;
  const mine = state.players[me];
  const opp = state.players[oppSlot];
  useOpponentFeedback(state, me);

  // The lobby only needs the permission, not a live feed: release the camera here.
  useEffect(() => {
    if (camera.status === "live") camera.stop();
  }, [camera.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? "Something went wrong.");
      sound.play("error");
    }
  };

  const cameraOk = camera.permission === "granted" || camera.status === "live";

  let footer: JSX.Element;
  if (state.phase === "countdown" || state.phase === "playing") {
    footer = <div className="lobby-status" data-testid="lobby-status">Match starting…</div>;
  } else if (state.phase === "finished") {
    const o = state.outcome;
    const text = !o ? "Match over" : o.kind === "timeout" ? "Time's up — no winner" : o.winner === me ? "You won!" : "You lost";
    footer = (
      <>
        <div className="lobby-status" data-testid="lobby-status">{text}</div>
        <NeonButton block disabled={busy} onClick={() => void act(room.rematch)} data-testid="rematch">
          Rematch
        </NeonButton>
      </>
    );
  } else if (!cameraOk) {
    footer = (
      <NeonButton block icon={<Icon.Camera />} onClick={onCameraSetup} data-testid="lobby-camera">
        Allow Camera
      </NeonButton>
    );
  } else if (!mine?.objectRegistered) {
    footer = (
      <>
        <div className="lobby-status muted">Object scanning arrives in the next update (Phase 3).</div>
        <NeonButton block icon={<Icon.Target />} disabled data-testid="scan-object">
          Scan My Object
        </NeonButton>
      </>
    );
  } else if (state.phase === "lobby") {
    footer = <div className="lobby-status" data-testid="lobby-status">Object Registered — Waiting for Opponent</div>;
  } else if (!mine.ready) {
    footer = (
      <NeonButton block disabled={busy} sfx="ready" onClick={() => void act(() => room.setReady(true))} data-testid="ready">
        I'm Ready
      </NeonButton>
    );
  } else {
    footer = (
      <>
        <div className="lobby-status" data-testid="lobby-status">Ready — Waiting for Player {oppSlot}</div>
        <NeonButton block variant="ghost" disabled={busy} onClick={() => void act(() => room.setReady(false))}>
          Not ready yet
        </NeonButton>
      </>
    );
  }

  return (
    <ScreenShell
      title="Lobby"
      onBack={() => setConfirmLeave(true)}
      className="lobby"
      footer={
        <div className="lobby-footer">
          {error && <p className="form-error" role="alert">{error}</p>}
          {footer}
        </div>
      }
    >
      <div data-testid="lobby" />
      {!opp?.connected || !opp ? <InviteCard code={state.code} /> : <CompactCode code={state.code} />}
      <PlayerCard player={state.players[1]} slot={1} isMe={me === 1} />
      <PlayerCard player={state.players[2]} slot={2} isMe={me === 2} />

      {confirmLeave && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={() => setConfirmLeave(false)}>
          <div className="sheet card" onClick={(e) => e.stopPropagation()}>
            <h2>Leave this game?</h2>
            <p>{me === 1 ? "You're the host — leaving ends the game for both players." : "You can rejoin with the same code while the host is still here."}</p>
            <NeonButton block variant="danger" onClick={room.leave} data-testid="confirm-leave">
              Leave Game
            </NeonButton>
            <NeonButton block variant="ghost" onClick={() => setConfirmLeave(false)}>
              Stay
            </NeonButton>
          </div>
        </div>
      )}
    </ScreenShell>
  );
}

function CompactCode({ code }: { code: string }) {
  return (
    <div className="compact-code">
      <span className="field-label">Room</span>
      <span className="compact-code-value" data-testid="room-code">{code}</span>
    </div>
  );
}
