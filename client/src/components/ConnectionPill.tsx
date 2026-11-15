import { useEffect, useState } from "react";
import { useServer } from "../multiplayer/ServerProvider";
import { StatusPill } from "./ui";

export function ConnectionPill() {
  const { status, clock } = useServer();
  // Free hosting sleeps when idle; the first connection can take up to a minute.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== "connecting") return setSlow(false);
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [status]);
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
          : slow
            ? "Waking up server… (up to 1 min)"
            : "Connecting…";
  return (
    <StatusPill tone={tone} testId="connection-pill">
      {label}
    </StatusPill>
  );
}
