import { Router } from "express";
import { requirePermission } from "../../lib/permissions";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { adminAdminsRouter } from "./admins";
import { adminAlertsRouter } from "./alerts";
import { adminAuthRouter } from "./auth";
import { adminDiagnosticsRouter } from "./diagnostics";
import { adminFlashSalesRouter } from "./flash-sales";
import { adminObservabilityRouter } from "./observability";
import { adminOrdersRouter } from "./orders";
import { adminPricingCalculatorRouter } from "./pricing-calculator";
import { adminProductsRouter } from "./products";
import { adminReferralsRouter } from "./referrals";
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

router.use(
  "/alerts",
  requireAdmin,
  requirePermission("support"),
  adminAlertsRouter,
);

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

router.use(
  "/settings",
  requireAdmin,
  requirePermission("settings"),
  adminSettingsRouter,
);

router.use(
  "/observability",
  requireAdmin,
  requirePermission("settings"),
  adminObservabilityRouter,
);

router.use(
  "/diagnostics",
  requireAdmin,
  requirePermission("settings"),
  adminDiagnosticsRouter,
);

export { router as adminRouter };
