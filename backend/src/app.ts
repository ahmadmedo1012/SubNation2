import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import pinoHttp from "pino-http";
import { startCouponWatcher } from "./jobs/couponWatcher";
import { startOtpCleanup } from "./jobs/otpCleanup";
import { startStockWatcher } from "./jobs/stockWatcher";
import { logger } from "./lib/logger";
import { runMigrations } from "./migrate";
import router from "./routes";

void runMigrations();
startCouponWatcher();
startStockWatcher();
startOtpCleanup();

const app: Express = express();

function resolveFrontendDist(): string | null {
  const candidates = [
    process.env.FRONTEND_DIST,
    path.resolve(process.cwd(), "../frontend/dist/public"),
    path.resolve(process.cwd(), "frontend/dist/public"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? null;
}

// ── CORS / Allowed Origins ────────────────────────────────────────────────────
// In production restrict to APP_ORIGINS; in dev allow all origins.
const allowedOrigins = process.env.APP_ORIGINS
  ? process.env.APP_ORIGINS.split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  : [];

// ── Security Headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind needs inline styles
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          ...(allowedOrigins.length ? allowedOrigins : ["http://localhost:*"]),
        ],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false, // Allow external images
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);

// Trust the first reverse proxy hop when deployed behind one.
app.set("trust proxy", 1);

// ── CORS ─────────────────────────────────────────────────────────────────────
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

import RedisStore from "rate-limit-redis";
import { createClient } from "redis";

let redisClient: ReturnType<typeof createClient> | null = null;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.connect().catch((err) => logger.error({ err }, "Redis connection failed"));
}

const getStore = () => {
  if (redisClient) {
    return new RedisStore({
      sendCommand: (...args: string[]) => redisClient!.sendCommand(args),
    });
  }
  return undefined; // Falls back to default memory store
};

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Strict limit on auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  store: getStore(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "عدد كبير من المحاولات. حاول مجدداً بعد 15 دقيقة." },
});

// General API limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  store: getStore(),
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

// JSON 404 for unmatched /api/* routes (must come AFTER all /api routers, BEFORE static)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "المسار غير موجود", code: "NOT_FOUND" });
});

const frontendDist = resolveFrontendDist();

if (frontendDist) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, req: { method: req.method, url: req.url } }, "Unhandled error");

  if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
    res.status(400).json({ error: "بيانات غير صالحة" });
  } else if (err.name === "ZodError") {
    res.status(400).json({ error: "بيانات غير صالحة", details: err.errors });
  } else {
    res.status(500).json({ error: "خطأ في الخادم. حاول مرة أخرى." });
  }
});

export default app;
