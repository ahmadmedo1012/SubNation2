import { Router } from "express";
import { adminAlertsRouter } from "./alerts";
import { adminAuthRouter } from "./auth";
import { adminDiagnosticsRouter } from "./diagnostics";
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

// Mount sub-routers
router.use("/", adminAuthRouter); // /login, /2fa/*
router.use("/", adminStatsRouter); // /stats, /chart-data
router.use("/", adminOrdersRouter); // /orders, /orders/bulk-status
router.use("/", adminTopupsRouter); // /topups/*
router.use("/", adminProductsRouter); // /products/*
router.use("/", adminPricingCalculatorRouter); // /pricing/calculate
router.use("/", adminUsersRouter); // /users/*
router.use("/", adminTicketsRouter); // /tickets/*
router.use("/", adminReferralsRouter); // /referrals/*
router.use("/", adminSecurityRouter); // /auth-activity, /auth-stats
router.use("/alerts", adminAlertsRouter);
router.use("/settings", adminSettingsRouter);
router.use("/observability", adminObservabilityRouter);
router.use("/diagnostics", adminDiagnosticsRouter);

export { router as adminRouter };
