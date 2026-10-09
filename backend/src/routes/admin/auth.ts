import { AdminLoginBody } from "@workspace/api-zod";
import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type CookieOptions } from "express";
import jwt from "jsonwebtoken";
import { generateSecret, generateURI, verifySync } from "otplib";
import { writeAuditLog } from "../../lib/audit";
import { encrypt, safeDecrypt } from "../../lib/encryption";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../../lib/crypto";
import { ADMIN_JWT_SECRET, signAdminToken } from "../../lib/jwt";
import {
  createAdminSession,
  isValidAdminSession,
  revokeAdminSession,
  revokeAllAdminSessions,
} from "../../lib/admin-session";
import {
  checkLockout,
  recordFailedAttempt,
  resetAttempts,
  type LockoutPolicy,
} from "../../lib/lockout";
import { logger } from "../../lib/logger";
import { requireAdmin, type AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { getAuthCookieOptions } from "../../lib/cookie-options";

const router = Router();

/**
 * Admin session cookie shape — same security profile as the user
 * `auth_token` cookie (httpOnly, secure-in-prod, SameSite=Lax) but a
 * tighter 7-day lifetime reflecting admin privilege.
 *
 * Setting this cookie on /login and /login/verify-2fa is what makes
 * admin sessions survive a page refresh: the browser sends the cookie
 * automatically on every request, so the SPA's `requireAdmin`
 * middleware succeeds without the frontend having to reattach an
 * Authorization header from React state (which is wiped on refresh).
 */
const ADMIN_COOKIE_NAME = "admin_token";
const ADMIN_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  ...getAuthCookieOptions(8 * 60 * 60 * 1000),
};

/**
 * R110-01 (round-110, R109 109-g §8 P2): GLOBAL per-username password
 * lockout policy for POST /login.
 *
 * Why: the lockout keys on the password step were `admin:${username}:${ip}`
 * (below) and authLimiter's per-IP budget — a distributed attacker
 * rotating source IPs minted a fresh 5-attempt envelope per request, so
 * the aggregate guessing budget against ONE admin's password was
 * unbounded. Only argon2id cost + the per-admin 2FA lockout stood behind
 * it. This policy is applied through the SAME DB-backed mechanism
 * (lib/lockout.ts) on an IP-INDEPENDENT key (`admin-username:${username}`),
 * so IP rotation no longer refreshes the envelope.
 *
 * Chosen numbers (mirroring the 2FA precedent at admin/auth.ts's
 * `admin-2fa:${admin.id}` lockout — same base 15-min lock, same doubling
 * backoff shape, only the threshold is raised):
 *   - threshold 10 failures — double the per-(username,ip)/2FA envelope's
 *     5. The 2FA verify path ALREADY accepts a per-admin global lockout
 *     (an attacker who knows a real adminId can lock that admin's 2FA
 *     with 5 anonymous failures), so a per-username password ceiling is
 *     the same accepted trade-off for the same asset — but with 2× the
 *     headroom + only a 15-min base lock, a spoofed-username lockout is
 *     a nuisance (admin retries after 15 min), not a denial of service.
 *   - base lock 15 min, doubling per full extra envelope (15/30/60/…)
 *     via lib/lockout.ts's shared exponential formula.
 *
 * Availability trade-off (accepted, documented): keying on the SUBMITTED
 * username means an attacker who knows a real username CAN lock that
 * admin out of the password step for 15 min with 10 failures. Mitigations:
 * the threshold is high (10), the lock is short (15 min base), each
 * spoofed failure costs the attacker a full argon2 round-trip server-side
 * (the !valid branch below only records after a real row + real argon2
 * verify — no cheap DB-row-free lockout spam), and the 2FA lockout
 * already accepted the identical trade-off. A8-03 rejected per-username
 * keying when the threshold was 5 and the lock repeatable forever; 10 +
 * 15-min decay keeps the DoS leverage negligible while capping
 * distributed brute force.
 */
const USERNAME_LOCKOUT_POLICY: LockoutPolicy = {
  maxAttempts: 10,
  baseLockoutMinutes: 15,
};

