/**
 * WhatsApp OTP — orchestration.
 *
 * Bridges the pure crypto lib (`lib/whatsapp-otp.ts`) and the OpenWA
 * gateway (`services/openwa.service.ts`) with the database + audit
 * + JWT layers.
 *
 * Phase 1 wires the `registration` purpose only. `login` and `2fa`
 * are reserved for future phases and are NOT mounted as routes today
 * — but the schema, lib, and orchestration layer all already accept
 * those purposes so future phases will be additive.
 */

import { db, referralEventsTable, usersTable, whatsappOtpsTable } from "@workspace/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { createHmac } from "crypto";

import { logAuthActivity } from "../lib/auth-activity";
import { generateReferralCode, normalizeLibyanPhone } from "../lib/crypto";
import { createUserSession } from "../lib/session";
import { logger } from "../lib/logger";
import {
  generateOtp,
  hashOtp,
  OTP_HOURLY_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_SEC,
  type OtpPurpose,
  verifyOtp as verifyOtpPure,
} from "../lib/whatsapp-otp";
import { buildChatId, sendWhatsAppMessage } from "./openwa.service";
import { fireThrottledMaintenance } from "../lib/opportunistic";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/** Exported for the pglite test seams (hashOtp calls must use the SAME derived key). */
export function getServerSecret(): string {
  // A8-07 (round-94): the OTP HMAC key used to BE SESSION_SECRET — key
  // reuse across purpose classes. A DB dump (codeHash rows) + a
  // SESSION_SECRET leak would let an attacker brute the 10^6 OTP space
  // offline for LIVE codes. A purpose-scoped derivation
  // HMAC(SESSION_SECRET, "whatsapp-otp-v1") gives a distinct key that
  // costs the attacker an extra HMAC oracle even with the session secret
  // in hand, and makes the OTP domain independent from the JWT domain.
  // (OTP_HMAC_KEY env override for future rotation; zero rows exist in
  // the live DB today — 2026-09-08 inspection — so no in-flight codes
  // are invalidated by the derivation change.)
  const explicit = (process.env.OTP_HMAC_KEY ?? "").trim();
  if (explicit.length >= 32) return explicit;
  const s = (process.env.SESSION_SECRET ?? "").trim();
  if (!s) {
    // Fail loud at runtime — production must have SESSION_SECRET.
    // This matches the rest of the auth surface (signUserToken would
    // already throw too).
    throw new Error("SESSION_SECRET is required for WhatsApp OTP");
  }
  return createHmac("sha256", s).update("whatsapp-otp-v1").digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// startOtp — generate + send
// ─────────────────────────────────────────────────────────────────────────────

export type StartOtpResult =
  | { ok: true; expiresAt: Date }
  | {
      ok: false;
      reason:
        | "invalid_phone"
        | "cooldown"
        | "hourly_limit"
        | "delivery_failed"
        | "recipient_not_on_whatsapp"
        | "whatsapp_not_paired"
        // 96-F1 (R96-A4 §1.3C): the session was just linked and is still
        // inside the settle / warm-up window — retry after retryAfterSec.
        | "whatsapp_settling"
        // R102 (cold-wake, R102-B F3): the gateway itself is booting after
        // a Render-Free idle sleep — the retry loop exhausted its ~30 s
        // budget against a service that needs 30-60 s+ to boot. The honest
        // verdict is "waking, retry later" (503 + Retry-After), not a hard
        // 502 — the frontend then rides the wake with its auto-retry.
        | "gateway_waking"
        // 96-F1 (R96-A4 §4.2): the WhatsApp message WAS delivered but the
        // OTP row could not be persisted (insert failed twice). The client
        // gets a short cooldown so it does not instantly re-send a SECOND
        // WhatsApp message ("which code is mine?") while the first is live.
        | "store_failed"
        | "gateway_disabled";
      retryAfterSec?: number;
    };

interface StartOtpInput {
  rawPhone: string;
  purpose: OtpPurpose;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Issue a WhatsApp OTP for the given phone.
 *
 * Rate limits (anti-abuse):
 *   - One send per OTP_RESEND_COOLDOWN_SEC seconds per phone
 *   - At most OTP_HOURLY_LIMIT sends per phone per rolling hour
 *
 * On gateway delivery failure the row is NOT created — that prevents
 * a downed gateway from accumulating dead rows that otherwise count
 * toward the hourly limit.
 *
 * A9-3 (R116): concurrent /start calls for the SAME phone are serialized
 * by a per-phone pg advisory lock (see withPhoneStartLock below) — the
 * loser gets the rate-limit style cooldown verdict instead of racing the
 * cooldown probe and double-sending two different codes.
 */
export async function startOtp(input: StartOtpInput): Promise<StartOtpResult> {
  // 2026-09-20 (free-infrastructure round): real OTP intent is the
  // on-demand trigger for the expired-row prune (was the hourly :15
  // cron slot). Throttled 60 min, fire-and-forget — the OTP request
  // never waits on the retention DELETE.
  fireThrottledMaintenance("whatsapp-otp-prune", 60 * 60 * 1000, pruneExpiredOtps);

  const phone = normalizeLibyanPhone(input.rawPhone);
  if (!phone) {
    await safeLog({
      identifier: `wa:${input.rawPhone.slice(0, 4)}…`,
      action: "register",
      success: false,
      failureReason: "invalid_phone",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "invalid_phone" };
  }

  return withPhoneStartLock(phone, input);
}

// ── A9-3 (R116): cross-process /start serialization per phone ──────────

/**
 * The pre-A9-3 TOCTOU: two concurrent /start calls for the same phone
 * (double-tap, two tabs, a racing client retry) both ran the cooldown
 * probe before either inserted its row — both passed, both sent, and the
 * user received TWO WhatsApp messages with two DIFFERENT codes ("which
 * one is mine?") while the second also burned an hourly-limit slot. The
 * cooldown check is read-then-act with the insert deliberately deferred
 * until after the send (a failed delivery must not leave a dead row), so
 * the only honest serializer is a lock spanning probe → send → insert.
 *
 * pg_try_advisory_lock(hashtext('otp-start:' || phone)) on a DEDICATED
 * pooled client: session-scoped advisory locks live on the connection
 * that took them, so acquire + release MUST share one client
 * (pool.connect() … release()). The key is namespaced so it can never
 * collide with the topup/alertLogger advisory locks (hashtextextended
 * keys) — different hash functions, but the prefix removes all doubt.
 *
 * R117 (A1-P2): the client comes from the DEDICATED lock pool
 * (`lockPool`, max 2) exported by @workspace/db — never from the
 * runtime pool. The critical section spans an external WhatsApp send
 * (~30 s worst case); holders taken from the runtime pool (max 8 in
 * production) could pin the entire app DB layer under a burst of
 * concurrent starts. Saturation of the lock pool (3rd+ concurrent
 * start) fails fast (2 s connectionTimeout) into the SAME busy verdict
 * as a lock loser — a retryable 429, never a runtime 500.
 *
 * Busy → the existing rate-limit style verdict (`cooldown` + a short
 * retryAfterSec; the route answers 429 + Retry-After) — by the time the
 * client retries, the winner's row backs the real cooldown probe.
 *
 * Pool loading is lazy + defensive: the pglite test harness and the
 * module-boundary mocks of @workspace/db export no `lockPool` — in
 * those contexts the gate is skipped (single-process tests serialize
 * via the event loop and mock the boundary). Production always has the
 * node-postgres lockPool (shared/db/src/index.ts exports it).
 */
const OTP_START_LOCK_RETRY_SEC = 15;

interface PoolClientLike {
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
  release: (destroy?: boolean) => void;
}

interface PoolLike {
  connect: () => Promise<PoolClientLike>;
}

// F-4 (R118-A1): bound on the finally-branch unlock query. The lock
// pool sets only an acquisition timeout (connectionTimeoutMillis) — no
// statement timeout — so a silently-dead connection used to leave the
// `SELECT pg_advisory_unlock` await hanging until TCP keepalives error
// out. Env-overridable for tests + ops (same pattern as
// HEALTH_AGGREGATE_TIMEOUT_MS in routes/health.ts).
const DEFAULT_UNLOCK_TIMEOUT_MS = 5_000;

function unlockTimeoutMs(): number {
  const raw = Number(process.env.OTP_UNLOCK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UNLOCK_TIMEOUT_MS;
}

/**
 * F-5 (R118-A1): lock-pool failure paths previously surfaced ONLY as
 * warn lines — a sustained pathology (pool saturation, unlock failures)
 * stayed invisible to the alerts drawer while every comparable
 * condition (inventory-corrupt, coupon-maxed, credentials-sweep)
 * alerts. Fire-and-forget by design: logAdminAlert never rejects (its
 * own catch swallows DB failures), so the .catch here only guards the
 * module load itself. Dynamic import — same lazy pattern the socket
 * emits use — keeps alertLogger (and its @workspace/db import) out of
 * this module's import graph: the module-boundary mocks used by the
 * test suite export no adminAlertsTable, and the lock path is the one
 * place this service runs under them.
 *
 * Deduped per branch ("otp:lockpool" / "otp:lockpool:saturation") so a
 * burst of failures collapses to one drawer row per 24 h window.
 */
function fireLockPoolAlert(dedupeKey: string, title: string, message: string): void {
  import("../jobs/alertLogger")
    .then(({ logAdminAlert }) => logAdminAlert("system", title, message, { dedupeKey }))
    .catch((err) =>
      logger.warn({ err, dedupeKey }, "[whatsapp-otp] lock-pool admin alert dispatch failed"),
    );
}

let cachedPool: PoolLike | null | undefined;

/** R117: test seam — inject a fake lock pool to exercise the lock path
 *  (the module-boundary mocks used by the suite export no lockPool, so
 *  the gate is otherwise bypassed and untested). */
export function __setOtpStartLockPoolForTests(p: PoolLike | null): void {
  cachedPool = p;
}

async function resolveDbPool(): Promise<PoolLike | null> {
  if (cachedPool !== undefined) return cachedPool;
  try {
    const mod = (await import("@workspace/db")) as { lockPool?: unknown };
    cachedPool =
      mod.lockPool && typeof (mod.lockPool as PoolLike).connect === "function"
        ? (mod.lockPool as PoolLike)
        : null;
  } catch {
    cachedPool = null;
  }
  return cachedPool;
}

async function withPhoneStartLock(phone: string, input: StartOtpInput): Promise<StartOtpResult> {
  const pool = await resolveDbPool();
  if (pool === null) {
    // No lock pool (test harness / module-boundary mocks) — no cross-process
    // gate. Single-process behavior is unchanged.
    return startOtpLocked(input, phone);
  }
  const lockKey = `otp-start:${phone}`;
  // R117 (A1-P2): lock-pool saturation (burst of concurrent starts, or the
  // DB briefly unreachable) fails fast into the SAME busy verdict as a lock
  // loser — retryable, honest ("try again in a moment"), and it never 500s
  // the auth path. A genuinely down DB still surfaces loudly through every
  // other query path + the neon health check.
  let client: PoolClientLike;
  try {
    client = await pool.connect();
  } catch (err) {
    logger.warn(
      {
        category: "whatsapp.otp",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-otp] start-lock pool saturated — answering busy (retryable)",
    );
    // F-5 (R118-A1): the warn line alone is invisible to the operator's
    // alert drawer — a sustained saturation (burst traffic or a sick
    // DB) deserves a deduped admin alert.
    fireLockPoolAlert(
      "otp:lockpool:saturation",
      "ضغط على مجموعة أقفال رموز واتساب",
      "فشل الحصول على اتصال من مجموعة الأقفال المخصّصة لبدء رمز التحقق (lockPool) — تم الرد على الطلب بحالة «مشغول» قابلة لإعادة المحاولة. قد يشير هذا إلى تشبّه المجموعة (حدّ اتصالَين) أو تعذّر الوصول إلى قاعدة البيانات.",
    );
    return { ok: false, reason: "cooldown", retryAfterSec: OTP_START_LOCK_RETRY_SEC };
  }
  let acquired = false;
  try {
    const res = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [
      lockKey,
    ]);
    acquired = Boolean(res.rows?.[0]?.acquired);
    if (!acquired) {
      // Same phone already has a start in flight — the rate-limit style
      // verdict. The loser never reaches the send path.
      await safeLog({
        identifier: `wa:${phone}`,
        action: "register",
        success: false,
        failureReason: "cooldown",
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      return { ok: false, reason: "cooldown", retryAfterSec: OTP_START_LOCK_RETRY_SEC };
    }
    return await startOtpLocked(input, phone);
  } finally {
    if (acquired) {
      let unlockOk = true;
      // F-4 (R118-A1): race the unlock against a bounded timer. Without
      // the race, a silently-dead connection hung this await until TCP
      // keepalives error out — the /start response was delayed AND one
      // of the two lock-pool slots stayed pinned the whole time (a
      // second such hang 429'd every OTP start with the busy verdict).
      // A timeout takes the SAME unlockOk=false path as a rejected
      // query: release(true) destroys the client, closing the session
      // so Postgres drops the advisory lock server-side. The losing
      // (still-pending) query promise stays race-observed, so its late
      // settlement can never surface as an unhandled rejection.
      let unlockTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]),
          new Promise<never>((_, reject) => {
            unlockTimer = setTimeout(() => {
              reject(
                new Error(`pg_advisory_unlock did not answer within ${unlockTimeoutMs()}ms`),
              );
            }, unlockTimeoutMs());
          }),
        ]);
      } catch (err) {
        unlockOk = false;
        logger.warn(
          {
            category: "whatsapp.otp",
            err: err instanceof Error ? err.message : String(err),
          },
          "[whatsapp-otp] start-lock advisory unlock failed — destroying the client so Postgres drops the session lock server-side",
        );
        // F-5 (R118-A1): surface the pathology in the admin alerts
        // drawer too — repeated unlock failures point at a sick
        // lock-pool/DB connection, not a one-off blip.
        fireLockPoolAlert(
          "otp:lockpool",
          "فشل تحرير قفل بدء رمز واتساب",
          "فشل أو تجاوز مهلة أمر تحرير القفل الاستشاري (pg_advisory_unlock) لبدء رمز التحقق — تم تدمير الاتصال لضمان إسقاط القفل من جهة Postgres. تكرار هذا التنبيه قد يدل على مشكلة في الاتصال بقاعدة البيانات.",
        );
      } finally {
        if (unlockTimer !== undefined) clearTimeout(unlockTimer);
      }
      // R117 (A1-P3): a session-scoped advisory lock dies with the SESSION.
      // A plain release() would return a still-locked live session to the
      // pool — that phone would then 429 "cooldown" on every future start
      // until process restart. On unlock failure release(true) destroys the
      // client (closing the session → server drops the lock) instead.
      client.release(!unlockOk);
    } else {
      client.release();
    }
  }
}

