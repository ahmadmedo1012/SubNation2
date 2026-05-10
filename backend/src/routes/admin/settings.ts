import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { isTelegramConfigured } from "../../telegram";

const router = Router();

router.get("/", requireAdmin, async (_req, res) => {
  return res.json({
    telegram_configured: isTelegramConfigured(),
    platform_name: "SubNation",
    currency: "LYD",
    maintenance_mode: false,
  });
});

export { router as adminSettingsRouter };