// R126-L4 (A7-F3, P3): no-store parity with the 98-F3 / R123-E5 pattern —
// this was the last admin-family router WITHOUT a router-level header, so
// its auth rejection paths answered with NO Cache-Control: the inline
// 401s (login failures, verify-2fa, change-password current-password
// mismatch) AND the requireAdmin rejections on /session /logout
// /change-password /profile /2fa/* (live-verified: GET /api/admin/session
// 401 shipped bare). An intermediary must never cache an auth envelope —
// a stored "session expired"/"wrong password" body could be replayed for
// a request that now carries valid credentials. /probe and /session set
// their own (more specific) values in-handler and override this one.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post("/login", async (req, res) => {
  const parse = AdminLoginBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  const { username, password } = parse.data;

  // B2-F1 (R111, round-111 B2 audit): the generated AdminLoginBody schema
  // is unbounded, and the lockout keys below embed the SUBMITTED username —
  // `admin:${username}:${ip}` overflowed login_attempts.identifier
  // varchar(100) → 22001 → 500 + a Sentry event per failed attempt.
  // The durable fix is the clamp inside lib/lockout.ts (every entry point);
  // this is the outer perimeter. It is deliberately 255 — NOT the 100-char
  // admin column — because a junk username MUST still land on the uniform
  // 401 not-found branch (dummy-argon2 + lockout accounting) to preserve
  // 98-F3/R110-01 parity: no real admin username can exceed varchar(100),
  // so 101..255-char names are honestly "unknown username" and answering
  // them with a distinct 400 would be a new shape split for zero security
  // gain. 255 keeps multi-KB junk (log/audit pollution) out while the
  // acceptance test (200-char username → uniform 401) stays green.
  if (username.length > 255) {
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  }

  // A8-03 (round-94): the lockout key used to be `admin:${username}`
  // ALONE — anyone who knows the (single, public-ish) username could
  // lock the admin out of the money queue remotely with 5 anonymous
  // failures, repeatable forever, while the IP rate-limit budget
  // barely noticed. Keying on IP + username keeps per-IP brute force
  // inside the same 5-attempt envelope while making remote lockout
  // of the legitimate admin (different IP) structurally impossible.
  //
  // R97-01 (round-97 F2): this key used to read the CF-Connecting-IP
  // header RAW — bypassing the H11 validation in cloudflareClientIp,
  // which honours that header ONLY when the rightmost XFF peer is a
  // Cloudflare edge and then rewrites req.ip. A direct connection to
  // the always-reachable subnation2.onrender.com origin could forge a
  // fresh CF-Connecting-IP per request, minting a NEW lockout key
  // every time — the 5-attempts/15-min lockout never engaged, and
  // distributed brute force had no ceiling (only authLimiter's
  // IP-rotation-beatable 10/15min). req.ip is the CF-validated value
  // (cloudflareClientIp is composed in app.ts BEFORE all routes) and
  // is exactly what express-rate-limit already keys on.
  const clientIp = req.ip || "unknown";
  const lockoutKey = `admin:${username}:${clientIp}`;
  // R110-01: IP-independent companion key — see USERNAME_LOCKOUT_POLICY
  // above. Checked before the user lookup so a locked username never
  // reaches the DB row or the real password hash (the dummy-argon2 on
  // the locked branch below preserves the timing shape).
  const usernameLockoutKey = `admin-username:${username}`;
  const { locked, lockedUntil } = await checkLockout(lockoutKey);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    // Round-3 envelope drift fix: 429 without `code`.
    return res
      .status(429)
      .json(
        createErrorResponse(
          `الحساب مقفل بسبب محاولات فاشلة. حاول بعد ${mins} دقيقة.`,
          ErrorCode.ACCOUNT_LOCKED,
        ),
      );
  }

  // R110-01: global per-username ceiling (distributed / IP-rotating
  // brute force). MUST look identical to invalid credentials — a 429
  // here would hand a distributed prober a free username-existence
  // oracle ("locked" ⇒ real, heavily-attacked username; 401 ⇒ unknown).
  // So: same generic 401 body as every other failure branch, preceded by
  // the SAME single dummy-argon2 verify (98-F3 parity) — the skipped DB
  // select (~1 ms) is noise under argon2's ~100 ms, keeping the locked,
  // unknown-username and wrong-password paths timing-indistinguishable.
  // Checked after the per-(username,ip) envelope so the pre-existing 429
  // contract for an engaged per-IP lock is unchanged.
  const usernameLockout = await checkLockout(usernameLockoutKey);
  if (usernameLockout.locked) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return res
      .status(401)
      .json(createErrorResponse("اسم المستخدم أو كلمة المرور غير صحيحة", ErrorCode.UNAUTHORIZED));
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.username, username))
    .limit(1);
  if (!admin) {
    // 98-F3 (R98-A4 P3): username-existence timing oracle. The found
    // branch pays ~100 ms of argon2 (64 MiB) before its 401; this branch
    // used to return immediately — a remote attacker measuring wall-clock
    // distinguished valid admin usernames from invalid ones even though
    // the response envelopes are identical. Run the SAME argon2 verify
    // against DUMMY_PASSWORD_HASH (pre-computed constant of a random
    // string's hash, same params → same cost) before replying, so both
    // branches converge. The result is intentionally discarded.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    await recordFailedAttempt(lockoutKey);
    return res
      .status(401)
      .json(createErrorResponse("اسم المستخدم أو كلمة المرور غير صحيحة", ErrorCode.UNAUTHORIZED));
  }
  if (!admin.isActive) {
    // Soft-disabled admin — same 401 response as a wrong password so
    // we don't leak account-state to a brute-forcer. Same dummy-argon2
    // timing parity as the not-found branch above.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    await recordFailedAttempt(lockoutKey);
    return res
      .status(401)
      .json(createErrorResponse("اسم المستخدم أو كلمة المرور غير صحيحة", ErrorCode.UNAUTHORIZED));
  }
  const { valid, needsRehash, resetRequired } = await verifyPassword(password, admin.passwordHash);
  if (resetRequired) {
    // 98-F3: non-argon2 stored hash — the legacy SHA-256 fallback was
    // removed (verified: zero such rows live), so this row can only be
    // recovered by a password reset, never by retrying credentials.
    // Loud security log: a row appearing here means a pre-argon2 row
    // surfaced after all (or DB tampering) and deserves attention.
    logger.error(
      { category: "security", adminId: admin.id, username: admin.username },
      "Non-argon2 password hash encountered on admin login — legacy SHA-256 fallback removed (98-F3); password reset required",
    );
    // R102 (parity hardening, R102-B F2): this branch used to answer
    // IMMEDIATELY (verifyPassword short-circuits before any argon2 work
    // for non-argon2 hashes) with a DISTINCT body and no lockout
    // accounting — a timing + shape oracle that diverged from both the
    // not-found and wrong-password branches (the exact gap 98-F3 closed
    // for the others). Run the SAME dummy argon2, record the SAME
    // failed attempt, and return the SAME generic 401; the loud error
    // log above is the out-of-band reset signal. Zero such rows exist
    // live — this is defense-in-depth, not a live fix.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    await recordFailedAttempt(lockoutKey);
    return res
      .status(401)
      .json(createErrorResponse("اسم المستخدم أو كلمة المرور غير صحيحة", ErrorCode.UNAUTHORIZED));
  }
  if (!valid) {
    await recordFailedAttempt(lockoutKey);
    // R110-01: accrue to the GLOBAL per-username envelope too. Only THIS
    // branch records it — the username row exists, is active, argon2-
    // verified, and the password was wrong. Unknown usernames (not-found
    // branch above) are NOT recorded: they can't be brute-forced into an
    // account, and recording them would let anonymous traffic mint
    // unbounded lockout rows for arbitrary strings. Inactive/
    // reset-required rows are skipped for the same no-value reason (they
    // can never validate a password), keeping the spoofable lockout
    // surface limited to real, active, argon2-backed accounts.
    await recordFailedAttempt(usernameLockoutKey, USERNAME_LOCKOUT_POLICY);
    return res
      .status(401)
      .json(createErrorResponse("اسم المستخدم أو كلمة المرور غير صحيحة", ErrorCode.UNAUTHORIZED));
  }
  if (needsRehash) {
    await db
      .update(adminUsersTable)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(adminUsersTable.id, admin.id));
  }
  await resetAttempts(lockoutKey);
  // R110-01: a correct password clears the global per-username envelope
  // as well (only a valid password can reach here — an attacker cannot
  // self-heal the counter they are filling).
  await resetAttempts(usernameLockoutKey);

  if (admin.totpEnabled && admin.totpSecret) {
    // A8-05 (round-94): the 2FA challenge token lived as long as a full
    // session (8h). The window where a half-session token is floating
    // around is now 10 minutes — plenty for a human to open the
    // authenticator, worthless for offline brute force (the per-admin
    // lockout below is the real gate; this just shrinks the target).
    const tempToken = signAdminToken(
      { adminId: admin.id, role: admin.role, isTemp: true },
      { expiresIn: "10m" },
    );
    return res.json({ requires_2fa: true, temp_token: tempToken });
  }

  // A8-01 (round-94): durable, revocable session row + sid-bound token.
  // R97-01: clientIp above is the CF-validated req.ip — the session
  // row's forensically-relevant ipAddress can no longer be polluted
  // with attacker-chosen raw-header values.
  const { token } = await createAdminSession({
    adminId: admin.id,
    role: admin.role,
    userAgent: req.headers["user-agent"],
    ipAddress: clientIp,
  });
  res.cookie(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
  // R97-02 (round-97 F2): the raw admin JWT is no longer returned in
  // the response body — the httpOnly cookie above is the sole session
  // transport (requireAdmin reads the cookie first; the row-backed sid
  // keeps it revocable). Keeping the token in JSON kept a full-session
  // credential readable from JS memory (XSS / malicious extension /
  // DevTools-on-a-shared-machine surface).
  return res.json({
    display_name: admin.displayName,
    role: admin.role,
    permissions: admin.permissions ?? [],
  });
});

