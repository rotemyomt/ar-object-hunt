/// <reference lib="webworker" />
/**
 * Vision worker: runs the detector (D-FINE nano, COCO-80) and the embedder (MobileNetV2
 * pooled features) with ONNX Runtime Web, off the main thread so the UI stays smooth.
 * Frames arrive as ImageBitmaps of exactly the on-screen camera region.
 */
import * as ort from "onnxruntime-web/wasm";
import { COCO_LABELS, SUPPORTED_LABELS, l2normalize } from "@aoh/shared";
import { colorSignature, iou, squareCrop, toNCHW } from "./imageOps";
import type { Detection, DetectRequest, WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const DETECT_SIZE = 480; // D-FINE accepts dynamic sizes; 480 ≈ 2× faster than 640 with little loss for near objects
const EMBED_SIZE = 224;
const MODELS = { detector: "models/dfine-nano-coco.fp32.onnx", embedder: "models/mobilenet-v2-embed.fp16.onnx" };

let detector: ort.InferenceSession | null = null;
let embedder: ort.InferenceSession | null = null;
let detCanvas = new OffscreenCanvas(DETECT_SIZE, DETECT_SIZE);
let detCtx = detCanvas.getContext("2d", { willReadFrequently: true })!;
const embCanvas = new OffscreenCanvas(EMBED_SIZE, EMBED_SIZE);
const embCtx = embCanvas.getContext("2d", { willReadFrequently: true })!;

const post = (m: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);

async function fetchWithProgress(urls: string[]): Promise<ArrayBuffer[]> {
  // Sizes for the progress bar; best effort (offline / cached responses may not answer HEAD).
  const sizes = await Promise.all(
    urls.map(async (u) => {
      try {
        return Number((await fetch(u, { method: "HEAD" })).headers.get("content-length") ?? 0);
      } catch {
        return 0;
      }
    }),
  );
  const total = sizes.reduce((a, b) => a + b, 0);
  let loaded = 0;
  const out: ArrayBuffer[] = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Failed to download ${url.split("/").pop()} (${res.status})`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      post({ type: "progress", loaded, total: Math.max(total, loaded) });
    }
    const buf = new Uint8Array(chunks.reduce((a, c) => a + c.byteLength, 0));
    let o = 0;
    for (const c of chunks) {
      buf.set(c, o);
      o += c.byteLength;
    }
    out.push(buf.buffer);
  }
  return out;
}

async function init(baseUrl: string) {
  // Multi-threading needs cross-origin isolation (not available on GitHub Pages); SIMD works everywhere modern.
  const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.wasmPaths = { mjs: `${baseUrl}ort/ort-wasm-simd-threaded.mjs`, wasm: `${baseUrl}ort/ort-wasm-simd-threaded.wasm` };
  const [detBuf, embBuf] = await fetchWithProgress([baseUrl + MODELS.detector, baseUrl + MODELS.embedder]);
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  detector = await ort.InferenceSession.create(new Uint8Array(detBuf!), opts);
  embedder = await ort.InferenceSession.create(new Uint8Array(embBuf!), opts);
  // Warm-up: the first run compiles kernels; do it now rather than mid-game.
  const t0 = performance.now();
  await detector.run({ pixel_values: new ort.Tensor("float32", new Float32Array(3 * DETECT_SIZE * DETECT_SIZE), [1, 3, DETECT_SIZE, DETECT_SIZE]) });
  await embedder.run({ pixel_values: new ort.Tensor("float32", new Float32Array(3 * EMBED_SIZE * EMBED_SIZE), [1, 3, EMBED_SIZE, EMBED_SIZE]) });
  post({ type: "ready", backend: "wasm-simd", threads, warmupMs: Math.round(performance.now() - t0) });
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

async function detect(req: DetectRequest) {
  if (!detector || !embedder) throw new Error("Vision models not loaded");
  const { frame } = req;
  const t0 = performance.now();

  // Detector input: frame stretched to size² (matches the model's RT-DETR preprocessing), /255, no mean/std.
  const size = Math.max(256, Math.min(640, Math.round((req.size ?? DETECT_SIZE) / 32) * 32));
  if (detCanvas.width !== size) {
    detCanvas = new OffscreenCanvas(size, size);
    detCtx = detCanvas.getContext("2d", { willReadFrequently: true })!;
  }
  detCtx.drawImage(frame, 0, 0, size, size);
  const px = detCtx.getImageData(0, 0, size, size).data;
  const out = await detector.run({
    pixel_values: new ort.Tensor("float32", toNCHW(px, size, size, 0, 1), [1, 3, size, size]),
  });
  const logits = out.logits!.data as Float32Array; // [1, Q, 80]
  const boxes = out.pred_boxes!.data as Float32Array; // [1, Q, 4] cx, cy, w, h (normalised)
  const nClasses = COCO_LABELS.length;
  const queries = logits.length / nClasses;

  let dets: Detection[] = [];
  for (let q = 0; q < queries; q++) {
    let best = -Infinity;
    let cls = 0;
    for (let c = 0; c < nClasses; c++) {
      const v = logits[q * nClasses + c]!;
      if (v > best) {
        best = v;
        cls = c;
      }
    }
    const score = sigmoid(best);
    if (score < req.minScore) continue;
    const label = COCO_LABELS[cls]!;
    if (label === "person" || label === "diningtable") continue; // never targets; skip work
    const [cx, cy, w, h] = [boxes[q * 4]!, boxes[q * 4 + 1]!, boxes[q * 4 + 2]!, boxes[q * 4 + 3]!];
    const box = { x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), w: Math.min(1, w), h: Math.min(1, h) };
    if (box.w < 0.02 || box.h < 0.02) continue;
    dets.push({ label, score, box });
  }
  // DETR-style models are NMS-free, but drop near-duplicates of the same class anyway.
  dets.sort((a, b) => b.score - a.score);
  dets = dets.filter((d, i) => !dets.slice(0, i).some((o) => o.label === d.label && iou(o.box, d.box) > 0.7));
  const detectMs = performance.now() - t0;

  // Embeddings for candidate categories (largest + most confident first).
  const t1 = performance.now();
  const wanted = (d: Detection) =>
    req.embedLabels === "supported" ? SUPPORTED_LABELS.has(d.label) : req.embedLabels === "none" ? false : req.embedLabels.includes(d.label);
  const toEmbed = dets
    .filter(wanted)
    .sort((a, b) => b.score * Math.sqrt(b.box.w * b.box.h) - a.score * Math.sqrt(a.box.w * a.box.h))
    .slice(0, req.maxEmbeds);
  const transfers: Transferable[] = [];
  for (const d of toEmbed) {
    const c = squareCrop(d.box, frame.width, frame.height);
    embCtx.fillStyle = "#000";
    embCtx.fillRect(0, 0, EMBED_SIZE, EMBED_SIZE);
    embCtx.drawImage(frame, c.sx, c.sy, c.size, c.size, 0, 0, EMBED_SIZE, EMBED_SIZE);
    const crop = embCtx.getImageData(0, 0, EMBED_SIZE, EMBED_SIZE).data;
    const r = await embedder.run({
      pixel_values: new ort.Tensor("float32", toNCHW(crop, EMBED_SIZE, EMBED_SIZE, 0.5, 0.5), [1, 3, EMBED_SIZE, EMBED_SIZE]),
    });
    d.embedding = l2normalize(r.embedding!.data as Float32Array);
    d.color = colorSignature(crop, EMBED_SIZE, EMBED_SIZE);
    transfers.push(d.embedding.buffer, d.color.buffer);
    if (req.wantThumbs) {
      d.thumb = await createImageBitmap(embCanvas, { resizeWidth: 112, resizeHeight: 112 });
      transfers.push(d.thumb);
    }
  }
  const embedMs = performance.now() - t1;
  frame.close();
  post({ type: "result", id: req.id, detections: dets, detectMs, embedMs }, transfers);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "init") {
    init(msg.baseUrl).catch((err: unknown) => post({ type: "error", message: err instanceof Error ? err.message : String(err) }));
  } else if (msg.type === "detect") {
    detect(msg).catch((err: unknown) => {
      msg.frame.close?.();
      post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    });
  }
};
