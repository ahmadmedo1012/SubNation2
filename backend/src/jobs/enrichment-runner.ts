/**
 * Cron entry-point (012-arabic-catalog-enrichment, T025).
 *
 * Wired into cron.ts at 03:50 UTC (r110 comment-truth fix — the slot
 * moved to 03:50 in round-92 B7-P2-3; the header said 03:45 until now).
 * The first action is the worker-tier
 * + env-flag guard — neither the web tier nor a misconfigured worker
 * runs the cron silently.
 *
 * Operators trigger an on-demand recompute via:
 *   pnpm --filter @workspace/api-server tsx src/jobs/enrichment-runner.ts
 * which respects the same env gates.
 */

import { logger } from "../lib/logger";
import { runEnrichment } from "../services/enrichment/enrichment.service";

const DEFAULT_DAILY_TOKEN_CAP = 50_000;
const DEFAULT_PER_RUN_CAP = 50;

export async function runEnrichmentIfPermitted(): Promise<void> {
  if (process.env.WORKER_TIER !== "true") {
    logger.warn(
      { category: "enrichment.cron" },
      "[enrichment-cron] skipped — WORKER_TIER !== 'true'; cron belongs on the worker tier per constitution §V",
    );
    return;
  }
  if (process.env.ENRICHMENT_RUNNER_ENABLED !== "true") {
    logger.info(
      { category: "enrichment.cron" },
      "[enrichment-cron] skipped — ENRICHMENT_RUNNER_ENABLED is not 'true'",
    );
    return;
  }
  const dailyTokenCap = Number.parseInt(
    process.env.ENRICHMENT_DAILY_TOKEN_CAP ?? String(DEFAULT_DAILY_TOKEN_CAP),
    10,
  );
  const perRunCap = Number.parseInt(
    process.env.ENRICHMENT_PER_RUN_CAP ?? String(DEFAULT_PER_RUN_CAP),
    10,
  );
  await runEnrichment({
    dailyTokenCap: Number.isFinite(dailyTokenCap) ? dailyTokenCap : DEFAULT_DAILY_TOKEN_CAP,
    perRunCap: Number.isFinite(perRunCap) ? perRunCap : DEFAULT_PER_RUN_CAP,
  });
}