router.post("/login/verify-2fa", async (req, res) => {
  const { temp_token, code } = req.body ?? {};
  if (!temp_token || !code)
    return res.status(400).json(createErrorResponse("بيانات غير مكتملة", ErrorCode.INVALID_DATA));

  try {
    const decoded = jwt.verify(temp_token, ADMIN_JWT_SECRET, { algorithms: ["HS256"] }) as {
      adminId?: number;
      isTemp?: boolean;
    };

    if (!decoded.isTemp || !decoded.adminId) {
      return res.status(401).json(createErrorResponse("جلسة غير صالحة", ErrorCode.UNAUTHORIZED));
    }

    // A8-04 (round-94): the 2FA completion path never re-checked
    // is_active — a soft-disabled admin could still finish the TOTP
    // challenge and mint a full session (requireAdmin would later
    // refuse it, but the mint itself was audit noise + a misleading
    // "success" response). Check it here, same honest 401 envelope.
    const [admin] = await db
      .select()
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, decoded.adminId))
      .limit(1);

    if (!admin || !admin.isActive) {
      return res
        .status(401)
        .json(createErrorResponse("بيانات الاعتماد غير صالحة", ErrorCode.UNAUTHORIZED));
    }

    if (!admin.totpEnabled || !admin.totpSecret) {
      return res
        .status(401)
        .json(createErrorResponse("بيانات الاعتماد غير صالحة", ErrorCode.UNAUTHORIZED));
    }

    // H10 (deep-audit 2026-09-06): TOTP codes are only 6 digits — without
    // a per-admin attempt lockout this endpoint was a cheap online
    // brute-force (and login-side IP limits don't help: the temp token
    // pins the TARGET, the request source is arbitrary). Same lib +
    // exponential backoff as the password login above.
    const lockoutKey = `admin-2fa:${admin.id}`;
    const { locked, lockedUntil } = await checkLockout(lockoutKey);
    if (locked) {
      const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
      // Round-3 envelope drift fix: 429 without `code`.
      return res
        .status(429)
        .json(
          createErrorResponse(
            `الحساب مقفل بسبب محاولات فاشلة. حاول بعد ${mins} دقيقة.`,
            ErrorCode.ACCOUNT_LOCKED,
          ),
        );
    }

    // R118-B1c (A4 F-4): totp_secret is ENCRYPTED at rest — decrypt for
    // verification. Legacy plaintext secrets (pre-encryption enrollments
    // or hand-seeded rows) pass through safeDecrypt unchanged, so the
    // verify contract is identical for both storage shapes.
    const totpSecret = safeDecrypt(admin.totpSecret);
    if (!totpSecret) {
      // An encrypted secret that no longer decrypts (key rotation that
      // forgot this row / corruption) — safeDecrypt already logged the
      // redacted warn. Uniform 401, never a 500; the per-admin lockout
      // above is NOT incremented (the failure is not the admin's guess).
      return res
        .status(401)
        .json(createErrorResponse("رمز التحقق غير صحيح", ErrorCode.UNAUTHORIZED));
    }

    // R118-B1c (bonus fix, found by the new unmocked-otplib tests):
    // otplib v13's verifySync returns a RESULT OBJECT
    // ({ valid: boolean, delta, … }), not a boolean. The previous
    // `if (!isValid)` truthiness check therefore ALWAYS passed — any
    // format-valid 6-digit code completed the TOTP challenge (a live
    // 2FA bypass; the lockout suite's verifySync mock returned `true`,
    // so no test ever exercised the false verdict). Check `.valid`.
    const verdict = verifySync({ token: code, secret: totpSecret });
    if (!verdict.valid) {
      await recordFailedAttempt(lockoutKey);
      return res
        .status(401)
        .json(createErrorResponse("رمز التحقق غير صحيح", ErrorCode.UNAUTHORIZED));
    }
    await resetAttempts(lockoutKey);

    // A8-01: full session after TOTP — row-backed and revocable, same
    // as the non-2FA login path.
    const { token } = await createAdminSession({
      adminId: admin.id,
      role: admin.role,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    res.cookie(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
    // R97-02 (round-97 F2): no `token` in the body here either — the
    // httpOnly cookie above is the only session transport. (The
    // 10-minute `temp_token` returned by /login is a challenge
    // credential, not a session, and stays.)
    return res.json({
      display_name: admin.displayName,
      role: admin.role,
      permissions: admin.permissions ?? [],
    });
  } catch {
    return res
      .status(401)
      .json(createErrorResponse("جلسة غير صالحة أو منتهية الصلاحية", ErrorCode.UNAUTHORIZED));
  }
});

/**
 * GET /api/admin/probe — 200-always cookie-presence probe.
 *
 * Mirrors the public /api/auth/probe pattern: lets the SPA detect
 * whether the httpOnly admin_token cookie carries a live session
 * without producing a console-visible 401 on the unauthenticated
 * path. Used by the frontend AuthProvider on cold boot to hydrate
 * the admin session across page refreshes.
 *
 *  - cookie present + valid → 200 + { authenticated: true, admin: {…} }
 *  - cookie missing/invalid → 200 + { authenticated: false }
 */
router.get("/probe", async (req, res) => {
  res.set("Cache-Control", "private, max-age=0, no-store");

  const token =
    req.cookies?.[ADMIN_COOKIE_NAME] || req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(200).json({ authenticated: false });
  }

  let decoded: { adminId?: number; isTemp?: boolean; sid?: string };
  try {
    decoded = jwt.verify(token, ADMIN_JWT_SECRET, { algorithms: ["HS256"] }) as {
      adminId?: number;
      isTemp?: boolean;
      sid?: string;
    };
  } catch {
    return res.status(200).json({ authenticated: false });
  }
  if (!decoded.adminId) {
    return res.status(200).json({ authenticated: false });
  }
  // A 2FA temp token is not a session (V1-CRITICAL red-team finding) —
  // the SPA must keep the admin on the 2FA challenge screen, not render
  // a half-authenticated admin shell.
  if (decoded.isTemp === true) {
    return res.status(200).json({ authenticated: false, requires_2fa: true });
  }

  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
      totpEnabled: adminUsersTable.totpEnabled,
      permissions: adminUsersTable.permissions,
      isActive: adminUsersTable.isActive,
    })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, decoded.adminId))
    .limit(1);

  if (!admin || !admin.isActive) {
    // Treat soft-disabled admins like missing — SPA navigates them to
    // the login screen instead of rendering a half-broken admin shell.
    return res.status(200).json({ authenticated: false });
  }

  // A8-01: the row is the revocation truth — a logout/password-change
  // on another device must reflect here so the SPA's cold-boot hydrate
  // lands on the login screen instead of a dead session.
  if (typeof decoded.sid === "string" && decoded.sid.length > 0) {
    const sessionValid = await isValidAdminSession(decoded.sid, admin.id);
    if (!sessionValid) {
      return res.status(200).json({ authenticated: false });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Same fail-closed strictness as requireAdmin: pre-migration
    // sid-less tokens are not sessions anymore.
    return res.status(200).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    admin: {
      id: admin.id,
      username: admin.username,
      display_name: admin.displayName,
      role: admin.role,
      totp_enabled: admin.totpEnabled,
      permissions: admin.permissions ?? [],
    },
  });
});

