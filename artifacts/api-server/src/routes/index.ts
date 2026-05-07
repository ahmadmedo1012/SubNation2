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

const router = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/products", productsRouter);

// Stable aliases used by the frontend
router.get("/catalog/stats", getProductStatsHandler);
router.get("/flash-sale", getFlashSaleHandler);

router.use("/orders", ordersRouter);
router.use("/wallet", walletRouter);
router.use("/support/tickets", supportRouter);
router.use("/loyalty", loyaltyRouter);
router.use("/notifications", notificationsRouter);
router.use("/admin", adminRouter);
router.use("/coupons", couponsRouter);

export default router;
