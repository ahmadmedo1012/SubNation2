/**
 * R120-B6/A8-F5: process-wide daily OTP send ceiling — extracted from
 * services/whatsapp-otp.service.ts (R136 BE-2).
 *
 * Every pre-existing OTP cap is keyed per-phone (cooldown, hourly
 * limit) or per-IP (the /start limiter in app.ts). A distributed
 * attacker rotating IPs can hit a distinct number under each — no
 * individual cap ever trips, while the gateway burns quota and real
 * phones receive spam. This is the global brake the identifier-keyed
 * caps cannot provide: a single in-memory counter of ACTUAL sends
 * (successful dispatches only — a failed delivery consumed nothing),
 * reset at the UTC day boundary (TZ=UTC is pinned in the Dockerfile
 * runtime stage).
 *
 * In-memory by design: the deployment is single-replica
 * (SINGLE_INSTANCE_MODE, R108), so process state IS the global state,
 * and a restart legitimately re-arms the brake (a restart is also a
 * fresh operator-visible event). Concurrency note: different phones do
 * not share the per-phone start lock, so a burst racing at count =
 * cap-1 may overshoot by a few concurrent sends before the gate trips
 * — acceptable for an abuse brake, not a billing meter.
 */

import { logger } from "./logger";

export interface OtpDailySendState {
  /** UTC calendar day (YYYY-MM-DD) the counter belongs to. */
  utcDay: string;
  /** Successful sends this UTC day, process-wide (all phones/purposes). */
  sent: number;
  /** True once the cap-trip error + admin alert have fired for this day. */
  capTripAnnounced: boolean;
}

const otpDailySendState: OtpDailySendState = {
  utcDay: new Date().toISOString().slice(0, 10),
  sent: 0,
  capTripAnnounced: false,
};

/** Env-tunable ceiling (OTP_DAILY_SEND_CAP; documented in config/env.example). */
const DEFAULT_OTP_DAILY_SEND_CAP = 500;

export function otpDailySendCap(): number {
  const raw = Number(process.env.OTP_DAILY_SEND_CAP);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OTP_DAILY_SEND_CAP;
}

/** Roll the counter at the UTC day boundary — lazily, on first touch of the day. */
export function otpDailyStateForToday(): OtpDailySendState {
  const today = new Date().toISOString().slice(0, 10);
  if (otpDailySendState.utcDay !== today) {
    otpDailySendState.utcDay = today;
    otpDailySendState.sent = 0;
    otpDailySendState.capTripAnnounced = false;
  }
  return otpDailySendState;
}

/**
 * A8-F5: deduped operator alert on the cap trip — same lazy-dynamic-import
 * pattern as fireAdvisoryLockAlert (the module-boundary mocks used by the
 * OTP service's test suites export no adminAlertsTable). logAdminAlert's
 * dedupeKey ("otp-daily-cap") collapses repeats within its 24 h window;
 * the call-site capTripAnnounced flag makes the firing itself once per
 * UTC day even before the DB dedupe engages.
 */
export function fireOtpDailyCapAlert(sent: number, cap: number): void {
  import("../jobs/alertLogger")
    .then(({ logAdminAlert }) =>
      logAdminAlert(
        "system",
        "بلوغ الحد اليومي لإرسال رموز واتساب",
        `تم إيقاف إرسال رموز التحقق عبر واتساب مؤقتاً: بلغ العدد اليومي المُرسل الحد الأقصى (${sent}/${cap}، بتوقيت UTC). الطلبات الجديدة تُرفض برمز 429 حتى بداية اليوم التالي بتوقيت UTC. إن كان هذا مفاجئاً فراجع سجل النشاط (auth_activity) بحثاً عن إساءة استخدام من عناوين IP متعددة.`,
        { dedupeKey: "otp-daily-cap" },
      ),
    )
    .catch((err) =>
      logger.warn(
        { err, dedupeKey: "otp-daily-cap" },
        "[whatsapp-otp] daily-cap admin alert dispatch failed",
      ),
    );
}
