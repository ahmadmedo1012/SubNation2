import { db, authActivityTable } from "@workspace/db";
import type { Request } from "express";
import { authOutcomesTotal, safeInc } from "./metrics";

export interface AuthActivityParams {
  userId?: number;
  identifier: string;
  action:
    | "login"
    | "register"
    | "logout"
    | "logout_all"
    | "provider_link"
    | "provider_unlink"
    | "password_change";
  provider?: string;
  success: boolean;
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Map an `(action, provider, success, failureReason)` tuple to the
 * `auth_outcomes_total{method, outcome}` label set used on /api/metrics.
 *
 * `method` is one of: "firebase" | "password" | "otp" | "google" | "telegram"
 *           | "github" | "facebook" | "apple" | "unknown"
 * `outcome` is: "success" | "failure" | "lockout"
 */
function deriveAuthLabels(
  params: AuthActivityParams,
): { method: string; outcome: "success" | "failure" | "lockout" } {
  const provider = (params.provider ?? "").toLowerCase();
  let method = "unknown";
  if (provider === "firebase" || provider === "google" || provider === "google.com") {
    method = "firebase";
  } else if (provider === "password" || provider === "" || provider === "credentials") {
    method = "password";
  } else if (provider === "otp" || provider === "phone") {
    method = "otp";
  } else {
    method = provider; // github / facebook / apple / telegram → label-as-is
  }

  let outcome: "success" | "failure" | "lockout" = params.success ? "success" : "failure";
  if (!params.success && params.failureReason) {
    const reason = params.failureReason.toLowerCase();
    if (reason.includes("lockout") || reason.includes("locked")) {
      outcome = "lockout";
    }
  }

  return { method, outcome };
}

/**
 * Log authentication activity to the auth_activity table AND emit the
 * `auth_outcomes_total` Prometheus counter with appropriate labels.
 *
 * This is the chokepoint for every login/register/logout/Firebase/OTP path,
 * so instrumenting it here observes the entire auth surface for free.
 */
export async function logAuthActivity(params: AuthActivityParams): Promise<void> {
  // 1. Persist the audit row.
  await db.insert(authActivityTable).values({
    userId: params.userId,
    identifier: params.identifier,
    action: params.action,
    provider: params.provider,
    success: params.success,
    failureReason: params.failureReason,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    createdAt: new Date(),
  });

  // 2. Emit the metric (best-effort — never blocks or throws). We only emit
  // for state-changing actions where success/failure is meaningful;
  // logout/logout_all/provider_(un)link still increment so admins can see
  // baseline activity volume.
  const { method, outcome } = deriveAuthLabels(params);
  safeInc(authOutcomesTotal, { method, outcome });
}

/**
 * Extract client information (IP address and user agent) from request
 */
export function getClientInfo(req: Request): { ipAddress: string; userAgent: string } {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    userAgent: req.get("user-agent") || "unknown",
  };
}
