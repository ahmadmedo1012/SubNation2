import { Router } from "express";
import healthRouter from "./health";
import { authRouter } from "./auth";
import { productsRouter, getProductStatsHandler, getFlashSaleHandler } from "./products";
import { ordersRouter } from "./orders";
import { walletRouter } from "./wallet";
import { adminRouter } from "./admin";
import { supportRouter } from "./support";
import { loyaltyRouter } from "./loyalty";
import { notificationsRouter } from "./notifications";
import { couponsRouter } from "./coupons";
import { authProviderPublicRouter, authProviderAdminRouter } from "./auth-settings";

const router = Router();

router.use(healthRouter);

// ── Auth ──────────────────────────────────────────────────────────────────────
router.use("/auth", authRouter);
router.use("/auth", authProviderPublicRouter); // /api/auth/providers, /api/auth/github, etc.

// ── Products ──────────────────────────────────────────────────────────────────
router.use("/products", productsRouter);
router.get("/catalog/stats", getProductStatsHandler);
router.get("/flash-sale", getFlashSaleHandler);

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
