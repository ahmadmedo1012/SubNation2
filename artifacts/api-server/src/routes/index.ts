import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import { authRouter } from "./auth";
import { productsRouter } from "./products";
import { ordersRouter } from "./orders";
import { walletRouter } from "./wallet";
import { adminRouter } from "./admin";
import { supportRouter } from "./support";
import { loyaltyRouter } from "./loyalty";
import { notificationsRouter } from "./notifications";
import { couponsRouter } from "./coupons";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/products", productsRouter);

router.get("/catalog/stats", (req: Request, res: Response, next: NextFunction) => {
  req.url = "/stats";
  productsRouter(req, res, next);
});

router.get("/flash-sale", (req: Request, res: Response, next: NextFunction) => {
  req.url = "/flash-sale";
  (productsRouter as any)(req, res, next);
});

router.use("/orders", ordersRouter);
router.use("/wallet", walletRouter);
router.use("/wallet/topups", walletRouter);
router.use("/support/tickets", supportRouter);
router.use("/loyalty", loyaltyRouter);
router.use("/notifications", notificationsRouter);
router.use("/admin", adminRouter);
router.use("/coupons", couponsRouter);

export default router;
