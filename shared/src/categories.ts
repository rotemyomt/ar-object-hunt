/**
 * Object categories. The detector (D-FINE, COCO-80) recognises these classes; the game
 * supports the hand-held subset that can be hidden on a person and shown to a camera.
 * Label strings match the model's id2label exactly.
 */
export const COCO_LABELS = [
  "person", "bicycle", "car", "motorbike", "aeroplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
  "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "sofa", "pottedplant", "bed",
  "diningtable", "toilet", "tvmonitor", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven",
  "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
] as const;

export type CocoLabel = (typeof COCO_LABELS)[number];

/**
 * Supported objects, grouped by what the detector tends to confuse. A detection counts
 * as a candidate for a target if it's in the same group (e.g. a mug the detector calls
 * "vase" in one frame and "cup" in the next is still the same mug).
 */
export const CATEGORY_GROUPS: Record<string, readonly CocoLabel[]> = {
  drinkware: ["bottle", "cup", "wine glass", "vase", "bowl"],
  devices: ["cell phone", "remote", "mouse"],
  round: ["sports ball", "apple", "orange", "frisbee"],
  book: ["book"],
  toy: ["teddy bear"],
  banana: ["banana"],
  clock: ["clock"],
  tools: ["scissors", "toothbrush", "spoon", "hair drier"],
};

export const SUPPORTED_LABELS: ReadonlySet<string> = new Set(Object.values(CATEGORY_GROUPS).flat());

/** Friendly names shown to players. */
export const DISPLAY_NAME: Partial<Record<CocoLabel, string>> = {
  "cell phone": "phone",
  "sports ball": "ball",
  "teddy bear": "soft toy",
  "wine glass": "glass",
  "hair drier": "hair dryer",
};

export function displayName(label: string): string {
  return DISPLAY_NAME[label as CocoLabel] ?? label;
}

export function groupOf(label: string): string | null {
  for (const [g, labels] of Object.entries(CATEGORY_GROUPS)) if ((labels as readonly string[]).includes(label)) return g;
  return null;
}

export function sameGroup(a: string, b: string): boolean {
  const g = groupOf(a);
  return g !== null && g === groupOf(b);
}

/** Short list for help text. */
export const SUPPORTED_EXAMPLES = ["bottle", "cup / mug", "book", "phone", "remote", "soft toy", "ball", "fruit", "scissors"];
