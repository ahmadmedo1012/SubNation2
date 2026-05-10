import { Router } from "express";
import { adminAuthRouter } from "./auth";
import { adminStatsRouter } from "./stats";
import { adminOrdersRouter } from "./orders";
import { adminTopupsRouter } from "./topups";
import { adminProductsRouter } from "./products";
import { adminUsersRouter } from "./users";
import { adminTicketsRouter } from "./tickets";
import { adminReferralsRouter } from "./referrals";
import { adminAlertsRouter } from "./alerts";
import { adminSettingsRouter } from "./settings";

const router = Router();

// Mount sub-routers
router.use("/", adminAuthRouter);        // /login, /2fa/*
router.use("/", adminStatsRouter);       // /stats, /chart-data
router.use("/", adminOrdersRouter);      // /orders, /orders/bulk-status
router.use("/", adminTopupsRouter);      // /topups/*
router.use("/", adminProductsRouter);    // /products/*
router.use("/", adminUsersRouter);       // /users/*
router.use("/", adminTicketsRouter);     // /tickets/*
router.use("/", adminReferralsRouter);   // /referrals/*
router.use("/alerts", adminAlertsRouter);
router.use("/settings", adminSettingsRouter);

export { router as adminRouter };
