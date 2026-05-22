import { Router } from "express";
import healthRouter from "./health";
import { authRouter } from "./auth";
import {
  productsRouter,
  getProductStatsHandler,
  getFlashSaleHandler,
  catalogCache,
  flashSaleCache,
} from "./products";
import { ordersRouter } from "./orders";
import { walletRouter } from "./wallet";
import { adminRouter } from "./admin";
import { supportRouter } from "./support";
import { loyaltyRouter } from "./loyalty";
import { notificationsRouter } from "./notifications";
import { couponsRouter } from "./coupons";
import { authProviderPublicRouter, authProviderAdminRouter } from "./auth-settings";
import metricsRouter from "./metrics";
import cwvRouter from "./cwv";

const router = Router();

router.use(healthRouter);
router.use(metricsRouter);
router.use(cwvRouter);

// ── Auth ──────────────────────────────────────────────────────────────────────
router.use("/auth", authRouter);
router.use("/auth", authProviderPublicRouter); // /api/auth/providers, /api/auth/github, etc.

// ── Products ──────────────────────────────────────────────────────────────────
router.use("/products", productsRouter);
// Aliases — apply the same edge-cache middleware as the canonical
// /api/products/{stats,flash-sale} mounts, otherwise the alias paths
// hit the origin DB on every request while their siblings serve from
// the CDN edge for 60s/30s windows.
router.get("/catalog/stats", catalogCache, getProductStatsHandler);
router.get("/flash-sale", flashSaleCache, getFlashSaleHandler);

// ── User routes ───────────────────────────────────────────────────────────────
router.use("/orders", ordersRouter);
router.use("/wallet", walletRouter);
router.use("/support/tickets", supportRouter);
router.use("/loyalty", loyaltyRouter);
router.use("/notifications", notificationsRouter);
router.use("/coupons", couponsRouter);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.use("/admin", adminRouter);
router.use("/admin/settings", authProviderAdminRouter); // /api/admin/settings/auth

export default router;
