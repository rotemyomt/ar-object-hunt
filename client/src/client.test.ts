import { describe, expect, it } from "vitest";
import { analysisSize, coverTransform } from "./camera/geometry";
import { describeCameraError, detectPlatform } from "./camera/cameraErrors";
import { navReducer, roomCodeFromLocation, currentScreen } from "./game/navigation";
import { measureFrameQuality } from "./vision/frameQuality";

describe("cover transform", () => {
  it("crops the sides of a landscape frame shown on a portrait screen", () => {
    const t = coverTransform(1280, 720, 390, 844);
    expect(t.sh).toBeCloseTo(720);
    expect(t.sw).toBeCloseTo((390 / 844) * 720, 5);
    expect(t.sx).toBeCloseTo((1280 - t.sw) / 2, 5);
    expect(t.sy).toBeCloseTo(0);
    expect(t.scale).toBeCloseTo(844 / 720, 5);
  });

  it("is the identity when aspect ratios match", () => {
    const t = coverTransform(720, 1280, 360, 640);
    expect([t.sx, t.sy, t.sw, t.sh]).toEqual([0, 0, 720, 1280]);
    expect(t.scale).toBe(0.5);
  });

  it("downscales analysis frames preserving aspect ratio and never upscales", () => {
    expect(analysisSize(332, 720, 320)).toEqual({ width: 148, height: 320 });
    expect(analysisSize(200, 100, 320)).toEqual({ width: 200, height: 100 });
  });
});

describe("camera errors", () => {
  it("detects platforms from user agents", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios"); // iPadOS
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("desktop");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130", 5)).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; SM-S918B) SamsungBrowser/26.0", 5)).toBe("samsung");
  });

  it("maps getUserMedia errors to actionable messages", () => {
    const denied = describeCameraError({ name: "NotAllowedError" }, "ios");
    expect(denied.kind).toBe("denied");
    expect(denied.retryable).toBe(true);
    expect(denied.steps.join(" ")).toMatch(/Safari/);
    expect(describeCameraError({ name: "NotReadableError" }).kind).toBe("in_use");
    expect(describeCameraError({ name: "NotFoundError" }).kind).toBe("no_camera");
    expect(describeCameraError("insecure").retryable).toBe(false);
    expect(describeCameraError(new Error("weird")).kind).toBe("unknown");
  });
});

describe("navigation", () => {
  it("pushes, pops and resets to menu", () => {
    let s = navReducer({ stack: [{ name: "splash" }] }, { type: "go", to: { name: "menu" } });
    expect(s.stack).toHaveLength(1);
    s = navReducer(s, { type: "go", to: { name: "join" } });
    expect(currentScreen(s).name).toBe("join");
    s = navReducer(s, { type: "back" });
    expect(currentScreen(s).name).toBe("menu");
    expect(navReducer(s, { type: "back" })).toBe(s); // can't pop the root
  });

  it("reads invitation codes from links", () => {
    expect(roomCodeFromLocation({ pathname: "/join/abcde", search: "" })).toBe("ABCDE");
    expect(roomCodeFromLocation({ pathname: "/", search: "?room=XY2Z9" })).toBe("XY2Z9");
    expect(roomCodeFromLocation({ pathname: "/join/AB0DE", search: "" })).toBeNull();
    expect(roomCodeFromLocation({ pathname: "/", search: "" })).toBeNull();
    expect(roomCodeFromLocation({ pathname: "/ar-object-hunt/join/abcde", search: "" }, "/ar-object-hunt/")).toBe("ABCDE");
  });
});

describe("frame quality", () => {
  function frame(w: number, h: number, px: (x: number, y: number) => number) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = px(x, y);
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    return d;
  }

  it("flags dark, bright, flat and detailed frames", () => {
    expect(measureFrameQuality(frame(64, 64, () => 10), 64, 64).verdict).toBe("too_dark");
    expect(measureFrameQuality(frame(64, 64, () => 250), 64, 64).verdict).toBe("too_bright");
    expect(measureFrameQuality(frame(64, 64, () => 128), 64, 64).verdict).toBe("blurry");
    const checker = measureFrameQuality(frame(64, 64, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? 200 : 60)), 64, 64);
    expect(checker.verdict).toBe("ok");
    expect(checker.sharpness).toBeGreaterThan(10);
  });
});
