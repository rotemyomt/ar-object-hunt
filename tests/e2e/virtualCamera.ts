import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * A controllable "camera" for end-to-end tests: getUserMedia returns a canvas stream
 * whose picture the test sets (a real photo, with position/scale/rotation/brightness so
 * successive captures look like different angles). Everything downstream — frame sampling,
 * the ONNX models, matching, the sweep mask and server validation — is the real game code.
 */
export interface Scene {
  image: string | null; // file name in tests/e2e/assets, or null for an empty scene
  scale?: number;
  dx?: number;
  dy?: number;
  rotate?: number; // degrees
  brightness?: number;
  mirror?: boolean;
}

export async function installVirtualCamera(page: Page) {
  await page.route("**/__e2e__/*", async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    await route.fulfill({ body: fs.readFileSync(path.join(__dirname, "assets", name)), contentType: "image/png" });
  });
  await page.addInitScript(() => {
    const W = 720;
    const H = 1280;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const images = new Map<string, HTMLImageElement>();
    let scene: Record<string, unknown> = { image: null };
    const w = window as unknown as { __setScene: (s: Record<string, unknown>) => void };
    w.__setScene = (s) => {
      scene = s;
      const name = s.image as string | null;
      if (name && !images.has(name)) {
        const img = new Image();
        img.src = `/__e2e__/${name}`;
        images.set(name, img);
      }
    };
    const draw = () => {
      ctx.fillStyle = "#3a3f47";
      ctx.fillRect(0, 0, W, H);
      const img = scene.image ? images.get(scene.image as string) : null;
      if (img && img.complete && img.naturalWidth) {
        const scale = ((scene.scale as number) ?? 1) * (W / img.naturalWidth) * 1.4;
        ctx.save();
        ctx.translate(W / 2 + ((scene.dx as number) ?? 0) * W, H / 2 + ((scene.dy as number) ?? 0) * H);
        ctx.rotate((((scene.rotate as number) ?? 0) * Math.PI) / 180);
        if (scene.mirror) ctx.scale(-1, 1);
        ctx.filter = `brightness(${(scene.brightness as number) ?? 1})`;
        ctx.drawImage(img, (-img.naturalWidth * scale) / 2, (-img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
        ctx.restore();
      }
    };
    setInterval(draw, 50);
    draw();
    const stream = canvas.captureStream(20);
    const track = stream.getVideoTracks()[0]!;
    const origSettings = track.getSettings.bind(track);
    track.getSettings = () => ({ ...origSettings(), width: W, height: H, facingMode: "environment", frameRate: 20 });
    navigator.mediaDevices.getUserMedia = async () => {
      const s = new MediaStream([track.clone()]);
      const t = s.getVideoTracks()[0]!;
      t.getSettings = track.getSettings;
      return s;
    };
  });
}

export async function setScene(page: Page, scene: Scene) {
  await page.evaluate((s) => (window as unknown as { __setScene: (x: unknown) => void }).__setScene(s), scene);
}
