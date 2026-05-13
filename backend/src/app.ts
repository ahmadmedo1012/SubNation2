import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import pinoHttp from "pino-http";
import RedisStore from "rate-limit-redis";
import { createClient } from "redis";
import { logger } from "./lib/logger";
import router from "./routes";

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
const isProduction = process.env.NODE_ENV === "production";

// ── Security Headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...(isProduction ? [] : ["'unsafe-inline'", "'unsafe-eval'"]),
          "https://apis.google.com",
          "https://accounts.google.com",
          "https://www.gstatic.com",
          "https://www.googleapis.com",
        ],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // Tailwind needs inline styles
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: [
          "'self'",
          "https://*.firebaseio.com",
          "https://*.firebaseapp.com",
          "https://*.googleapis.com",
          "https://accounts.google.com",
          ...(allowedOrigins.length || isProduction
            ? allowedOrigins
            : ["http://localhost:*", "http://127.0.0.1:*"]),
        ],
        frameSrc: ["'self'", "https://accounts.google.com", "https://*.firebaseapp.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
        "trusted-types": ["default", "'allow-duplicates'"],
        "require-trusted-types-for": ["'script'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    crossOriginEmbedderPolicy: false, // Allow external images
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    // Additional security headers
    contentSecurityPolicy: false, // Already configured above
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// Trust the first reverse proxy hop when deployed behind one.
app.set("trust proxy", 1);

// ── Compression ─────────────────────────────────────────────────────────────
app.use(compression());

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

// Redis client (optional - if REDIS_URL is set, use it for rate limiting and session caching)
let redisClient: ReturnType<typeof createClient> | null = null;
if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500),
    },
  });

  redisClient.on("error", (err) => {
    logger.warn({ err }, "Redis client error - falling back to in-memory rate limiting");
    redisClient = null;
  });

  redisClient.connect().catch((err) => {
    logger.warn({ err }, "Failed to connect to Redis - falling back to in-memory rate limiting");
    redisClient = null;
  });
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Use Redis store if available, otherwise fall back to in-memory store
const rateLimiterStore = redisClient
  ? new RedisStore({
      sendCommand: (...args: string[]) => redisClient!.sendCommand(args),
      prefix: "rl:",
    })
  : undefined;

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimiterStore,
  skip: (req) => {
    // Skip rate limiting for health checks and static assets
    const path = req.path;
    return path === "/health" || path.startsWith("/assets/") || path.startsWith("/static/");
  },
});

// Strict rate limiter for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimiterStore,
  skipFailedRequests: false, // CRITICAL: Must count failed requests to stop brute force
  skipSuccessfulRequests: true, // Allow successful logins without consuming rate limit
  message: { error: "عدد كبير من المحاولات. حاول مجدداً بعد 15 دقيقة." },
});

// Per-phone rate limiting for Firebase Phone OTP (prevent abuse on single phone)
const otpPhoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3, // Max 3 OTP sends per phone
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimiterStore,
  keyGenerator: (req) => {
    const body = req.body as { phone?: string };
    return body.phone || req.ip || req.socket.remoteAddress || "unknown";
  },
  message: { error: "تجاوزت عدد محاولات OTP لهذا الرقم. انتظر 15 دقيقة." },
});

// Per-IP rate limiting for Firebase Phone OTP (prevent bulk abuse)
const otpIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10, // Max 10 OTP sends per IP
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimiterStore,
  message: { error: "تجاوزت عدد المحاولات من هذا IP. انتظر ساعة." },
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

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── CSRF Protection for state-changing requests ───────────────────────────────
// Validate Origin/Referer headers for POST/PUT/DELETE/PATCH requests
const allowedOrigins = (process.env.APP_ORIGINS || process.env.APP_URL || "")
  .split(",")
  .map((o) => o.trim());
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // Skip CSRF check for API endpoints that don't need it (auth, webhooks, etc.)
    const skipPaths = ["/api/auth", "/api/webhook", "/health"];
    if (skipPaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    // In production, validate Origin or Referer
    if (process.env.NODE_ENV === "production" && allowedOrigins.length > 0) {
      const isValid =
        (origin &&
          allowedOrigins.some((allowed) => origin === allowed || origin.startsWith(allowed))) ||
        (referer && allowedOrigins.some((allowed) => referer.startsWith(allowed)));

      if (!isValid) {
        logger.warn({ origin, referer, path: req.path }, "CSRF validation failed");
        return res.status(403).json({ error: "طلب غير مصرح" });
      }
    }
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
// Auth limiter applies to login/register only (NOT /me — it's polled frequently)
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/firebase/session", otpPhoneLimiter, otpIpLimiter, authLimiter);
app.use("/api/auth/change-password", authLimiter);
app.use("/api", apiLimiter);
app.use("/api", router);

// JSON 404 for unmatched /api/* routes (must come AFTER all /api routers, BEFORE static)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "المسار غير موجود", code: "NOT_FOUND" });
});

const frontendDist = resolveFrontendDist();

if (frontendDist) {
  // Serve hashed assets with 1-year immutable cache (file names change on rebuild)
  app.use(
    "/assets",
    express.static(path.join(frontendDist, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
  );

  // Serve other static files (manifest, icons, robots.txt) with short cache
  app.use(
    express.static(frontendDist, {
      maxAge: "1h",
      setHeaders(res, filePath) {
        // HTML, SW, and robots must never be cached aggressively
        if (
          filePath.endsWith(".html") ||
          filePath.endsWith("sw.js") ||
          filePath.endsWith("robots.txt")
        ) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, req: { method: req.method, url: req.url } }, "Unhandled error");

  // Send error to Sentry in production
  if (process.env.NODE_ENV === "production") {
    captureException(err, {
      method: req.method,
      url: req.url,
      body: req.body,
      userId: (req as Request & { userId?: number }).userId,
    });
  }

  if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
    res.status(400).json({ error: "بيانات غير صالحة" });
  } else if ("errors" in err) {
    const errorWithErrors = err as { errors?: unknown[] };
    res.status(400).json({ error: "بيانات غير صالحة", details: errorWithErrors.errors });
  } else {
    res.status(500).json({ error: "خطأ في الخادم. حاول مرة أخرى." });
  }
});

export default app;
