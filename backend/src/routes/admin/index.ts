import { Router } from "express";
import { requirePermission } from "../../lib/permissions";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { adminAdminsRouter } from "./admins";
import { adminAlertsRouter } from "./alerts";
import { adminAuthRouter } from "./auth";
import { copilotRouter } from "./copilot";
import { adminDiagnosticsRouter } from "./diagnostics";
import { adminFlashSalesRouter } from "./flash-sales";
import { adminObservabilityRouter } from "./observability";
import { adminOrdersRouter } from "./orders";
import { adminPricingCalculatorRouter } from "./pricing-calculator";
import { adminProductsRouter } from "./products";
import { adminReferralsRouter } from "./referrals";
import { adminRiskRouter } from "./risk";
import { adminForecastRouter } from "./forecast";
import { adminEnrichmentRouter } from "./enrichment";
import { adminSecurityRouter } from "./security";
import { adminSettingsRouter } from "./settings";
import { adminStatsRouter } from "./stats";
import { adminTicketsRouter } from "./tickets";
import { adminTopupsRouter } from "./topups";
import { adminUsersRouter } from "./users";

const router = Router();

// ── Auth + stats routes ────────────────────────────────────────────────────
// Keep these routers mounted at the admin root: the public contract and the
// SPA both use /api/admin/login, /api/admin/session, /api/admin/stats, and
// /api/admin/chart-data. The leaf auth/stats handlers apply their own
// authentication where required; login and probe remain public by design.
router.use("/", adminAuthRouter);
router.use("/", adminStatsRouter);

// ── Protected routes (require admin auth) ───────────────────────────────────
const protectedRouter = Router();
protectedRouter.use(requireAdmin);

// AI Admin Copilot (010-ai-admin-copilot). Each leaf route inside enforces
// its own phase + scope gate; the parent mount only attaches the router.
protectedRouter.use("/", copilotRouter);

// Anomaly detection (003-anomaly-detection). Risk events are user-related
// investigative data; the `users` scope is the closest fit in the existing
// permission catalog.
protectedRouter.use("/", requirePermission("users"), adminRiskRouter);

// Inventory demand forecasting (011-inventory-demand-forecast). Read-only
// admin surface; gated on the existing `inventory` scope (matches the
// /admin/products gate the panel mounts above).
protectedRouter.use("/", requirePermission("inventory"), adminForecastRouter);

// Catalog enrichment review panel (012-arabic-catalog-enrichment).
// Admin-only review surface for batched LLM-drafted descriptions / FAQ.
// Same `inventory` gate as the existing product-edit pages; the cron
// itself runs separately on the worker tier.
protectedRouter.use("/", requirePermission("inventory"), adminEnrichmentRouter);

protectedRouter.use(
  "/",
  requirePermission("finance"),
  adminTopupsRouter, // /topups/*
);

protectedRouter.use(
  "/",
  requirePermission("inventory"),
  adminProductsRouter, // /products/*
);
protectedRouter.use(
  "/",
  requirePermission("inventory"),
  adminPricingCalculatorRouter, // /pricing/calculate
);
protectedRouter.use(
  "/",
  requirePermission("inventory"),
  adminFlashSalesRouter, // /flash-sales, /flash-sales/:id
);

protectedRouter.use(
  "/",
  requirePermission("users"),
  adminUsersRouter, // /users/*
);
protectedRouter.use(
  "/",
  requirePermission("users"),
  adminReferralsRouter, // /referrals/*
);

protectedRouter.use(
  "/",
  requirePermission("support"),
  adminTicketsRouter, // /tickets/*
);

protectedRouter.use("/alerts", requirePermission("support"), adminAlertsRouter);

protectedRouter.use(
  "/",
  requirePermission("admins"),
  adminSecurityRouter, // /auth-activity, /auth-stats — admin security audit
);

protectedRouter.use(
  "/admins",
  requirePermission("admins"),
  adminAdminsRouter, // /admins, /admins/:id, /admins/:id/permissions
);

protectedRouter.use("/settings", requirePermission("settings"), adminSettingsRouter);

protectedRouter.use("/observability", requirePermission("settings"), adminObservabilityRouter);

protectedRouter.use("/diagnostics", requirePermission("settings"), adminDiagnosticsRouter);

protectedRouter.use(
  "/",
  requirePermission("orders"),
  adminOrdersRouter, // /orders, /orders/bulk-status
);

// Mount protected routes
router.use("/", protectedRouter);

export { router as adminRouter };
