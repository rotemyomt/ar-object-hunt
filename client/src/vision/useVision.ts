import { useEffect, useState } from "react";
import { vision, type VisionStatus } from "./VisionEngine";

/** Subscribe to the vision engine status; optionally start loading it. */
export function useVision(autoload = false): VisionStatus {
  const [status, setStatus] = useState<VisionStatus>(vision.current);
  useEffect(() => vision.subscribe(setStatus), []);
  useEffect(() => {
    if (autoload) vision.load().catch(() => {/* surfaced via status */});
  }, [autoload]);
  return status;
}
