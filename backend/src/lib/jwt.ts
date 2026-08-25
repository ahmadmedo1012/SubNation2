import jwt from "jsonwebtoken";
import { logger } from "./logger";

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error(
    "SESSION_SECRET environment variable is required. Set it in your host's environment " +
      "(e.g. Render Dashboard → Environment → SESSION_SECRET). Generate with " +
      "`openssl rand -base64 64 | tr -d '\\n'`.",
  );
}

if (sessionSecret.length < 32) {
  throw new Error(
    `SESSION_SECRET must be at least 32 characters (256 bits) of entropy; ` +
      `current value is ${sessionSecret.length} chars. Generate a new one with ` +
      `\`openssl rand -base64 64 | tr -d '\\n'\` and update it on the host.`,
  );
}

export const JWT_SECRET: string = sessionSecret;

/**
 * F-001 (security audit 004) — admin token signing key MUST be independent of
 * the customer signing key.
 *
 * The previous implementation derived ADMIN_JWT_SECRET by string-concatenating
 * `_admin` to JWT_SECRET. That meant a leak of SESSION_SECRET — already gated
 * as a Critical-class secret — instantly produced a valid admin signing key
 * with no extra step. Constitution Principle II requires admin sessions to
 * use a *separate* secret; the spirit was broken even though both fields
 * existed.
 *
 * Resolution:
 *   - Read ADMIN_JWT_SECRET as a distinct environment variable.
 *   - Production (NODE_ENV === "production"): fail-fast at boot if missing or
 *     < 32 chars. No derivation fallback. This matches the existing fail-fast
 *     posture for SESSION_SECRET / ENCRYPTION_KEY.
 *   - Non-production: log a deprecation warning and fall back to derivation,
 *     so existing dev/test environments keep working until operators add the
 *     env var. The derivation fallback is REMOVED entirely once every
 *     environment has been updated (tracked: future commit on this branch's
 *     follow-up).
 *
 * Deployment runbook for rotation:
 *   1. Generate a new value: `openssl rand -base64 64 | tr -d '\n'`
 *   2. Set it in Render dashboard as ADMIN_JWT_SECRET (sync: false).
 *   3. Re-deploy. Existing admin sessions become unverifiable; admins re-log
 *     in. Plan a brief admin-logout window.
 */
const isProduction = process.env.NODE_ENV === "production";
const adminSecretFromEnv = process.env.ADMIN_JWT_SECRET;

function resolveAdminSecret(): string {
  if (adminSecretFromEnv) {
    if (adminSecretFromEnv.length < 32) {
      throw new Error(
        `ADMIN_JWT_SECRET must be at least 32 characters (256 bits) of entropy; ` +
          `current value is ${adminSecretFromEnv.length} chars. Generate a new one with ` +
          `\`openssl rand -base64 64 | tr -d '\\n'\` and update it on the host.`,
      );
    }
    if (adminSecretFromEnv === sessionSecret) {
      throw new Error(
        "ADMIN_JWT_SECRET must NOT equal SESSION_SECRET. Generate a distinct value with " +
          "`openssl rand -base64 64 | tr -d '\\n'` so an admin-token forgery requires " +
          "compromising both secrets, not just one (Constitution Principle II).",
      );
    }
    return adminSecretFromEnv;
  }

  if (isProduction) {
    throw new Error(
      "ADMIN_JWT_SECRET environment variable is required in production. " +
        "Set it in your host's environment (e.g. Render Dashboard → Environment → " +
        "ADMIN_JWT_SECRET, sync:false). It MUST be ≥ 32 chars AND distinct from " +
        "SESSION_SECRET. Generate with `openssl rand -base64 64 | tr -d '\\n'`. " +
        "Per security audit Finding F-001, deriving the admin secret from the " +
        "customer secret means a SESSION_SECRET leak instantly compromises admin " +
        "tokens — the audit closed this as urgent quick-win.",
    );
  }

  // Non-production: deprecated derivation fallback. Loud warning so dev environments
  // are nudged toward setting the env var. This branch is removed once every
  // environment is on the new path.
  logger.warn(
    {
      env: process.env.NODE_ENV ?? "development",
      audit_finding: "F-001",
    },
    "ADMIN_JWT_SECRET not set — falling back to deprecated derivation from SESSION_SECRET. " +
      "Set ADMIN_JWT_SECRET (≥ 32 chars, distinct from SESSION_SECRET) before promoting to " +
      "production. See specs/004-security-audit/security.md F-001.",
  );
  return JWT_SECRET + "_admin";
}

export const ADMIN_JWT_SECRET: string = resolveAdminSecret();

export function signUserToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export type TokenError = "expired" | "invalid";
export type VerifyResult<T> = { ok: true; payload: T } | { ok: false; reason: TokenError };

export function verifyUserToken(token: string): { userId: number; sessionId?: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number; sessionId?: string };
  } catch {
    return null;
  }
}

export function verifyUserTokenDetailed(token: string): VerifyResult<{ userId: number; sessionId?: string }> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; sessionId?: string };
    return { ok: true, payload };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

export function signAdminToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: "8h" });
}

export function verifyAdminToken(token: string): { adminId: number; role: string } | null {
  try {
    return jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: number; role: string };
  } catch {
    return null;
  }
}

export function verifyAdminTokenDetailed(
  token: string,
): VerifyResult<{ adminId: number; role: string }> {
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: number; role: string };
    return { ok: true, payload };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