/** The pre-A9-3 startOtp body — always called with the phone-start gate
 *  held (or consciously bypassed in pool-less contexts). */
async function startOtpLocked(input: StartOtpInput, phone: string): Promise<StartOtpResult> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const cooldownStart = new Date(Date.now() - OTP_RESEND_COOLDOWN_SEC * 1000);

  // Hourly limit + cooldown probe in a single round-trip.
  const recent = await db
    .select({
      createdAt: whatsappOtpsTable.createdAt,
    })
    .from(whatsappOtpsTable)
    .where(and(eq(whatsappOtpsTable.phone, phone), gte(whatsappOtpsTable.createdAt, oneHourAgo)))
    .orderBy(desc(whatsappOtpsTable.createdAt));

  if (recent.length > 0 && recent[0].createdAt >= cooldownStart) {
    const retry = Math.max(
      1,
      Math.ceil(
        (recent[0].createdAt.getTime() + OTP_RESEND_COOLDOWN_SEC * 1000 - Date.now()) / 1000,
      ),
    );
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "cooldown",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "cooldown", retryAfterSec: retry };
  }

  if (recent.length >= OTP_HOURLY_LIMIT) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "hourly_limit",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "hourly_limit" };
  }

  // Generate + send BEFORE inserting, so a delivery failure doesn't
  // leave a dead row that throttles the user's next attempt.
  const code = generateOtp();
  const send = await sendWhatsAppMessage(
    buildChatId(phone),
    // Clean structure per the brief — code is isolated on its own
    // line by blank lines above and below, no markdown decoration:
    //
    //   SubNation — رمز التحقق
    //
    //   123456
    //
    //   صالح لمدة 5 دقائق.
    //   لا تشارك هذا الرمز مع أحد.
    //
    // The 6-digit numeric string is treated as a single "word" by
    // WhatsApp's text selection on Android & iOS, so triple-tap (or
    // long-press → already-correct selection) selects the entire
    // code in one gesture. A real native "copy code" button is only
    // available on the official Business Cloud API authentication
    // template, which is out of scope for whatsapp-web.js / OpenWA.
    `SubNation — رمز التحقق\n\n${code}\n\nصالح لمدة 5 دقائق.\nلا تشارك هذا الرمز مع أحد.`,
  );
  if (!send.ok) {
    // `not_configured` (env missing) / `session_not_found` are
    // "service is not available" → 503. `session_not_ready` is its own
    // HONEST state (r95): the gateway is configured but the WhatsApp
    // session has not been paired (or dropped mid-flight) — the user
    // sees "قناة واتساب غير مربوطة حاليًا" instead of a misleading
    // generic "gateway disabled". Genuine wire failures (timeouts,
    // non-2xx from a ready session) remain `delivery_failed`.
    // `recipient_not_on_whatsapp` is a client-fixable condition (wrong
    // number) — surface it as its own reason so the UI can show a
    // targeted Arabic message rather than a generic "delivery failed".
    //
    // 96-F1 (R96-A4 §1.3C): `session_settling` is the settle-gate
    // verdict — the channel was paired moments ago and WhatsApp's
    // multi-device key distribution has not propagated yet (the
    // "Waiting for this message" race). It maps to its own honest
    // reason + retryAfterSec so the route can answer 503 + Retry-After
    // and the client can auto-retry instead of burning a resend.
    const isGatewayDisabled =
      send.reason === "not_configured" || send.reason === "session_not_found";
    // B5-2 (R111): `initializing`/`created` are the gateway BOOTING the
    // session — the 3-25 s cold-boot window (session registered
    // initializing ~3 s in, ready at 10-25 s), not a pairing problem.
    // Mapping them onto the R102 gateway_waking semantics (503 +
    // Retry-After 30 + the frontend auto-retry) turns a routine gateway
    // boot from a scary manual re-tap («قناة WhatsApp غير مربوطة») into a
    // ridden-out wake. disconnected/failed/qr_ready stay honest
    // whatsapp_not_paired — and so does authenticating (an operator scan
    // is genuinely pending, same class as qr_ready).
    const isGatewayBooting =
      send.reason === "session_not_ready" &&
      (send.sessionStatus === "initializing" || send.sessionStatus === "created");
    const isNotPaired = send.reason === "session_not_ready" && !isGatewayBooting;
    const isSettling = send.reason === "session_settling";
    const isRecipientMissing = send.reason === "recipient_not_on_whatsapp";
    // R102 (cold-wake): the RETRYABLE wire-failure shape — network
    // error/timeout (request_failed) or a 5xx from the gateway. The
    // retry loop (3 attempts, ~30 s) already burned through, and on the
    // free tier that exhaustion almost always means the gateway is
    // mid-boot after an idle sleep — a definitive-looking 502 forced the
    // user to manually re-tap (which then succeeded once awake). 4xx
    // rejections stay `delivery_failed` — those are NOT a wake shape.
    // B5-4 (R111): a 409 mid-send flap joins the retryable shape — the
    // gateway's session_not_ready-at-send-time answer when the session
    // flips off ready between our check and the dispatch; the transport
    // already retried it 3×, and the honest verdict is "waking, retry
    // later", not a generic 502. B5-2's booting states ride the same
    // verdict.
    const isGatewayWaking =
      send.reason === "request_failed" ||
      (send.reason === "non_ok_status" && ((send.status ?? 0) >= 500 || send.status === 409)) ||
      isGatewayBooting;
    const failureReason = isGatewayDisabled
      ? "gateway_disabled"
      : isNotPaired
        ? "whatsapp_not_paired"
        : isSettling
          ? "whatsapp_settling"
          : isGatewayWaking
            ? "gateway_waking"
            : isRecipientMissing
              ? "recipient_not_on_whatsapp"
              : "delivery_failed";
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return {
      ok: false,
      reason: failureReason,
      ...(isSettling && send.readyInMs !== undefined
        ? { retryAfterSec: Math.max(1, Math.ceil(send.readyInMs / 1000)) }
        : isGatewayWaking
          ? { retryAfterSec: 30 }
          : {}),
    };
  }

  const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
  const insertValues = {
    phone,
    codeHash: hashOtp(code, phone, input.purpose, getServerSecret()),
    purpose: input.purpose,
    expiresAt,
    ipAddress: input.ipAddress,
  };

  // 96-F1 (R96-A4 §4.2): the message is ALREADY on the user's phone at
  // this point — a DB blip on the insert must not 500 with no cooldown
  // (the old shape let the client instantly re-request → a SECOND
  // WhatsApp message while the first code is still valid and readable).
  // Retry the insert once; on final failure return `store_failed` with
  // retry_after_sec: 30 so the route answers 500 + Retry-After and the
  // client applies a short cooldown instead of re-sending.
  let stored = false;
  for (let attempt = 1; attempt <= 2 && !stored; attempt++) {
    try {
      await db.insert(whatsappOtpsTable).values(insertValues);
      stored = true;
    } catch (err) {
      logger.warn(
        {
          category: "whatsapp.otp",
          attempt,
          err: err instanceof Error ? err.message : String(err),
        },
        attempt === 1
          ? "[whatsapp-otp] OTP row insert failed — retrying once"
          : "[whatsapp-otp] OTP row insert failed after retry",
      );
    }
  }
  if (!stored) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "store_failed",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "store_failed", retryAfterSec: 30 };
  }

  await safeLog({
    identifier: `wa:${phone}`,
    action: "register",
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { ok: true, expiresAt };
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyOtp — verify + finds-or-creates user + JWT
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyOtpResult =
  | {
      ok: true;
      token: string;
      isNewUser: boolean;
      user: typeof usersTable.$inferSelect;
    }
  | {
      ok: false;
      reason:
        | "invalid_phone"
        | "no_active_code"
        | "consumed"
        | "expired"
        | "exhausted"
        | "mismatch";
    };

interface VerifyOtpInput {
  rawPhone: string;
  code: string;
  purpose: OtpPurpose;
  ipAddress?: string;
  userAgent?: string;
  /** Optional — propagated to new-user creation when set. */
  referralCode?: string;
}

/**
 * Verify a submitted OTP. On success, finds-or-creates the user and
 * returns a signed JWT.
 *
 * Failed attempts increment the row's `attempts` counter; once the
 * cap is hit, `consumedAt` is set so the same code can never be
 * brute-forced piecewise. Successful verifies also set `consumedAt`,
 * preventing replay even by the legitimate user.
 */
export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const phone = normalizeLibyanPhone(input.rawPhone);
  if (!phone) return { ok: false, reason: "invalid_phone" };

  // Latest unconsumed OTP for this (phone, purpose).
  const [row] = await db
    .select()
    .from(whatsappOtpsTable)
    .where(
      and(
        eq(whatsappOtpsTable.phone, phone),
        eq(whatsappOtpsTable.purpose, input.purpose),
        isNull(whatsappOtpsTable.consumedAt),
      ),
    )
    .orderBy(desc(whatsappOtpsTable.createdAt))
    .limit(1);

  if (!row) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "no_active_code",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "no_active_code" };
  }

  const verdict = verifyOtpPure(
    input.code,
    { ...row, purpose: row.purpose as OtpPurpose },
    getServerSecret(),
  );
  if (!verdict.ok) {
    // Increment attempts on a real mismatch; if we hit the cap, hard-consume
    // the row so it cannot be brute-forced further. Atomic SQL increment —
    // the previous JS read-modify-write let N concurrent guesses all read
    // the same count and blow past the cap.
    if (verdict.reason === "mismatch") {
      const [bumped] = await db
        .update(whatsappOtpsTable)
        .set({ attempts: sql`${whatsappOtpsTable.attempts} + 1` })
        .where(eq(whatsappOtpsTable.id, row.id))
        .returning({ attempts: whatsappOtpsTable.attempts });
      const newAttempts = bumped?.attempts ?? (row.attempts ?? 0) + 1;
      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        await db
          .update(whatsappOtpsTable)
          .set({ consumedAt: new Date() })
          .where(and(eq(whatsappOtpsTable.id, row.id), isNull(whatsappOtpsTable.consumedAt)));
      }
    }
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: verdict.reason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: verdict.reason };
  }

  // Successful verify — consume the row (replay protection) then
  // finds-or-creates the user.
  //
  // F6 (round-94 A4): the consume is now a guarded compare-and-set. The
  // old unconditional UPDATE matched the row even when a concurrent
  // double-submit had already consumed it: both requests passed the
  // SELECT (row still unconsumed), both passed HMAC, both "succeeded",
  // and for a NEW phone both entered find-or-create → the second INSERT
  // tripped users.phone UNIQUE as an unclassified 23505 → raw 500 for a
  // registration that actually succeeded. With the isNull(consumedAt)
  // predicate, the race loser's UPDATE matches 0 rows and returns the
  // same stable, already-mapped "consumed" verdict the sequential
  // replay gets (route: 401 «تم استخدام هذا الرمز بالفعل» — the
  // OTP-already-used stable code path) instead of a 500.
  const consumed = await db
    .update(whatsappOtpsTable)
    .set({ consumedAt: new Date() })
    .where(and(eq(whatsappOtpsTable.id, row.id), isNull(whatsappOtpsTable.consumedAt)))
    .returning({ id: whatsappOtpsTable.id });
  if (consumed.length !== 1) {
    await safeLog({
      identifier: `wa:${phone}`,
      action: "register",
      success: false,
      failureReason: "consumed",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, reason: "consumed" };
  }

  const { user, isNewUser } = await findOrCreateWhatsAppUser(
    phone,
    input.purpose,
    input.referralCode,
  );
  const { token } = await createUserSession({
    userId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await safeLog({
    userId: user.id,
    identifier: `wa:${phone}`,
    action: isNewUser ? "register" : "login",
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { ok: true, token, isNewUser, user };
}

// ─────────────────────────────────────────────────────────────────────────────
// findOrCreateWhatsAppUser
// ─────────────────────────────────────────────────────────────────────────────

async function findOrCreateWhatsAppUser(
  phone: string,
  _purpose: OtpPurpose,
  referralCode: string | undefined,
): Promise<{ user: typeof usersTable.$inferSelect; isNewUser: boolean }> {
  const now = new Date();

  // Existing user with this phone — login path.
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, phone)).limit(1);

  if (existing) {
    // Lift phoneVerified=true if it wasn't already (e.g. user previously
    // signed in via Google with the same phone but never verified it).
    if (!existing.phoneVerified) {
      await db
        .update(usersTable)
        .set({ phoneVerified: true, lastAuthAt: now })
        .where(eq(usersTable.id, existing.id));
      return { user: { ...existing, phoneVerified: true, lastAuthAt: now }, isNewUser: false };
    }
    await db.update(usersTable).set({ lastAuthAt: now }).where(eq(usersTable.id, existing.id));
    return { user: existing, isNewUser: false };
  }

  // Apply referral code if it resolves.
  let referredById: number | undefined;
  if (referralCode) {
    const [referrer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, referralCode))
      .limit(1);
    if (referrer) referredById = referrer.id;
  }

  const [created] = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(usersTable)
      .values({
        phone,
        phoneVerified: true,
        authProvider: "whatsapp_phone",
        referralCode: generateReferralCode(),
        referredBy: referredById,
        // R115 (welcome-bonus policy B): NO instant credit at signup — the
        // referred user's welcome bonus lands on their FIRST APPROVED
        // TOPUP (topup.service.ts, guarded by users.welcome_bonus_granted).
        // Uniform across Google / WhatsApp / Telegram.
        walletBalance: "0.00",
        lastAuthAt: now,
      })
      .returning();

    // F2 (round-94 A4): the referral EVENT row, in the same tx as the
    // user it refers. Telegram (auth-settings.ts) and Firebase
    // (firebase-auth.service.ts) both insert { referrer, referee,
    // status: 'pending' } at signup; this WhatsApp path was the only
    // channel that skipped it — user.referredBy was set and the 5 LYD
    // welcome bonus + ledger landed, but TopupService.approve (the
    // sole consumer) requires the event row to award the referrer's
    // +50 points on the first topup, so the promise silently never
    // paid on this channel (/admin/referrals showed pending: 0).
    // Same value shape + onConflictDoNothing as the sibling channels;
    // in-tx (stronger than they are) so the event can never exist
    // without the user row it belongs to.
    if (referredById && referredById !== u.id) {
      await tx
        .insert(referralEventsTable)
        .values({ referrerId: referredById, refereeId: u.id, status: "pending" })
        .onConflictDoNothing();
    }

    return [u];
  });

  return { user: created, isNewUser: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function safeLog(params: {
  userId?: number;
  identifier: string;
  action: "register" | "login";
  success: boolean;
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await logAuthActivity({ ...params, provider: "whatsapp" });
  } catch (err) {
    logger.warn(
      {
        category: "whatsapp.otp",
        err: err instanceof Error ? err.message : String(err),
      },
      "[whatsapp-otp] auth-activity log failed (non-fatal)",
    );
  }
}

/**
 * Best-effort pruning helper. TRIGGERS (2026-09-20 free-infrastructure
 * round): the leader boot one-shot (jobs/boot-one-shots.ts) + a throttled
 * 60-min opportunistic fire at the top of startOtp() (was the hourly
 * :15 cron slot) — deletes rows older than 24 h, well past the
 * 5-minute TTL and any verify window, so no active session is at risk.
 * Idempotent. Returns the number of rows deleted.
 */

// R110-H: ctid-batch ceiling per DELETE statement — same 1000-row shape
// as every other retention job (B7-P2-5 family). The 24 h window bounds
// the steady-state table, but a boot one-shot catch-up after an extended
// outage must not hold one unbounded statement lock on the shared pooler.
const OTP_PRUNE_BATCH_SIZE = 1000;

export async function pruneExpiredOtps(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let deleted = 0;
  // Bounded batch loop (notifications-retention.ts shape): `ctid IN
  // (SELECT … LIMIT n)` until a batch comes back short, so each
  // statement's lock footprint stays tiny. Predicate embedded verbatim
  // per batch — idempotent.
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM whatsapp_otps
      WHERE ctid IN (
        SELECT ctid FROM whatsapp_otps
        WHERE created_at < ${cutoff}
        LIMIT ${OTP_PRUNE_BATCH_SIZE}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < OTP_PRUNE_BATCH_SIZE) break;
  }
  return deleted;
}
