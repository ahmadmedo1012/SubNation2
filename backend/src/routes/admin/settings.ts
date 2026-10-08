import { Router } from "express";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { isTelegramConfigured } from "../../telegram";

const router = Router();

// R123-E5 (A6 P3): no-store parity with the 98-F3 pattern — platform
// settings answers (e.g. telegram_configured) drive admin-panel
// behavior; an intermediary must never serve them from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/", requireAdmin, async (_req, res) => {
  return res.json({
    telegram_configured: isTelegramConfigured(),
    platform_name: "SubNation",
    currency: "LYD",
    maintenance_mode: false,
  });
});

export { router as adminSettingsRouter };