router.get("/session", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  // R123-E5 (A6 P3): no-store parity with the R122 sessions/providers
  // pattern — the session echo carries the admin's identity + permission
  // list; an intermediary must never serve it from cache.
  res.setHeader("Cache-Control", "no-store");
  const [admin] = await db
    .select({
      id: adminUsersTable.id,
      username: adminUsersTable.username,
      displayName: adminUsersTable.displayName,
      role: adminUsersTable.role,
      totpEnabled: adminUsersTable.totpEnabled,
      permissions: adminUsersTable.permissions,
      createdAt: adminUsersTable.createdAt,
    })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);

  if (!admin) {
    return res
      .status(401)
      .json(createErrorResponse("جلسة الإدارة غير صالحة", ErrorCode.UNAUTHORIZED));
  }

  return res.json({
    id: admin.id,
    username: admin.username,
    display_name: admin.displayName,
    role: admin.role,
    totp_enabled: admin.totpEnabled,
    permissions: admin.permissions ?? [],
    created_at: admin.createdAt?.toISOString(),
  });
});

/**
 * POST /api/admin/logout — revokes the server-side session row,
 * clears the admin_token cookie + emits an audit log entry. Idempotent:
 * revoking an already-revoked row is a no-op, the response is always 200.
 *
 * A8-01 (round-94): this used to be cookie-clearing ONLY — the bearer
 * token in the admin SPA's memory kept full authority for its whole
 * 8h JWT TTL after "logout". The row revocation is what makes logout
 * real.
 */
