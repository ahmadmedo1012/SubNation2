import { AdminLoginBody } from "@workspace/api-zod";
import { adminUsersTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type CookieOptions } from "express";
import jwt from "jsonwebtoken";
import { generateSecret, generateURI, verifySync } from "otplib";
import { writeAuditLog } from "../../lib/audit";
import { hashPassword, verifyPassword } from "../../lib/crypto";
import { ADMIN_JWT_SECRET, signAdminToken } from "../../lib/jwt";
import {
  createAdminSession,
  isValidAdminSession,
  revokeAdminSession,
  revokeAllAdminSessions,
} from "../../lib/admin-session";
import { checkLockout, recordFailedAttempt, resetAttempts } from "../../lib/lockout";
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

router.post("/login", async (req, res) => {
  const parse = AdminLoginBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  const { username, password } = parse.data;

  // A8-03 (round-94): the lockout key used to be `admin:${username}`
  // ALONE — anyone who knows the (single, public-ish) username could
  // lock the admin out of the money queue remotely with 5 anonymous
  // failures, repeatable forever, while the IP rate-limit budget
  // barely noticed. Keying on IP + username keeps per-IP brute force
  // inside the same 5-attempt envelope while making remote lockout
  // of the legitimate admin (different IP) structurally impossible.
  const clientIp =
    (typeof req.headers["cf-connecting-ip"] === "string" && req.headers["cf-connecting-ip"]) ||
    req.ip ||
    "unknown";
  const lockoutKey = `admin:${username}:${clientIp}`;
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

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.username, username))
    .limit(1);
  if (!admin) {
    await recordFailedAttempt(lockoutKey);
    return res
      .status(401)
      .json(createErrorResponse("اسم المستخدم أو كلمة المرور غير صحيحة", ErrorCode.UNAUTHORIZED));
  }
  if (!admin.isActive) {
    // Soft-disabled admin — same 401 response as a wrong password so
    // we don't leak account-state to a brute-forcer.
    await recordFailedAttempt(lockoutKey);
    return res
      .status(401)
      .json(createErrorResponse("اسم المستخدم أو كلمة المرور غير صحيحة", ErrorCode.UNAUTHORIZED));
  }
  const { valid, needsRehash } = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    await recordFailedAttempt(lockoutKey);
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

  if (admin.totpEnabled && admin.totpSecret) {
    // A8-05 (round-94): the 2FA challenge token lived as long as a full
    // session (8h). The window where a half-session token is floating
    // around is now 10 minutes — plenty for a human to open the
    // authenticator, worthless for offline brute force (the per-admin
    // lockout below is the real gate; this just shrinks the target).
    const tempToken = signAdminToken({ adminId: admin.id, role: admin.role, isTemp: true }, { expiresIn: "10m" });
    return res.json({ requires_2fa: true, temp_token: tempToken });
  }

  // A8-01 (round-94): durable, revocable session row + sid-bound token.
  const { token } = await createAdminSession({
    adminId: admin.id,
    role: admin.role,
    userAgent: req.headers["user-agent"],
    ipAddress: clientIp,
  });
  res.cookie(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
  return res.json({
    token,
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

    const isValid = verifySync({ token: code, secret: admin.totpSecret });
    if (!isValid) {
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
    return res.json({
      token,
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
    return res
      .status(429)
      .json(createErrorResponse(`محاولات كثيرة. حاول بعد ${mins} دقيقة.`, ErrorCode.INVALID_DATA));
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
 *       The current admin UI (settings.tsx, security tab) sends no
 *       body, so requiring it would break the operator's only 2FA
 *       enablement flow — the disable case above is the actual S5
 *       persistence vector (enrollment cannot lock the real admin out
 *       of anything an attacker gains). Frontend follow-up: send
 *       `current_password` here too, then tighten this branch to
 *       require it (see worklog 93-C2).
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
    // Fresh enrollment: optional today (the admin UI sends no body), but
    // a caller that DOES present a password gets it verified — never
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

  await db
    .update(adminUsersTable)
    .set({ totpSecret: secret, totpEnabled: false })
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

  const isValid = verifySync({ token: code, secret: admin.totpSecret });
  if (!isValid) {
    return res.status(401).json(createErrorResponse("رمز التحقق غير صحيح", ErrorCode.UNAUTHORIZED));
  }

  await db
    .update(adminUsersTable)
    .set({ totpEnabled: true })
    .where(eq(adminUsersTable.id, adminId));

  void writeAuditLog(req, "admin.totp_enabled", "admin_user", adminId, {});
  return res.json({ success: true, message: "تم تفعيل المصادقة الثنائية بنجاح" });
});

export { router as adminAuthRouter };
