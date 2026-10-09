import { db, adminUsersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logAdminAlert, resolveAlertsByDedupeKey } from "./alertLogger";
import { logger } from "../lib/logger";

/**
 * Round-5 (db-audit 2026-09-07): security advisory for powerful admins
 * without TOTP.
 *
 * Live production state at audit time: exactly one admin account
 * ("ahmadmedo", permissions ["all"]) with TOTP DISABLED. The H10 fix
 * hardened the 2FA *verification* path (attempt lockout, temp-session
 * restrictions) — but the strongest admin in the system still logs in
 * with a password alone. A password compromise = full store control
 * (wallet adjustments with 1e9-class input validation, refunds, admin
 * creation). This advisory surfaces the gap to the drawer until TOTP
 * is enrolled, instead of leaving it as an invisible audit-report line.
 *
 * Cadence (A6 P3#14, round-93): originally a boot one-shot only, which
 * made "weekly" actually mean "on restart" — the keep-alive pings keep
 * the process alive for weeks, so a no-deploy month meant no nudges.
 * Now ALSO scheduled daily at 00:05 UTC from cron.ts; the 7-day
 * dedupeKey window is what makes it effectively weekly. The boot
 * one-shot in web-scheduler.ts still covers fresh deploys.
 *
 * Resolution (A6 P3#14): when every ["all"] admin has TOTP enabled the
 * advisory auto-resolves — lingering unread admin:no-totp rows are
 * marked read so the drawer stops asserting a gap that no longer
 * exists (previously they lingered up to 14 days until the stale-
 * marking retention swept them).
 *
 * Non-intrusive by design: it never blocks boot, never disables the
 * account, and re-alerts at most once per 7 days via the dedupe
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

    if (powerfulAdmins.length === 0) {
      // A6 P3#14 (round-93): nothing to advise — resolve any lingering
      // unread advisory from before TOTP was enabled (or after the
      // powerful admin was deactivated). Idempotent: 0 rows touched
      // when nothing is lingering.
      const resolved = await resolveAlertsByDedupeKey("admin:no-totp");
      if (resolved > 0) {
        logger.info(
          { category: "security", resolved },
          "security-advisories: TOTP advisory auto-resolved (all powerful admins protected)",
        );
      }
      return;
    }

    const names = powerfulAdmins.map((a) => a.username).join("، ");
    await logAdminAlert(
      "system",
      `توصية أمنية: فعّل التحقق بخطوتين (${names})`,
      "حساب مدير بصلاحيات كاملة يعمل دون تحقق بخطوتين. فعّله من صفحة الأمان حتى لا يبقى الوصول معتمداً على كلمة المرور وحدها.",
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
