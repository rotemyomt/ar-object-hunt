import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useCamera } from "./CameraProvider";

/**
 * Full-bleed live camera feed. `playsInline` + `muted` are required for inline autoplay
 * on iOS Safari; the front camera is mirrored so it feels natural.
 */
export const CameraView = forwardRef<HTMLVideoElement | null>(function CameraView(_props, ref) {
  const { stream, info } = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle<HTMLVideoElement | null, HTMLVideoElement | null>(ref, () => videoRef.current, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => {/* resumed by next user gesture */});
  }, [stream]);

  return (
    <video
      ref={videoRef}
      className={`camera-view${info?.facing === "user" ? " mirrored" : ""}`}
      autoPlay
      playsInline
      muted
      disablePictureInPicture
      aria-label="Live camera view"
      data-testid="camera-video"
    />
  );
});
