import { useRoom, type ClosedReason } from "../multiplayer/RoomProvider";
import { useServer } from "../multiplayer/ServerProvider";
import { NeonButton } from "./ui";

const CLOSED_TEXT: Record<ClosedReason, { title: string; body: string }> = {
  host_left: { title: "The host ended the game", body: "Create a new game or join another one." },
  idle: { title: "Game closed", body: "The room was closed after a period of inactivity." },
  server_shutdown: { title: "Server restarting", body: "The game server restarted. Please start a new game." },
  expired: { title: "That game has ended", body: "Your previous game is no longer available." },
};

/**
 * Global overlays for multiplayer: connection lost while in a room, and room closed.
 * The server keeps your seat while you're away, so reconnection is automatic.
 */
export function RoomOverlays() {
  const { state, closedReason, dismissClosed, leave, resuming } = useRoom();
  const { status } = useServer();

  if (closedReason) {
    const t = CLOSED_TEXT[closedReason];
    return (
      <div className="sheet-backdrop" role="alertdialog" aria-modal="true" data-testid="room-closed">
        <div className="sheet card">
          <h2>{t.title}</h2>
          <p>{t.body}</p>
          <NeonButton block onClick={dismissClosed}>
            OK
          </NeonButton>
        </div>
      </div>
    );
  }

  if (state && (status !== "online" || resuming)) {
    return (
      <div className="connection-lost" role="alert" aria-live="assertive" data-testid="connection-lost">
        <div className="connection-lost-card card">
          <div className="spinner" aria-hidden />
          <h2>{status === "offline" ? "No internet connection" : "Connection lost"}</h2>
          <p>Reconnecting… Your place in the game is saved.</p>
          <NeonButton block variant="ghost" onClick={leave}>
            Leave Game
          </NeonButton>
        </div>
      </div>
    );
  }
  return null;
}
