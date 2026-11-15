import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import {
  TIME_SYNC_SAMPLES,
  estimateClockOffset,
  type ClientToServerEvents,
  type ClockEstimate,
  type ServerToClientEvents,
  type SyncSample,
} from "@aoh/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "offline" | "no_server";

/**
 * Static hosting (e.g. GitHub Pages) can't run the Node game server. Builds made with
 * VITE_NO_SERVER=true and no VITE_SERVER_URL skip connecting and report "no_server".
 */
const NO_SERVER = import.meta.env.VITE_NO_SERVER === "true" && !import.meta.env.VITE_SERVER_URL;

interface ServerContextValue {
  socket: GameSocket;
  status: ConnectionStatus;
  clock: ClockEstimate | null;
  /** Current server time estimate in epoch ms. Use this — never Date.now() — for match timing. */
  serverNow: () => number;
}

const ServerContext = createContext<ServerContextValue | null>(null);

async function syncClock(socket: GameSocket): Promise<ClockEstimate> {
  const samples: SyncSample[] = [];
  for (let i = 0; i < TIME_SYNC_SAMPLES; i++) {
    const clientSentAt = Date.now();
    const serverTime = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("time:sync timeout")), 3000);
      socket.emit("time:sync", clientSentAt, (t) => {
        clearTimeout(timer);
        resolve(t);
      });
    });
    samples.push({ clientSentAt, serverTime, clientReceivedAt: Date.now() });
    await new Promise((r) => setTimeout(r, 60));
  }
  return estimateClockOffset(samples);
}

export function ServerProvider({ children }: { children: ReactNode }) {
  const socket = useMemo<GameSocket>(
    () =>
      io(import.meta.env.VITE_SERVER_URL || undefined, {
        // Start with WebSocket; fall back to long-polling on restrictive networks.
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: 8000,
        autoConnect: false,
      }),
    [],
  );
  const [status, setStatus] = useState<ConnectionStatus>(NO_SERVER ? "no_server" : "connecting");
  const [clock, setClock] = useState<ClockEstimate | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (NO_SERVER) return;
    let resyncTimer: ReturnType<typeof setInterval> | undefined;
    const resync = () =>
      syncClock(socket)
        .then((c) => {
          offsetRef.current = c.offsetMs;
          setClock(c);
        })
        .catch(() => {/* keep previous estimate */});

    const onConnect = () => {
      setStatus("online");
      void resync();
      clearInterval(resyncTimer);
      resyncTimer = setInterval(resync, 30_000); // clocks drift; refresh periodically
    };
    const onDisconnect = () => setStatus(navigator.onLine ? "reconnecting" : "offline");
    const onError = () => setStatus((s) => (s === "online" ? "reconnecting" : navigator.onLine ? "connecting" : "offline"));

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onError);
    socket.connect();
    return () => {
      clearInterval(resyncTimer);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onError);
      socket.disconnect();
    };
  }, [socket]);

  const value = useMemo<ServerContextValue>(
    () => ({ socket, status, clock, serverNow: () => Date.now() + offsetRef.current }),
    [socket, status, clock],
  );
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error("useServer must be used inside <ServerProvider>");
  return ctx;
}
