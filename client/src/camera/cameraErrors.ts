export type CameraErrorKind = "insecure" | "unsupported" | "denied" | "no_camera" | "in_use" | "unknown";

export interface CameraError {
  kind: CameraErrorKind;
  title: string;
  message: string;
  /** Platform-specific steps to recover, shown as a list. */
  steps: string[];
  retryable: boolean;
}

export type Platform = "ios" | "android" | "samsung" | "desktop";

export function detectPlatform(ua: string = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints): Platform {
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Android/i.test(ua)) return "android";
  // iPadOS reports itself as Macintosh; touch points give it away.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return "ios";
  return "desktop";
}

function deniedSteps(platform: Platform): string[] {
  switch (platform) {
    case "ios":
      return [
        "Tap the “aA” (or page settings) icon in Safari’s address bar.",
        "Choose Website Settings → Camera → Allow.",
        "If it’s still blocked: iPhone Settings → Apps → Safari → Camera → Ask or Allow.",
        "Return here and tap Try Again.",
      ];
    case "samsung":
      return [
        "Tap the lock icon next to the address.",
        "Open Permissions and allow Camera.",
        "Return here and tap Try Again.",
      ];
    case "android":
      return [
        "Tap the tune/lock icon next to the address in Chrome.",
        "Open Permissions → Camera → Allow.",
        "If Chrome itself is blocked: Android Settings → Apps → Chrome → Permissions → Camera.",
        "Return here and tap Try Again.",
      ];
    default:
      return ["Click the camera icon in the address bar and allow access.", "Then tap Try Again."];
  }
}

/** Translate a getUserMedia failure (or environment problem) into something a player can act on. */
export function describeCameraError(err: unknown, platform: Platform = detectPlatform()): CameraError {
  const name = (err as { name?: string } | null)?.name ?? (typeof err === "string" ? err : "");

  switch (name) {
    case "insecure":
      return {
        kind: "insecure",
        title: "Secure connection required",
        message: "Phones only allow camera access on HTTPS pages. Open the game from its https:// address.",
        steps: ["Use the https:// link your host shared.", "On a local network, open https://<computer-IP>:5173 and accept the certificate."],
        retryable: false,
      };
    case "unsupported":
      return {
        kind: "unsupported",
        title: "Camera not supported here",
        message: "This browser can’t open the camera. Use Safari on iPhone, or Chrome / Samsung Internet on Android.",
        steps: ["If you opened this inside another app (Instagram, WhatsApp…), open it in your browser instead."],
        retryable: false,
      };
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return {
        kind: "denied",
        title: "Camera access blocked",
        message: "AR Object Hunt needs your camera to find your opponent’s object. Video never leaves your phone.",
        steps: deniedSteps(platform),
        retryable: true,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return {
        kind: "no_camera",
        title: "No usable camera found",
        message: "We couldn’t find a camera on this device.",
        steps: ["Make sure no privacy shutter or setting is disabling the camera.", "Try a different phone."],
        retryable: true,
      };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        kind: "in_use",
        title: "Camera is busy",
        message: "Another app or tab is using the camera.",
        steps: ["Close other apps or tabs using the camera (video calls, camera app).", "Then tap Try Again."],
        retryable: true,
      };
    default:
      return {
        kind: "unknown",
        title: "Camera failed to start",
        message: "Something went wrong opening the camera.",
        steps: ["Reload the page and try again.", "Restart the browser if it keeps happening."],
        retryable: true,
      };
  }
}
