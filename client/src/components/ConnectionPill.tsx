import { useServer } from "../multiplayer/ServerProvider";
import { StatusPill } from "./ui";

export function ConnectionPill() {
  const { status, clock } = useServer();
  const tone = status === "online" ? "ok" : status === "offline" ? "bad" : status === "no_server" ? "idle" : "warn";
  const label =
    status === "online"
      ? clock
        ? `Server online · ${Math.round(clock.bestRttMs)} ms`
        : "Server online"
      : status === "no_server"
        ? "Game server not connected"
      : status === "reconnecting"
        ? "Reconnecting…"
        : status === "offline"
          ? "No internet"
          : "Connecting…";
  return (
    <StatusPill tone={tone} testId="connection-pill">
      {label}
    </StatusPill>
  );
}