router.post("/logout", requireAdmin, async (req, res) => {
  const adminReq = req as AdminAuthenticatedRequest;
  const adminId = adminReq.adminId;
  const sid = adminReq.adminSessionId;
  if (sid) {
    await revokeAdminSession(sid, "logout");
  }
  res.clearCookie(ADMIN_COOKIE_NAME, { ...ADMIN_COOKIE_OPTIONS, maxAge: undefined });
  void writeAuditLog(req, "admin.logout", "admin_user", adminId, {});
  return res.json({ success: true });
});

/**
 * POST /api/admin/change-password — old-password-gated rotation.
 *
 * Security:
 *   - Requires a valid admin session (httpOnly cookie) + the old
 *     password as additional re-authentication.
 *   - Rate-limited via the same lockout helper as login (so a
 *     compromised session can't brute-force the old password).
 *   - Audit-logged on every attempt + success.
 *   - A8-01 (round-94): now revokes EVERY session row for the admin
 *     (including this one) — a password change is a compromise
 *     response, so all outstanding tokens die with it. The operator
 *     re-authenticates with the new password (standard practice; the
 *     SPA already redirects to login on the resulting 401).
 */
router.post("/change-password", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const { current_password, new_password } = (req.body ?? {}) as {
    current_password?: string;
    new_password?: string;
  };

  // Round-3 (8-b §5): type-guard first — a non-string new_password
  // previously sailed past the `.length` check (undefined) and crashed
  // argon2 with a 500-for-user-input.
  if (typeof current_password !== "string" || typeof new_password !== "string") {
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  }
  if (!current_password || !new_password) {
    return res
      .status(400)
      .json(createErrorResponse("كلمة المرور الحالية والجديدة مطلوبتان", ErrorCode.INVALID_DATA));
  }
  if (new_password.length < 8) {
    // Round-3 envelope drift fix: 400 without `code`.
    return res
      .status(400)
      .json(
        createErrorResponse(
          "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل",
          ErrorCode.INVALID_PASSWORD_LENGTH,
        ),
      );
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);
  if (!admin) {
    return res
      .status(401)
      .json(createErrorResponse("جلسة الإدارة غير صالحة", ErrorCode.UNAUTHORIZED));
  }

  const lockoutKey = `admin-pwchange:${admin.username}`;
  const { locked, lockedUntil } = await checkLockout(lockoutKey);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    return res.status(429).json(
      // AUD103-4-F6 (r103): same "too many attempts" class as the login
      // lockout — ACCOUNT_LOCKED, not INVALID_DATA (the two codes render
      // different Arabic copy client-side).
      createErrorResponse(`محاولات كثيرة. حاول بعد ${mins} دقيقة.`, ErrorCode.ACCOUNT_LOCKED),
    );
  }

  const { valid } = await verifyPassword(current_password, admin.passwordHash);
  if (!valid) {
    await recordFailedAttempt(lockoutKey);
    void writeAuditLog(req, "admin.password_change_failed", "admin_user", adminId, {
      reason: "wrong_current_password",
    });
    return res
      .status(401)
      .json(createErrorResponse("كلمة المرور الحالية غير صحيحة", ErrorCode.UNAUTHORIZED));
  }
  await resetAttempts(lockoutKey);

  await db
    .update(adminUsersTable)
    .set({ passwordHash: await hashPassword(new_password) })
    .where(eq(adminUsersTable.id, adminId));

  // A8-01: kill every outstanding session — password rotation is a
  // compromise response, not a profile edit.
  await revokeAllAdminSessions(adminId, "password_changed");

  void writeAuditLog(req, "admin.password_changed", "admin_user", adminId, {});
  return res.json({
    success: true,
    message: "تم تغيير كلمة المرور بنجاح — سيتم تسجيل خروجك من كل الجلسات",
  });
});

