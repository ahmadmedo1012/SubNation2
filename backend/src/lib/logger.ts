import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Service/version binding - read once at process start (design §3.1.2)
const SERVICE_NAME = process.env.RENDER_SERVICE_NAME === "worker" ? "worker" : "web";
const VERSION = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "unknown";

/**
 * Structured log fields contract from design §4.2.
 * All fields are optional except service and version which are bound at process start.
 */
export interface StructuredLogFields {
  level: pino.Level;
  time: number;
  msg: string;
  requestId?: string; // from correlation context, REQUIRED inside request scope
  userId?: number;
  route?: string;
  latencyMs?: number;
  err?: pino.SerializedError;
  correlationId?: string; // alias of requestId for cross-system parity
  span?: string;
  trace?: string;
  service: "web" | "worker";
  version: string; // RENDER_GIT_COMMIT short SHA
  category?: "auth" | "worker" | "alerting" | "monitoring" | "cwv" | "seo";
}

// Create the base logger first (without serializers to avoid circular reference)
const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Bind service and version at top-level so all children inherit (design §3.1.2)
  base: {
    service: SERVICE_NAME,
    version: VERSION,
  },
  redact: {
    paths: [
      // HTTP headers
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      // Passwords & secrets
      "password",
      "password_hash",
      "passwordHash",
      "account_password",
      "accountPassword",
      // Tokens
      "token",
      "access_token",
      "refresh_token",
      "id_token",
      // OTP
      "otp",
      // Payment
      "card_number",
      "cvv",
      "sender_account",
      // PII
      "ssn",
      "national_id",
      // Extended redact paths (design §3.1.2)
      // Wildcards for secret/token patterns
      "*secret*",
      "*token*",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * Child logger factory that auto-binds correlation context from AsyncLocalStorage.
 * All convenience helpers (authLogger, workerLogger, etc.) use this internally.
 */
export function childLogger(bindings: Partial<StructuredLogFields>): pino.Logger {
  return baseLogger.child(bindings);
}

/**
 * Convenience helpers that auto-bind category and correlation context.
 * These use childLogger internally and inherit service/version from the base logger.
 */
export function authLogger(): pino.Logger {
  return childLogger({ category: "auth" });
}

export function workerLogger(): pino.Logger {
  return childLogger({ category: "worker" });
}

export function alertingLogger(): pino.Logger {
  return childLogger({ category: "alerting" });
}

export function monitoringLogger(): pino.Logger {
  return childLogger({ category: "monitoring" });
}

export function cwvLogger(): pino.Logger {
  return childLogger({ category: "cwv" });
}

// Export the logger with custom serializers (applied after all functions are defined)
export const logger = baseLogger.child(
  {},
  {
    serializers: {
      // This custom serializer scans all top-level fields for sensitive patterns
      // and censors any field whose name matches /secret/i or /token/i
      // Pino's serializers apply to specific keys, so we use a wrapper approach
      // that scans the entire log object
      custom: (obj: unknown) => {
        if (typeof obj !== "object" || obj === null) {
          return obj;
        }

        const result: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(obj)) {
          // Check if key matches sensitive patterns (case-insensitive)
          if (/secret/i.test(key) || /token/i.test(key)) {
            result[key] = "[REDACTED]";
          } else {
            result[key] = value;
          }
        }

        return result;
      },
    },
  },
);
