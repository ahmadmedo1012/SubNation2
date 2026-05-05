import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { runMigrations } from "./migrate";
import { startCouponWatcher } from "./jobs/couponWatcher";
import { startStockWatcher } from "./jobs/stockWatcher";

runMigrations().catch(err => { logger.error({ err }, "Startup migration failed"); });
startCouponWatcher();
startStockWatcher();

const app: Express = express();

// Trust the first hop from Replit's reverse proxy (needed for rate limiting & IP detection)
app.set("trust proxy", 1);

// ── CORS ─────────────────────────────────────────────────────────────────────
// In production restrict to REPLIT_DOMAINS; in dev allow all
const allowedOrigins = process.env.REPLIT_DOMAINS
  ? process.env.REPLIT_DOMAINS.split(",").map(d => `https://${d.trim()}`)
  : [];

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin (no origin header) and server-to-server calls
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true); // dev: allow all
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS: origin not allowed"));
    },
    credentials: true,
  }),
);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Strict limit on auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "عدد كبير من المحاولات. حاول مجدداً بعد 15 دقيقة." },
});

// General API limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "تجاوزت الحد المسموح به. حاول مجدداً بعد قليل." },
});

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Routes ────────────────────────────────────────────────────────────────────
// Auth limiter applies to login/register/google only (NOT /me — it's polled frequently)
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/google", authLimiter);
app.use("/api/auth/change-password", authLimiter);
app.use("/api", apiLimiter);
app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, req: { method: req.method, url: req.url } }, "Unhandled error");
  res.status(500).json({ error: "خطأ في الخادم. حاول مرة أخرى." });
});

export default app;
