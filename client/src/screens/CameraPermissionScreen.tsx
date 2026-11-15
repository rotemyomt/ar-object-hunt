import { useEffect } from "react";
import { Icon, NeonButton, ScreenShell, StatusPill } from "../components/ui";
import { useCamera } from "../camera/CameraProvider";
import { sound } from "../audio/sound";
import { haptic } from "../audio/haptics";

/**
 * Explains why the camera is needed, then requests it from a tap (iOS requires the
 * getUserMedia call to originate from a user gesture for a reliable prompt).
 */
export function CameraPermissionScreen({ onBack, onGranted }: { onBack: () => void; onGranted: () => void }) {
  const { status, error, permission, start } = useCamera();

  useEffect(() => {
    if (status === "live") onGranted();
  }, [status, onGranted]);

  const request = async () => {
    const ok = await start("environment");
    if (!ok) {
      sound.play("error");
      haptic("error");
    }
  };

  const tone = permission === "granted" ? "ok" : permission === "denied" ? "bad" : "idle";
  const label =
    permission === "granted" ? "Allowed" : permission === "denied" ? "Blocked" : permission === "prompt" ? "Not asked yet" : "Unknown";

  return (
    <ScreenShell
      title="Camera Access"
      onBack={onBack}
      footer={
        <NeonButton block icon={<Icon.Camera />} onClick={request} disabled={status === "starting"} data-testid="enable-camera">
          {status === "starting" ? "Opening camera…" : error?.retryable ? "Try Again" : "Enable Camera"}
        </NeonButton>
      }
    >
      <div className="perm-hero">
        <div className="perm-icon">
          <Icon.Camera />
        </div>
        <h2>Your camera is your weapon</h2>
        <p>The game uses your rear camera to recognise objects in real time.</p>
      </div>

      <ul className="feature-list card">
        <li><Icon.Shield /> Video is analysed on your phone and never uploaded or recorded.</li>
        <li><Icon.Target /> The camera is only on during object scanning and matches.</li>
        <li><Icon.Bolt /> It turns off automatically when you leave the app.</li>
      </ul>

      <div className="center-row">
        <StatusPill tone={tone} testId="camera-permission-status">Camera: {label}</StatusPill>
      </div>

      {error && (
        <section className="card error-card" role="alert" data-testid="camera-error">
          <h3>{error.title}</h3>
          <p>{error.message}</p>
          {error.steps.length > 0 && (
            <ol className="steps">
              {error.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </section>
      )}
    </ScreenShell>
  );
}
