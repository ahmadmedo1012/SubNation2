import { db, adminUsersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";

/**
 * Round-5 (db-audit 2026-09-07): boot-time security advisory.
 *
 * Live production state at audit time: exactly one admin account
 * ("ahmadmedo", permissions ["all"]) with TOTP DISABLED. The H10 fix
 * hardened the 2FA *verification* path (attempt lockout, temp-session
 * restrictions) — but the strongest admin in the system still logs in
 * with a password alone. A password compromise = full store control
 * (wallet adjustments with 1e9-class input validation, refunds, admin
 * creation). This advisory surfaces the gap to the drawer weekly
 * (deduped) until TOTP is enrolled, instead of leaving it as an
 * invisible audit-report line.
 *
 * Non-intrusive by design: it never blocks boot, never disables the
 * account, and re-alerts at most once per 7 days via the new dedupe
 * infrastructure.
 */
export async function checkAdminTotpAdvisory(): Promise<void> {
  try {
    const powerfulAdmins = await db
      .select({ id: adminUsersTable.id, username: adminUsersTable.username })
      .from(adminUsersTable)
      .where(
        and(
          eq(adminUsersTable.isActive, true),
          eq(adminUsersTable.totpEnabled, false),
          // "all" grants every RBAC gate — the accounts whose compromise
          // matters most. Limited-permission admins get a pass (their
          // blast radius is bounded by design). JSONB containment
          // matches the admins.ts pattern.
          sql`${adminUsersTable.permissions} @> '["all"]'::jsonb`,
        ),
      );

    if (powerfulAdmins.length === 0) return;

    const names = powerfulAdmins.map((a) => a.username).join("، ");
    await logAdminAlert(
      "system",
      `توصية أمنية: فعّل التحقق بخطوتين (${names})`,
      "حساب أدمن بصلاحيات كاملة يعمل دون TOTP. فعّل التحقق بخطوتين من صفحة الأمان لتقييد الوصول بكلمة المرور وحدها.",
      { dedupeKey: "admin:no-totp", dedupeWindowMs: 7 * 24 * 60 * 60 * 1000 },
    );
    logger.info(
      { category: "security", admins: powerfulAdmins.length },
      "security-advisories: TOTP advisory dispatched (weekly dedupe)",
    );
  } catch (err) {
    // Advisory-only — a failure here must never affect boot.
    logger.warn({ err, category: "security" }, "security-advisories: TOTP check failed");
  }
}
