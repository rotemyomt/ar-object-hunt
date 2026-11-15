import type { Detection, DetectRequest, WorkerResponse } from "./protocol";

export type VisionStatus =
  | { state: "idle" }
  | { state: "loading"; progress: number }
  | { state: "ready"; backend: string; threads: number }
  | { state: "error"; message: string };

export interface DetectResult {
  detections: Detection[];
  detectMs: number;
  embedMs: number;
}

type Listener = (s: VisionStatus) => void;

/**
 * Main-thread handle to the vision worker. One shared instance: models are ~20 MB, so
 * they're loaded once (and cached by the service worker for later visits).
 */
class VisionEngine {
  private worker: Worker | null = null;
  private status: VisionStatus = { state: "idle" };
  private listeners = new Set<Listener>();
  private pending = new Map<number, { resolve: (r: DetectResult) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;

  get current(): VisionStatus {
    return this.status;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(s: VisionStatus) {
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  /** Start loading (idempotent). Resolves when models are ready. */
  load(): Promise<void> {
    if (this.readyPromise && this.status.state !== "error") return this.readyPromise;
    this.worker?.terminate();
    this.set({ state: "loading", progress: 0 });
    this.worker = new Worker(new URL("./vision.worker.ts", import.meta.url), { type: "module" });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const w = this.worker!;
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        switch (m.type) {
          case "progress":
            this.set({ state: "loading", progress: m.total > 0 ? m.loaded / m.total : 0 });
            break;
          case "ready":
            this.set({ state: "ready", backend: m.backend, threads: m.threads });
            resolve();
            break;
          case "result": {
            const p = this.pending.get(m.id);
            this.pending.delete(m.id);
            p?.resolve({ detections: m.detections, detectMs: m.detectMs, embedMs: m.embedMs });
            break;
          }
          case "error":
            if (m.id !== undefined) {
              const p = this.pending.get(m.id);
              this.pending.delete(m.id);
              p?.reject(new Error(m.message));
            } else {
              this.set({ state: "error", message: m.message });
              reject(new Error(m.message));
            }
            break;
        }
      };
      w.onerror = (e) => {
        const message = e.message || "The recognition engine failed to start.";
        this.set({ state: "error", message });
        reject(new Error(message));
      };
      w.postMessage({ type: "init", baseUrl: new URL(import.meta.env.BASE_URL, location.href).href });
    });
    return this.readyPromise;
  }

  /** Run detection (+ embeddings) on a frame. The frame source is copied, so callers may reuse it. */
  async detect(
    source: CanvasImageSource & { width: number; height: number },
    opts: Omit<DetectRequest, "type" | "id" | "frame">,
  ): Promise<DetectResult> {
    await this.load();
    const frame = await toBitmap(source);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req: DetectRequest = { type: "detect", id, frame, ...opts };
      this.worker!.postMessage(req, [frame]);
    });
  }
}

let fallbackCanvas: HTMLCanvasElement | null = null;

/** createImageBitmap from any canvas; falls back via a DOM canvas on browsers that can't bitmap an OffscreenCanvas. */
async function toBitmap(source: CanvasImageSource & { width: number; height: number }): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(source as ImageBitmapSource);
  } catch {
    fallbackCanvas ??= document.createElement("canvas");
    fallbackCanvas.width = source.width;
    fallbackCanvas.height = source.height;
    fallbackCanvas.getContext("2d")!.drawImage(source, 0, 0);
    return createImageBitmap(fallbackCanvas);
  }
}

export const vision = new VisionEngine();
