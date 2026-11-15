/**
 * Server clock estimation (Cristian's algorithm with best-of-N selection).
 *
 * For each round trip we know: t0 = client send, ts = server time, t1 = client receive.
 * Assuming symmetric latency, offset ≈ ts - (t0 + t1) / 2. The sample with the smallest
 * round-trip time has the tightest error bound (± rtt/2), so we take the median offset
 * of the lowest-RTT half of samples for robustness against outliers.
 */
export interface SyncSample {
  clientSentAt: number;
  serverTime: number;
  clientReceivedAt: number;
}

export interface ClockEstimate {
  /** Add to a local Date.now() to get server time. */
  offsetMs: number;
  /** Best observed round-trip time. Error bound of the offset is roughly ± bestRttMs / 2. */
  bestRttMs: number;
  samples: number;
}

export function estimateClockOffset(samples: SyncSample[]): ClockEstimate {
  if (samples.length === 0) throw new Error("estimateClockOffset: no samples");
  const enriched = samples
    .map((s) => {
      const rtt = s.clientReceivedAt - s.clientSentAt;
      const offset = s.serverTime - (s.clientSentAt + s.clientReceivedAt) / 2;
      return { rtt, offset };
    })
    .filter((s) => s.rtt >= 0)
    .sort((a, b) => a.rtt - b.rtt);
  if (enriched.length === 0) throw new Error("estimateClockOffset: all samples had negative RTT");

  const best = enriched.slice(0, Math.max(1, Math.ceil(enriched.length / 2)));
  const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const median = offsets.length % 2 ? offsets[mid]! : (offsets[mid - 1]! + offsets[mid]!) / 2;

  return { offsetMs: Math.round(median), bestRttMs: enriched[0]!.rtt, samples: enriched.length };
}