/**
 * PATCH /api/admin/profile — change username + display_name.
 *
 * Security:
 *   - Requires re-entry of the current password to authorize the
 *     change (defence-in-depth even though the session cookie is
 *     already valid — username changes are a high-leverage action).
 *   - Username uniqueness enforced at DB level (UNIQUE constraint);
 *     SQLSTATE 23505 → 409.
 *   - Audit-logged.
 */
router.patch("/profile", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const { username, display_name, current_password } = (req.body ?? {}) as {
    username?: string;
    display_name?: string;
    current_password?: string;
  };

  if (typeof current_password !== "string" || !current_password) {
    // Round-3: type-guard + envelope code on the 400.
    return res
      .status(400)
      .json(
        createErrorResponse("كلمة المرور الحالية مطلوبة لتأكيد التغيير", ErrorCode.INVALID_DATA),
      );
  }
  if (!username && !display_name) {
    return res
      .status(400)
      .json(createErrorResponse("لا توجد حقول للتحديث", ErrorCode.INVALID_DATA));
  }
  if (username !== undefined) {
    if (typeof username !== "string" || username.trim().length < 3) {
      return res
        .status(400)
        .json(
          createErrorResponse("اسم المستخدم يجب أن يكون 3 أحرف على الأقل", ErrorCode.INVALID_DATA),
        );
    }
    if (username.trim().length > 100) {
      return res
        .status(400)
        .json(createErrorResponse("اسم المستخدم طويل جداً", ErrorCode.INVALID_DATA));
    }
  }
  // 98-F3 (R98-A1 P3-8): display_name was only `.trim()`ed — an
  // unbounded value (up to the 1 MB JSON limit) landed directly in the
  // admin_users row and every list/probe response. B2-F3 (R111): the
  // original bound here was 200, but admin_users.display_name is
  // varchar(100) — a 101..200-char name passed this check and then 500'd
  // (22001) at the UPDATE. Aligned with the column: 100.
  if (display_name !== undefined) {
    if (typeof display_name !== "string" || display_name.trim().length === 0) {
      return res
        .status(400)
        .json(createErrorResponse("الاسم الظاهر غير صالح", ErrorCode.INVALID_DATA));
    }
    if (display_name.trim().length > 100) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "الاسم الظاهر طويل جداً (الحد الأقصى 100 حرف)",
            ErrorCode.INVALID_DATA,
          ),
        );
    }
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);
  if (!admin) {
    return res
      .status(401)
      .json(createErrorResponse("جلسة الإدارة غير صالحة", ErrorCode.UNAUTHORIZED));
  }

  const { valid } = await verifyPassword(current_password, admin.passwordHash);
  if (!valid) {
    void writeAuditLog(req, "admin.profile_change_failed", "admin_user", adminId, {
      reason: "wrong_current_password",
    });
    return res
      .status(401)
      .json(createErrorResponse("كلمة المرور الحالية غير صحيحة", ErrorCode.UNAUTHORIZED));
  }

  const updates: Partial<typeof adminUsersTable.$inferInsert> = {};
  if (username !== undefined) updates.username = username.trim();
  if (display_name !== undefined) updates.displayName = display_name.trim();

  try {
    const [updated] = await db
      .update(adminUsersTable)
      .set(updates)
      .where(eq(adminUsersTable.id, adminId))
      .returning();

    void writeAuditLog(req, "admin.profile_changed", "admin_user", adminId, {
      fields_changed: Object.keys(updates),
    });

    return res.json({
      id: updated.id,
      username: updated.username,
      display_name: updated.displayName,
      role: updated.role,
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return res
        .status(409)
        .json(createErrorResponse("اسم المستخدم مستخدم بالفعل", ErrorCode.ALREADY_EXISTS));
    }
    throw err;
  }
});

