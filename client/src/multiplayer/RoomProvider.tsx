import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AckResult,
  CameraStatus,
  MatchTarget,
  ObjectRegistration,
  PlayerSlot,
  RoomClosedReason,
  RoomState,
  SessionCredentials,
} from "@aoh/shared";
import { useServer, type GameSocket } from "./ServerProvider";
import { useCamera } from "../camera/CameraProvider";

export type ActionResult = { ok: true } | { ok: false; message: string };
export type ClosedReason = RoomClosedReason | "expired";

interface RoomContextValue {
  state: RoomState | null;
  slot: PlayerSlot | null;
  /** What this player must find, once the server schedules a match. */
  target: MatchTarget | null;
  closedReason: ClosedReason | null;
  /** True while re-attaching to a saved session after a reload / reconnect. */
  resuming: boolean;
  create: (name: string) => Promise<ActionResult>;
  join: (code: string, name: string) => Promise<ActionResult>;
  leave: () => void;
  setReady: (ready: boolean) => Promise<ActionResult>;
  register: (reg: ObjectRegistration) => Promise<ActionResult>;
  clearObject: () => Promise<ActionResult>;
  rematch: () => Promise<ActionResult>;
  dismissClosed: () => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);
const SESSION_KEY = "aoh.session.v1";
const ACK_TIMEOUT_MS = 8000;

function loadSession(): SessionCredentials | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionCredentials) : null;
  } catch {
    return null;
  }
}
function saveSession(s: SessionCredentials | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: reconnect after reload won't work, live play still does */
  }
}

/** Emit with an acknowledgement and a timeout, so a dead connection never hangs the UI. */
function request<T>(socket: GameSocket, send: (ack: (r: AckResult<T>) => void) => void): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: "INTERNAL", message: "Not connected to the game server." });
      return;
    }
    const timer = setTimeout(
      () => resolve({ ok: false, error: "INTERNAL", message: "The server didn't answer. Check your connection." }),
      ACK_TIMEOUT_MS,
    );
    send((r) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

function cameraStatusFor(permission: string, errorKind: string | undefined): CameraStatus {
  if (permission === "granted") return "granted";
  if (permission === "denied" || errorKind === "denied") return "denied";
  if (errorKind === "unsupported" || errorKind === "no_camera" || errorKind === "insecure") return "unavailable";
  return "unknown";
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const { socket, status } = useServer();
  const camera = useCamera();
  const [state, setState] = useState<RoomState | null>(null);
  const [slot, setSlot] = useState<PlayerSlot | null>(() => loadSession()?.slot ?? null);
  const [target, setTarget] = useState<MatchTarget | null>(null);
  const [closedReason, setClosedReason] = useState<ClosedReason | null>(null);
  const [resuming, setResuming] = useState<boolean>(() => loadSession() !== null);
  const sessionRef = useRef<SessionCredentials | null>(loadSession());

  const accept = useCallback((next: RoomState) => {
    // Drop out-of-order snapshots (can happen around reconnects).
    setState((cur) => (cur && cur.code === next.code && next.version < cur.version ? cur : next));
  }, []);

  const endSession = useCallback((reason: ClosedReason | null) => {
    sessionRef.current = null;
    saveSession(null);
    setState(null);
    setSlot(null);
    setTarget(null);
    setResuming(false);
    if (reason) setClosedReason(reason);
  }, []);

  const startSession = useCallback(
    (creds: SessionCredentials, initial: RoomState) => {
      const s = { roomCode: creds.roomCode, slot: creds.slot, sessionToken: creds.sessionToken };
      sessionRef.current = s;
      saveSession(s);
      setSlot(s.slot);
      setTarget(null);
      setClosedReason(null);
      accept(initial);
    },
    [accept],
  );

  // Server pushes.
  useEffect(() => {
    const onState = (s: RoomState) => {
      if (sessionRef.current && s.code === sessionRef.current.roomCode) accept(s);
    };
    const onTarget = (t: MatchTarget) => setTarget(t);
    const onClosed = ({ reason }: { reason: RoomClosedReason }) => endSession(reason);
    socket.on("room:state", onState);
    socket.on("match:target", onTarget);
    socket.on("room:closed", onClosed);
    return () => {
      socket.off("room:state", onState);
      socket.off("match:target", onTarget);
      socket.off("room:closed", onClosed);
    };
  }, [socket, accept, endSession]);

  // (Re)attach to the saved seat whenever the socket (re)connects.
  useEffect(() => {
    const resume = async () => {
      const creds = sessionRef.current;
      if (!creds) return;
      setResuming(true);
      const r = await request<{ state: RoomState; target: MatchTarget | null }>(socket, (ack) =>
        socket.emit("room:resume", creds, ack),
      );
      if (r.ok) {
        accept(r.data.state);
        setTarget(r.data.target);
        setResuming(false);
      } else if (r.error === "UNAUTHORIZED" || r.error === "ROOM_NOT_FOUND") {
        endSession("expired");
      } else {
        setResuming(false); // transient; will retry on next connect
      }
    };
    socket.on("connect", resume);
    if (socket.connected) void resume();
    return () => {
      socket.off("connect", resume);
    };
  }, [socket, accept, endSession]);

  // Keep the server informed of this device's camera permission (shown in the lobby).
  const cameraStatus = cameraStatusFor(camera.permission, camera.error?.kind);
  useEffect(() => {
    if (state && status === "online") socket.emit("player:camera", cameraStatus);
  }, [socket, state?.code, status, cameraStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useCallback(
    async (name: string): Promise<ActionResult> => {
      const r = await request<SessionCredentials & { state: RoomState }>(socket, (ack) => socket.emit("room:create", { name }, ack));
      if (!r.ok) return { ok: false, message: r.message };
      startSession(r.data, r.data.state);
      return { ok: true };
    },
    [socket, startSession],
  );

  const join = useCallback(
    async (code: string, name: string): Promise<ActionResult> => {
      const r = await request<SessionCredentials & { state: RoomState }>(socket, (ack) => socket.emit("room:join", { code, name }, ack));
      if (!r.ok) return { ok: false, message: r.message };
      startSession(r.data, r.data.state);
      return { ok: true };
    },
    [socket, startSession],
  );

  const leave = useCallback(() => {
    if (socket.connected) socket.emit("room:leave");
    endSession(null);
  }, [socket, endSession]);

  const simple = useCallback(
    async (send: (ack: (r: AckResult<{ state: RoomState }>) => void) => void): Promise<ActionResult> => {
      const r = await request(socket, send);
      if (!r.ok) return { ok: false, message: r.message };
      accept(r.data.state);
      return { ok: true };
    },
    [socket, accept],
  );

  const setReady = useCallback((ready: boolean) => simple((ack) => socket.emit("player:ready", ready, ack)), [simple, socket]);
  const register = useCallback((reg: ObjectRegistration) => simple((ack) => socket.emit("object:register", reg, ack)), [simple, socket]);
  const clearObject = useCallback(() => simple((ack) => socket.emit("object:clear", ack)), [simple, socket]);
  const rematch = useCallback(async () => {
    const r = await simple((ack) => socket.emit("match:rematch", ack));
    if (r.ok) setTarget(null);
    return r;
  }, [simple, socket]);
  const dismissClosed = useCallback(() => setClosedReason(null), []);

  const value = useMemo<RoomContextValue>(
    () => ({ state, slot, target, closedReason, resuming, create, join, leave, setReady, register, clearObject, rematch, dismissClosed }),
    [state, slot, target, closedReason, resuming, create, join, leave, setReady, register, clearObject, rematch, dismissClosed],
  );
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used inside <RoomProvider>");
  return ctx;
}
