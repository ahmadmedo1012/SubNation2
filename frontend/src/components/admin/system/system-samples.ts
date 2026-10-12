// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the client-side rolling metrics buffer's domain (the sample shape, the
// 30-min window cap, the per-second delta derivation). The buffer ITSELF
// (samplesRef + the polling effect that fills it) stays in the page — it
// coordinates the metrics + diagnostics queries; this module is the pure
// math both consume. React-free.

// ── Client-side rolling buffer ─────────────────────────────────────────────
//
// Keep the last 30 minutes of poll snapshots in memory so we can render
// sparklines + trend deltas without standing up a TSDB. 15 s polling × 120
// samples = 30 min window. Browsers' V8 holds this cheaply (~12 KB).

export interface MetricsSample {
  ts: number;
  totalRequests: number;
  errors5xx: number;
  p95Ms: number | null;
  authFailures: number;
  redisOps: number;
  redisErrors: number;
  socketClients: number;
  eventLoopP99Ms: number | null;
  memoryRssMb: number | null;
}

export const MAX_SAMPLES = 120; // 30 min @ 15 s polling

export function deriveDelta(
  samples: MetricsSample[],
  pick: (s: MetricsSample) => number,
): number[] {
  if (samples.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].ts - samples[i - 1].ts) / 1000;
    if (dt <= 0) {
      out.push(0);
      continue;
    }
    const dv = pick(samples[i]) - pick(samples[i - 1]);
    out.push(Math.max(0, dv / dt)); // counters never decrease in normal flow
  }
  return out;
}
