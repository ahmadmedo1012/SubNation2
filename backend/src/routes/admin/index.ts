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

// ── Mount sub-routers + permission scopes ─────────────────────────────────
//
// Every privileged sub-router below is gated by `requireAdmin` (auth)
// + `requirePermission(scope)` (RBAC). The middleware runs once at the
// parent mount so every leaf route inherits the same scope check —
// no per-handler decoration needed, no risk of forgetting one.
//
// Auth + stats are intentionally scope-free:
//   • adminAuthRouter      — login/logout/probe/profile = self-service
//   • adminStatsRouter     — dashboard summary = read-only, all admins
//
// Existing admins were backfilled with permissions=["all"] so they
// pass every scope check (the wildcard short-circuits hasPermission).
// New scoped admins created via /admin/admins pick from the same
// scope catalog declared in lib/permissions.ts.

router.use("/", adminAuthRouter); // /login, /logout, /probe, /profile, /change-password, /session, /2fa/*
router.use("/", adminStatsRouter); // /stats, /chart-data — all admins (dashboard)

router.use(
  "/",
  requireAdmin,
  requirePermission("orders"),
  adminOrdersRouter, // /orders, /orders/bulk-status
);

// AI Admin Copilot (010-ai-admin-copilot). Each leaf route inside enforces
// its own phase + scope gate; the parent mount only attaches the router.
router.use("/", copilotRouter);

// Anomaly detection (003-anomaly-detection). Risk events are user-related
// investigative data; the `users` scope is the closest fit in the existing
// permission catalog.
router.use("/", requireAdmin, requirePermission("users"), adminRiskRouter);

// Inventory demand forecasting (011-inventory-demand-forecast). Read-only
// admin surface; gated on the existing `inventory` scope (matches the
// /admin/products gate the panel mounts above).
router.use("/", requireAdmin, requirePermission("inventory"), adminForecastRouter);

// Catalog enrichment review panel (012-arabic-catalog-enrichment).
// Admin-only review surface for batched LLM-drafted descriptions / FAQ.
// Same `inventory` gate as the existing product-edit pages; the cron
// itself runs separately on the worker tier.
router.use("/", requireAdmin, requirePermission("inventory"), adminEnrichmentRouter);

router.use(
  "/",
  requireAdmin,
  requirePermission("finance"),
  adminTopupsRouter, // /topups/*
);

router.use(
  "/",
  requireAdmin,
  requirePermission("inventory"),
  adminProductsRouter, // /products/*
);
router.use(
  "/",
  requireAdmin,
  requirePermission("inventory"),
  adminPricingCalculatorRouter, // /pricing/calculate
);
router.use(
  "/",
  requireAdmin,
  requirePermission("inventory"),
  adminFlashSalesRouter, // /flash-sales, /flash-sales/:id
);

router.use(
  "/",
  requireAdmin,
  requirePermission("users"),
  adminUsersRouter, // /users/*
);
router.use(
  "/",
  requireAdmin,
  requirePermission("users"),
  adminReferralsRouter, // /referrals/*
);

router.use(
  "/",
  requireAdmin,
  requirePermission("support"),
  adminTicketsRouter, // /tickets/*
);

router.use("/alerts", requireAdmin, requirePermission("support"), adminAlertsRouter);

router.use(
  "/",
  requireAdmin,
  requirePermission("admins"),
  adminSecurityRouter, // /auth-activity, /auth-stats — admin security audit
);

router.use(
  "/admins",
  requireAdmin,
  requirePermission("admins"),
  adminAdminsRouter, // /admins, /admins/:id, /admins/:id/permissions
);

router.use("/settings", requireAdmin, requirePermission("settings"), adminSettingsRouter);

router.use("/observability", requireAdmin, requirePermission("settings"), adminObservabilityRouter);

router.use("/diagnostics", requireAdmin, requirePermission("settings"), adminDiagnosticsRouter);

export { router as adminRouter };
