import { Router } from "express";
import { requirePermission } from "../../lib/permissions";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { adminAdminsRouter } from "./admins";
import { adminAlertsRouter } from "./alerts";
import { adminAuditLogsRouter } from "./audit-logs";
import { adminAuthRouter } from "./auth";
import { adminDiagnosticsRouter } from "./diagnostics";
import { adminFlashSalesRouter } from "./flash-sales";
import { adminObservabilityRouter } from "./observability";
import { adminOrdersRouter } from "./orders";
import { adminPricingConfigRouter } from "./pricing-config";
import { adminProductVariantsRouter } from "./product-variants";
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

// R134 (A5-F1): the scope gates are PATH-SCOPED, never root-mounted. A
// `use("/", requirePermission(x), router)` mount prefix-matches EVERY
// protected admin request, so the gates composed CUMULATIVELY: a scoped
// admin (e.g. ["orders"]) was 403'd by the first unrelated gate in mount
// order (the `users` gate in front of the risk router) before ever
// reaching their own scope's routes — at runtime only "all"/near-union
// grants worked, and the R122 subset-grant story was functionally dead
// (fail-closed over-restriction, never escalation). `use("/topups", gate)`
// fires only for that path family; the sub-routers keep their full
// internal paths and still mount at "/" below. Path families are
// prefix-disjoint (verified: no admin route path starts with another
// family's prefix), and the segment-boundary behavior ("/orders" does
// not match "/orders2") is pinned by rbac-composition.test.ts.
protectedRouter.use("/risk", requirePermission("users")); // 003-anomaly-detection: user-investigative data
protectedRouter.use("/forecast", requirePermission("inventory")); // 011-inventory-demand-forecast
protectedRouter.use("/enrichment", requirePermission("inventory")); // 012-arabic-catalog-enrichment
protectedRouter.use("/topups", requirePermission("finance"));
protectedRouter.use("/products", requirePermission("inventory")); // products + product-variants
protectedRouter.use("/pricing", requirePermission("inventory")); // pricing-config (R181: the calculator simulator is retired)
protectedRouter.use("/flash-sales", requirePermission("inventory"));
// B1-3 (R111): these two `users` gates cover the LIST/loyalty surfaces;
// the MONEY writes inside (PATCH /users/:id wallet mutations, POST
// /referrals/:id/credit) additionally require `finance` at the route
// level — see users.ts / referrals.ts.
protectedRouter.use("/users", requirePermission("users"));
protectedRouter.use("/referrals", requirePermission("users"));
protectedRouter.use("/tickets", requirePermission("support"));
protectedRouter.use("/auth-activity", requirePermission("admins")); // admin security audit family
protectedRouter.use("/auth-stats", requirePermission("admins"));
protectedRouter.use("/orders", requirePermission("orders"));

// The routers themselves — full internal paths, mounted at the root.
protectedRouter.use("/", adminRiskRouter); // /risk/*
protectedRouter.use("/", adminForecastRouter); // /forecast/*
protectedRouter.use("/", adminEnrichmentRouter); // /enrichment/*
protectedRouter.use("/", adminTopupsRouter); // /topups/*
protectedRouter.use(
  "/",
  adminProductsRouter, // /products/*
  adminProductVariantsRouter, // /products/:id/variants/* (catalog 2026-09-20)
);
protectedRouter.use(
  "/",
  adminPricingConfigRouter, // /pricing/config, /pricing/recompute (catalog 2026-09-20; R181: /pricing/calculate retired with the simulator)
);
protectedRouter.use("/", adminFlashSalesRouter); // /flash-sales, /flash-sales/:id
protectedRouter.use("/", adminUsersRouter); // /users/*
protectedRouter.use("/", adminReferralsRouter); // /referrals/*
protectedRouter.use("/", adminTicketsRouter); // /tickets/*
protectedRouter.use("/", adminSecurityRouter); // /auth-activity, /auth-stats

protectedRouter.use("/alerts", requirePermission("support"), adminAlertsRouter);

// R127-L5 (B15-1): the audit-trail reader — the security family's
// «إجراءات المسؤولين» tab. Same `admins` gate as the security router:
// the audit log is the accountability surface for admin-scope
// operators (every writer already sits behind an admin route).
protectedRouter.use(
  "/audit-logs",
  requirePermission("admins"),
  adminAuditLogsRouter, // /audit-logs
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
  adminOrdersRouter, // /orders, /orders/bulk-status
);

// Mount protected routes
router.use("/", protectedRouter);

export { router as adminRouter };