/**
 * POST /api/admin/2fa/setup — mint a fresh TOTP secret + otpauth URL.
 *
 * 93-A1 S5 (round-93): password re-entry is now REQUIRED whenever this
 * call would DISABLE an enabled 2FA (the re-enrollment case). Before
 * this fix the endpoint overwrote totpSecret AND flipped totpEnabled to
 * false with nothing but the session cookie — an attacker holding an
 * 8h admin session could silently remove 2FA, and the compromise stayed
 * persistent after the session died (next password-only login meets no
 * TOTP challenge). That is exactly the re-auth bar /change-password and
 * /profile already enforce for equally high-leverage mutations.
 *
 * Behaviour:
 *   - TOTP currently ENABLED (calling setup disables it):
 *       `current_password` REQUIRED — argon2-verified against the row,
 *       wrapped in the same lockout helper as change-password (a
 *       stolen session cannot brute-force the password here), and
 *       audited as `admin.totp_disabled` (per the audit's exact rec).
 *   - TOTP currently disabled (fresh enrollment):
 *       `current_password` optional — if PRESENT it is verified (a
 *       wrong password is rejected); if absent the enrollment proceeds.
 *       The admin UI's fresh-enrollment CTA sends no body (enrollment
 *       cannot lock the real admin out of anything an attacker gains,
 *       so the S5 persistence vector is the disable case above, not
 *       this one). Since R125-I5 the UI's RE-ENROLL path knows the
 *       enrollment state and sends `current_password` — it always
 *       lands in the enabled branch above. Keeping the optional branch
 *       here preserves the API's existing contract (the no-body
 *       enrollment test pins it); requiring it would be a breaking
 *       change for zero additional security (fresh enrollment gains
 *       the attacker nothing the session cookie doesn't already give).
 */
router.post("/2fa/setup", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const { current_password } = (req.body ?? {}) as { current_password?: string };

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);
  if (!admin) {
    return res
      .status(401)
      .json(createErrorResponse("جلسة الإدارة غير صالحة", ErrorCode.UNAUTHORIZED));
  }

  const wasEnabled = admin.totpEnabled === true;

  // ── 93-A1 S5: re-authentication gate ─────────────────────────────────
  if (wasEnabled) {
    // Rotating the secret of an ENABLED 2FA disables it until the new
    // secret is verified — treat exactly like a disable action.
    if (typeof current_password !== "string" || !current_password) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "كلمة المرور الحالية مطلوبة لإعادة إعداد المصادقة الثنائية",
            ErrorCode.INVALID_DATA,
          ),
        );
    }

    const lockoutKey = `admin-2fasetup:${admin.username}`;
    const { locked, lockedUntil } = await checkLockout(lockoutKey);
    if (locked) {
      const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
      return res
        .status(429)
        .json(
          createErrorResponse(`محاولات كثيرة. حاول بعد ${mins} دقيقة.`, ErrorCode.ACCOUNT_LOCKED),
        );
    }

    const { valid } = await verifyPassword(current_password, admin.passwordHash);
    if (!valid) {
      await recordFailedAttempt(lockoutKey);
      void writeAuditLog(req, "admin.totp_disable_failed", "admin_user", adminId, {
        reason: "wrong_current_password",
      });
      return res
        .status(401)
        .json(createErrorResponse("كلمة المرور الحالية غير صحيحة", ErrorCode.UNAUTHORIZED));
    }
    await resetAttempts(lockoutKey);
  } else if (typeof current_password === "string" && current_password) {
    // Fresh enrollment: optional (the admin UI's fresh-enrollment CTA
    // sends no body — since R125-I5 its re-enroll path DOES send the
    // password and always lands in the wasEnabled branch above), but a
    // caller that DOES present a password gets it verified — never
    // accept a silently-wrong credential.
    const { valid } = await verifyPassword(current_password, admin.passwordHash);
    if (!valid) {
      void writeAuditLog(req, "admin.totp_setup_failed", "admin_user", adminId, {
        reason: "wrong_current_password",
      });
      return res
        .status(401)
        .json(createErrorResponse("كلمة المرور الحالية غير صحيحة", ErrorCode.UNAUTHORIZED));
    }
  }

  const secret = generateSecret();
  const otpauth = generateURI({ label: `admin_${adminId}`, issuer: "SubNation", secret });

  // R118-B1c (A4 F-4): the secret is stored ENCRYPTED at rest (v2 blob,
  // AES-256-GCM — same helpers as the inventory credentials). The
  // RESPONSE still returns the plaintext secret + otpauth URL: the
  // operator needs it exactly once to enroll the authenticator, and the
  // API contract is unchanged. The column stays varchar(255): a 20-byte
  // base32 secret lands at ~125 chars of v2 blob, well inside the budget.
  // Verify paths decrypt via safeDecrypt (legacy plaintext passthrough
  // keeps any pre-encryption enrollment working).
  await db
    .update(adminUsersTable)
    .set({ totpSecret: encrypt(secret), totpEnabled: false })
    .where(eq(adminUsersTable.id, adminId));

  // 93-A1 S5: audit-log whenever an ENABLED secret was overwritten —
  // "2FA was turned off by a /setup call" must be visible in the trail.
  if (wasEnabled) {
    void writeAuditLog(req, "admin.totp_disabled", "admin_user", adminId, {
      reason: "2fa_setup_rotation",
    });
  }

  return res.json({ secret, otpauth_url: otpauth });
});

