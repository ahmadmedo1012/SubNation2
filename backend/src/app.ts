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
import { captureException } from "./lib/sentry";
import router from "./routes";

const app = express();

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
const csrfAllowedOrigins = (process.env.APP_ORIGINS || process.env.APP_URL || "")
  .split(",")
  .map((o) => o.trim());

// ── Security Headers ──────────────────────────────────────────────────────────
//
// Firebase Google Sign-In popup compatibility notes:
//
// 1. COOP must be "same-origin-allow-popups" — allows the popup window to
//    postMessage back to the opener and call window.close() without browser
//    security warnings. "same-origin" would block popup communication entirely.
//
// 2. COEP must be disabled (false) — enabling it would require all sub-resources
//    to opt-in via CORP/COEP headers, which Firebase's CDN resources do not do.
//
// 3. trusted-types CSP directive MUST NOT be used without "require-trusted-types-for"
//    being absent, OR the policy list must include all policies Firebase SDK
//    creates internally. The safest approach is to omit trusted-types entirely
//    since Firebase Auth SDK (v9+) creates its own internal Trusted Types policies
//    ('firebase-auth', 'goog#html', 'gapi#gapi') and the browser will block them
//    if the CSP trusted-types allowlist doesn't exactly match. Omitting the
//    directive entirely lets the browser use its default (permissive) behavior.
//
// 4. frameSrc must include *.firebaseapp.com for the hidden auth iframe that
//    Firebase uses for cross-origin session persistence.
//
// 5. connectSrc must include all Firebase/Google API endpoints.
//
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...(isProduction ? [] : ["'unsafe-inline'", "'unsafe-eval'"]),
          // Google/Firebase auth scripts
          "https://apis.google.com",
          "https://accounts.google.com",
          "https://www.gstatic.com",
          "https://www.googleapis.com",
          "https://*.firebaseapp.com",
        ],
        // Do NOT set scriptSrcAttr to 'none' — Firebase SDK injects inline
        // event handlers in the popup/iframe auth flow.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: [
          "'self'",
          // Firebase Realtime Database & Auth
          "https://*.firebaseio.com",
          "wss://*.firebaseio.com",
          "https://*.firebaseapp.com",
          // Google APIs (token exchange, user info, etc.)
          "https://*.googleapis.com",
          "https://accounts.google.com",
          // Firebase Auth REST API
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          ...(allowedOrigins.length || isProduction
            ? allowedOrigins
            : ["http://localhost:*", "http://127.0.0.1:*"]),
        ],
        // frameSrc: Firebase uses a hidden iframe at *.firebaseapp.com/__/auth/iframe
        // for cross-origin session persistence. accounts.google.com is the OAuth popup.
        frameSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://*.firebaseapp.com",
          "https://*.firebase.com",
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
        // IMPORTANT: Do NOT include a "trusted-types" directive here.
        // Firebase Auth SDK v9+ creates internal Trusted Types policies at runtime
        // ('firebase-auth', 'goog#html', 'gapi#gapi', etc.). If we enumerate an
        // allowlist, any policy name mismatch causes a TypeError that silently
        // breaks the popup flow — the popup completes but getIdToken() returns
        // a garbage/empty value (observed: id_token_length of 4, 14, 18 chars).
        // Omitting the directive entirely is the correct, Firebase-compatible approach.
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    // COEP must be disabled for Firebase popup auth compatibility.
    // Firebase's CDN resources (gstatic.com, googleapis.com) do not send
    // Cross-Origin-Resource-Policy headers, so enabling COEP would block them.
    crossOriginEmbedderPolicy: false,
    // COOP: "same-origin-allow-popups" is the correct value for Firebase popup auth.
    // - "same-origin" would block window.close() and postMessage from the popup
    //   back to the opener, breaking the entire auth flow.
    // - "unsafe-none" would remove cross-origin isolation entirely (too permissive).
    // - "same-origin-allow-popups" allows popups opened by this page to communicate
    //   back while still protecting against cross-origin opener attacks.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    xContentTypeOptions: true,
    xFrameOptions: { action: "sameorigin" },
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

// Custom IP key generator that handles IPv6 subnets
const ipKeyGenerator = (req: Request) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  // For IPv6, use /64 subnet to reduce false positives from dynamic suffixes
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 4).join(":") + "::/64";
  }
  return ip;
};

let redisClient: ReturnType<typeof createClient> | null = null;
if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500),
    },
  });

  redisClient.on("error", (err) => {
    if (isProduction) {
      logger.fatal({ err }, "Redis client error - required for production");
      process.exit(1);
    }
    logger.warn({ err }, "Redis client error - falling back to in-memory rate limiting");
    redisClient = null;
  });

  redisClient.connect().catch((err) => {
    if (isProduction) {
      logger.fatal({ err }, "Failed to connect to Redis - required for production");
      process.exit(1);
    }
    logger.warn({ err }, "Failed to connect to Redis - falling back to in-memory rate limiting");
    redisClient = null;
  });
} else if (isProduction) {
  logger.warn(
    "REDIS_URL is missing in production. Falling back to in-memory stores. This is NOT recommended for production scaling.",
  );
  redisClient = null;
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
  keyGenerator: ipKeyGenerator,
  store: rateLimiterStore,
  skip: (req) => {
    // Skip rate limiting for health checks and static assets
    const path = req.path;
    return path === "/health" || path.startsWith("/assets/") || path.startsWith("/static/");
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  store: rateLimiterStore,
  skipFailedRequests: false,
  skipSuccessfulRequests: true,
  message: { error: "عدد كبير من المحاولات. حاول مجدداً بعد 15 دقيقة." },
});

// Per-phone rate limiting for Firebase Phone OTP (prevent abuse on single phone)
const otpPhoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const body = req.body as { phone?: string };
    return body.phone || ipKeyGenerator(req);
  },
  store: rateLimiterStore,
  message: { error: "تجاوزت عدد محاولات OTP لهذا الرقم. انتظر 15 دقيقة." },
});

// Per-IP rate limiting for Firebase Phone OTP (prevent bulk abuse)
const otpIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
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
    if (process.env.NODE_ENV === "production" && csrfAllowedOrigins.length > 0) {
      const isValid =
        (origin &&
          csrfAllowedOrigins.some((allowed) => origin === allowed || origin.startsWith(allowed))) ||
        (referer && csrfAllowedOrigins.some((allowed) => referer.startsWith(allowed)));

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
app.use("/api/auth/firebase/session", authLimiter);
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
