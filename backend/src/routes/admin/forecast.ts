/**
 * Admin forecast routes (011-inventory-demand-forecast, T027 + T044).
 *
 *   GET /api/admin/forecast/at-risk        — top-N at-risk products (panel)
 *   GET /api/admin/forecast/products/:id   — per-product detail (drawer)
 *
 * Both gated by `requireAdmin` + `requirePermission("inventory")` at the
 * parent mount in `routes/admin/index.ts`. The endpoints are read-only —
 * the cron is the only writer.
 */

import { Router, type Request, type Response } from "express";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { isAlertingPaused } from "../../lib/forecast/redis-flags";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { latestAtRisk, latestForProduct } from "../../services/forecast/forecast-store";
import {
  latestSuccessful,
  type SuccessfulRunSummary,
} from "../../services/forecast/run-store";

const router = Router();

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type PipelineState = "fresh" | "stale" | "uninitialized" | "calibrating";

async function derivePipelineState(
  latest: SuccessfulRunSummary | null,
): Promise<{ state: PipelineState; freshnessHours: number | null }> {
  if (await isAlertingPaused()) {
    const hours = latest ? Math.floor((Date.now() - latest.completedAt.getTime()) / 3_600_000) : null;
    return { state: "calibrating", freshnessHours: hours };
  }
  if (!latest) return { state: "uninitialized", freshnessHours: null };
  const ageMs = Date.now() - latest.completedAt.getTime();
  const hours = Math.floor(ageMs / 3_600_000);
  return { state: ageMs > STALE_THRESHOLD_MS ? "stale" : "fresh", freshnessHours: hours };
}

function buildPanelUrl(productId: number): string {
  const base = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");
  return `${base}/admin/products?highlight=${productId}`;
}

router.get(
  "/forecast/at-risk",
  requireAdmin,
  async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 50);

    const latest = await latestSuccessful();
    const { state, freshnessHours } = await derivePipelineState(latest);

    if (!latest) {
      res.json({
        pipeline_state: state,
        last_successful_run_at: null,
        data_freshness_hours: null,
        rows: [],
      });
      return;
    }

    const rows = await latestAtRisk(limit);
    res.json({
      pipeline_state: state,
      last_successful_run_at: latest.completedAt.toISOString(),
      data_freshness_hours: freshnessHours,
      rows: rows.map((r) => ({
        product_id: r.productId,
        product_name: r.productName,
        product_image_url: r.productImageUrl,
        product_slug: r.productSlug,
        category: r.category,
        current_stock_on_hand: r.currentStockOnHand,
        avg_daily_sales: r.avgDailySales,
        predicted_demand_7d: r.predictedDemand7d,
        predicted_demand_30d: r.predictedDemand30d,
        predicted_runout_at: r.predictedRunoutAt,
        recommended_reorder_qty: r.recommendedReorderQty,
        confidence: r.confidence,
        forecast_date: r.forecastDate,
        panel_url: buildPanelUrl(r.productId),
      })),
    });
  },
);

router.get(
  "/forecast/products/:id",
  requireAdmin,
  async (req: Request, res: Response) => {
    const id = Number.parseInt(String(req.params.id ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json(createErrorResponse("معرّف المنتج غير صالح", ErrorCode.INVALID_DATA));
      return;
    }

    const latest = await latestSuccessful();
    const { state } = await derivePipelineState(latest);
    const row = await latestForProduct(id);

    if (!row) {
      res.json({ pipeline_state: state, forecast: null });
      return;
    }

    res.json({
      pipeline_state: state,
      forecast: {
        product_id: row.productId,
        product_name: row.productName,
        product_image_url: row.productImageUrl,
        product_slug: row.productSlug,
        category: row.category,
        current_stock_on_hand: row.currentStockOnHand,
        avg_daily_sales: row.avgDailySales,
        predicted_demand_7d: row.predictedDemand7d,
        predicted_demand_30d: row.predictedDemand30d,
        predicted_runout_at: row.predictedRunoutAt,
        recommended_reorder_qty: row.recommendedReorderQty,
        confidence: row.confidence,
        forecast_date: row.forecastDate,
        panel_url: buildPanelUrl(row.productId),
        explanation: {
          avg_daily_sales: row.avgDailySales,
          dow_blend_7d: row.dowBlend7d,
          days_of_history_available: row.daysOfHistoryAvailable,
          run_completed_at: latest?.completedAt.toISOString() ?? null,
        },
      },
    });
  },
);

export const adminForecastRouter = router;
