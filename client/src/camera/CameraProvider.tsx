import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describeCameraError, type CameraError } from "./cameraErrors";

export type CameraStatus = "idle" | "starting" | "live" | "paused" | "error";
export type Facing = "environment" | "user";
export type PermissionHint = "granted" | "denied" | "prompt" | "unknown";

export interface CameraInfo {
  width: number;
  height: number;
  frameRate: number | null;
  facing: Facing;
  label: string;
}

interface CameraContextValue {
  status: CameraStatus;
  stream: MediaStream | null;
  error: CameraError | null;
  info: CameraInfo | null;
  permission: PermissionHint;
  /** Must be called from a user gesture the first time (iOS requirement). */
  start: (facing?: Facing) => Promise<boolean>;
  /** Start the camera only if it isn't already live. Use from screens that need it. */
  ensure: () => Promise<boolean>;
  stop: () => void;
  flip: () => Promise<boolean>;
}

const CameraContext = createContext<CameraContextValue | null>(null);

/**
 * Constraints tuned for on-device vision on phones: rear camera, ~720p (enough detail
 * for matching, cheap to downscale), capped at 30 fps to save battery. `ideal` rather
 * than `exact` so every device gets its closest supported mode instead of failing.
 */
function constraintsFor(facing: Facing, relaxed: boolean): MediaStreamConstraints {
  if (relaxed) return { audio: false, video: { facingMode: facing } };
  return {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

function readInfo(stream: MediaStream, facing: Facing): CameraInfo | null {
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  const s = track.getSettings();
  const reportedFacing = s.facingMode === "user" || s.facingMode === "environment" ? s.facingMode : facing;
  return {
    width: s.width ?? 0,
    height: s.height ?? 0,
    frameRate: s.frameRate ?? null,
    facing: reportedFacing,
    label: track.label,
  };
}

export function CameraProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<CameraError | null>(null);
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [permission, setPermission] = useState<PermissionHint>("unknown");

  const streamRef = useRef<MediaStream | null>(null);
  const facingRef = useRef<Facing>("environment");
  /** True while some screen wants the camera on; lets us resume after backgrounding. */
  const wantedRef = useRef(false);
  const startSeq = useRef(0);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(
    async (facing: Facing = facingRef.current): Promise<boolean> => {
      wantedRef.current = true;
      facingRef.current = facing;
      const seq = ++startSeq.current;

      if (!window.isSecureContext) {
        setError(describeCameraError("insecure"));
        setStatus("error");
        return false;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(describeCameraError("unsupported"));
        setStatus("error");
        return false;
      }

      release();
      setStatus("starting");
      setError(null);
      try {
        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia(constraintsFor(facing, false));
        } catch (e) {
          // Some older Android devices reject resolution hints; retry with the bare minimum.
          if ((e as { name?: string }).name !== "OverconstrainedError") throw e;
          s = await navigator.mediaDevices.getUserMedia(constraintsFor(facing, true));
        }
        if (seq !== startSeq.current || !wantedRef.current) {
          s.getTracks().forEach((t) => t.stop()); // superseded by a newer start/stop
          return false;
        }
        streamRef.current = s;
        s.getVideoTracks()[0]?.addEventListener("ended", () => {
          // iOS ends tracks when the page is backgrounded or another app grabs the camera.
          if (streamRef.current === s && wantedRef.current && document.visibilityState === "visible") void start();
        });
        setStream(s);
        setInfo(readInfo(s, facing));
        setPermission("granted");
        setStatus("live");
        return true;
      } catch (e) {
        if (seq !== startSeq.current) return false;
        const described = describeCameraError(e);
        if (described.kind === "denied") setPermission("denied");
        setError(described);
        setStatus("error");
        return false;
      }
    },
    [release],
  );

  const ensure = useCallback(async (): Promise<boolean> => {
    const live = streamRef.current?.getVideoTracks().some((t) => t.readyState === "live");
    if (live) {
      wantedRef.current = true;
      return true;
    }
    return start();
  }, [start]);

  const stop = useCallback(() => {
    wantedRef.current = false;
    startSeq.current++;
    release();
    setStatus("idle");
  }, [release]);

  const flip = useCallback(
    () => start(facingRef.current === "environment" ? "user" : "environment"),
    [start],
  );

  // Battery & privacy: release the camera whenever the page is hidden, resume on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (streamRef.current) {
          release();
          setStatus("paused");
        }
      } else if (wantedRef.current && !streamRef.current) {
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [release, start]);

  // Best-effort permission pre-check (Chrome, Samsung Internet, Safari 16+).
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => status && setPermission(status.state as PermissionHint);
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => setPermission("unknown"));
    return () => status?.removeEventListener("change", update);
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const value = useMemo(
    () => ({ status, stream, error, info, permission, start, ensure, stop, flip }),
    [status, stream, error, info, permission, start, ensure, stop, flip],
  );
  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useCamera(): CameraContextValue {
  const ctx = useContext(CameraContext);
  if (!ctx) throw new Error("useCamera must be used inside <CameraProvider>");
  return ctx;
}
