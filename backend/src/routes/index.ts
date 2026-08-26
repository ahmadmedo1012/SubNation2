import { Router } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requirePermission } from "../lib/permissions";
import healthRouter from "./health";
import { authRouter } from "./auth";
import { telegramWebhookRouter } from "./telegram-webhook";
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
import { whatsappAuthRouter } from "./auth-whatsapp";
import metricsRouter from "./metrics";
import cwvRouter from "./cwv";

const router = Router();

router.use(healthRouter);
router.use(metricsRouter);
router.use(cwvRouter);

// ── Auth ──────────────────────────────────────────────────────────────────────
router.use("/auth", authRouter);
router.use("/auth", authProviderPublicRouter);
router.use("/webhook", telegramWebhookRouter); // /api/webhook/telegram — CSRF-skipped via "/api/webhook" prefix // /api/auth/providers, /api/auth/telegram, etc.
router.use("/auth", whatsappAuthRouter); // /api/auth/whatsapp/start, /api/auth/whatsapp/verify

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
router.use("/admin/settings", requireAdmin, requirePermission("settings"), authProviderAdminRouter); // /api/admin/settings/auth

export default router;