router.post("/2fa/verify-setup", requireAdmin, async (req, res) => {
  const adminId = (req as AdminAuthenticatedRequest).adminId;
  const { code } = req.body ?? {};
  if (typeof code !== "string" || !code.trim())
    return res.status(400).json(createErrorResponse("الرمز مطلوب", ErrorCode.INVALID_DATA));

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);

  if (!admin || !admin.totpSecret) {
    return res.status(400).json(createErrorResponse("إعداد 2FA غير موجود", ErrorCode.INVALID_DATA));
  }

  // R122 (A5-P2): the H10 asymmetry — /login/verify-2fa has carried a
  // per-admin attempt lockout since H10 because "TOTP codes are only 6
  // digits" (cheap online brute-force), but this sibling endpoint verified
  // codes with nothing but the apiLimiter budget (admin requests carry no
  // user token, so they ride the anonymous 600/min envelope). A stolen
  // session + an abandoned pending enrollment (totpSecret set,
  // totpEnabled=false) left the 10^6 keyspace guessable — and a success
  // locked the REAL admin out of their own 2FA. Port the exact H10 idiom:
  // the SAME `admin-2fa:{adminId}` key as verify-2fa (the two endpoints
  // target the same admin's TOTP code, so they share one budget), default
  // 5-attempt/15-min exponential policy, 429 while locked, reset on success.
  const lockoutKey = `admin-2fa:${admin.id}`;
  const { locked, lockedUntil } = await checkLockout(lockoutKey);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    return res
      .status(429)
      .json(
        createErrorResponse(
          `الحساب مقفل بسبب محاولات فاشلة. حاول بعد ${mins} دقيقة.`,
          ErrorCode.ACCOUNT_LOCKED,
        ),
      );
  }

  // R118-B1c (A4 F-4): the setup path stored the secret encrypted —
  // decrypt here (legacy plaintext passes through) and fail the verify
  // with the same 401 as a wrong code if the blob no longer decrypts.
  // Same rule as verify-2fa: this failure is NOT the admin's guess, so
  // the lockout counter above is NOT incremented.
  const totpSecret = safeDecrypt(admin.totpSecret);
  if (!totpSecret) {
    return res.status(401).json(createErrorResponse("رمز التحقق غير صحيح", ErrorCode.UNAUTHORIZED));
  }

  // R118-B1c: same verdict-object fix as /login/verify-2fa above —
  // verifySync returns { valid }, never a boolean.
  const verdict = verifySync({ token: code, secret: totpSecret });
  if (!verdict.valid) {
    await recordFailedAttempt(lockoutKey);
    return res.status(401).json(createErrorResponse("رمز التحقق غير صحيح", ErrorCode.UNAUTHORIZED));
  }
  await resetAttempts(lockoutKey);

  await db
    .update(adminUsersTable)
    .set({ totpEnabled: true })
    .where(eq(adminUsersTable.id, adminId));

  void writeAuditLog(req, "admin.totp_enabled", "admin_user", adminId, {});
  return res.json({ success: true, message: "تم تفعيل المصادقة الثنائية بنجاح" });
});

export { router as adminAuthRouter };
