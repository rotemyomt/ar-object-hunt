/** Messages between the main thread and the vision worker. */

export interface Detection {
  label: string;
  score: number;
  /** Normalised [0..1] box in analysis-frame (= on-screen) coordinates, top-left origin. */
  box: { x: number; y: number; w: number; h: number };
  /** Present when embeddings were requested for this detection's category. */
  embedding?: Float32Array;
  color?: Float32Array;
  /** Small JPEG-able crop (registration thumbnails). */
  thumb?: ImageBitmap;
}

export interface DetectRequest {
  type: "detect";
  id: number;
  frame: ImageBitmap;
  /** Compute embeddings only for detections whose label passes this filter. */
  embedLabels: string[] | "supported" | "none";
  /** Max detections to embed (largest/most central first). */
  maxEmbeds: number;
  minScore: number;
  wantThumbs?: boolean;
  /** Detector input size (square). Smaller = faster on slow phones. Default 480. */
  size?: number;
}

export type WorkerRequest =
  | { type: "init"; baseUrl: string }
  | DetectRequest;

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; backend: string; threads: number; warmupMs: number }
  | { type: "error"; id?: number; message: string }
  | { type: "result"; id: number; detections: Detection[]; detectMs: number; embedMs: number };
