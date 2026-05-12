import { LoginBody, RegisterBody } from "@workspace/api-zod";
import {
  db,
  otpsTable,
  referralEventsTable,
  userAuthIdentitiesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gt, lt } from "drizzle-orm";
import { Router } from "express";
import {
  generateReferralCode,
  hashPassword,
  normalizeLibyanPhone,
  verifyPassword,
} from "../lib/crypto";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { getFirebaseAdminAuth } from "../lib/firebase-admin";
import { signUserToken, verifyUserTokenDetailed } from "../lib/jwt";
import { checkLockout, recordFailedAttempt, resetAttempts } from "../lib/lockout";
import { logger } from "../lib/logger";
import type { AuthenticatedRequest } from "../middlewares/requireUser";
import { requireUser } from "../middlewares/requireUser";
import {
  FirebaseAuthError,
  getFirebaseErrorMessage,
  resolveFirebaseSession,
  verifyFirebaseIdToken,
} from "../services/firebase-auth.service";
import { notifyNewUser, notifyPasswordResetRequest } from "../telegram";

// Feature flag: Allow new password registrations (set to false to force Firebase only)
const ALLOW_PASSWORD_REGISTRATION = process.env.ALLOW_PASSWORD_REGISTRATION !== "false";

const router = Router();

router.post("/register", async (req, res) => {
  const parse = RegisterBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  }
  const { phone, password, referral_code } = parse.data;
  const clientInfo = getClientInfo(req);

  // Feature flag: Check if password registration is allowed
  if (!ALLOW_PASSWORD_REGISTRATION) {
    await logAuthActivity({
      identifier: phone,
      action: "register",
      success: false,
      failureReason: "password_registration_disabled",
      ...clientInfo,
    });
    return res
      .status(403)
      .json(
        createErrorResponse(
          "تسجيل الحساب بكلمة المرور غير متاح حالياً. يرجى استخدام تسجيل الدخول عبر Google أو كود الهاتف.",
          ErrorCode.FEATURE_DISABLED,
        ),
      );
  }

  const passwordTrimmed = password.trim();
  if (passwordTrimmed.length < 8 || passwordTrimmed.length > 128) {
    await logAuthActivity({
      identifier: phone,
      action: "register",
      success: false,
      failureReason: "invalid_password_length",
      ...clientInfo,
    });
    return res
      .status(400)
      .json(
        createErrorResponse(
          "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
          ErrorCode.INVALID_PASSWORD_LENGTH,
        ),
      );
  }

  const normalizedPhone = normalizeLibyanPhone(phone);
  if (!normalizedPhone) {
    await logAuthActivity({
      identifier: phone,
      action: "register",
      success: false,
      failureReason: "invalid_phone",
      ...clientInfo,
    });
    return res
      .status(400)
      .json(
        createErrorResponse(
          "رقم الهاتف غير صالح. يجب أن يبدأ بـ 091 أو 092 أو 093 أو 094",
          ErrorCode.INVALID_PHONE,
        ),
      );
  }

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, normalizedPhone))
    .limit(1);
  if (existing) {
    await logAuthActivity({
      identifier: normalizedPhone,
      action: "register",
      success: false,
      failureReason: "phone_already_registered",
      ...clientInfo,
    });
    return res
      .status(409)
      .json(createErrorResponse("رقم الهاتف مسجل مسبقاً", ErrorCode.PHONE_ALREADY_REGISTERED));
  }

  let referredById: number | undefined;
  if (referral_code) {
    const [referrer] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.referralCode, referral_code))
      .limit(1);
    if (referrer) referredById = referrer.id;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      phone: normalizedPhone,
      passwordHash: await hashPassword(passwordTrimmed),
      referralCode: generateReferralCode(),
      referredBy: referredById,
      walletBalance: referredById ? "5.00" : "0.00",
    })
    .returning();

  if (referredById && referredById !== user.id) {
    await db
      .insert(referralEventsTable)
      .values({
        referrerId: referredById,
        refereeId: user.id,
        status: "pending",
      })
      .onConflictDoNothing();
  }

  notifyNewUser(normalizedPhone, !!referredById);

  await logAuthActivity({
    userId: user.id,
    identifier: normalizedPhone,
    action: "register",
    success: true,
    provider: "password",
    ...clientInfo,
  });

  const token = signUserToken({ userId: user.id });
  return res.status(201).json({ user: formatUser(user), token });
});

router.post("/login", async (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  }
  const { phone, password } = parse.data;
  const normalizedPhone = normalizeLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);
  const clientInfo = getClientInfo(req);

  const { locked, lockedUntil } = await checkLockout(normalizedPhone);
  if (locked) {
    const mins = Math.ceil((lockedUntil!.getTime() - Date.now()) / 60_000);
    await logAuthActivity({
      identifier: normalizedPhone,
      action: "login",
      success: false,
      failureReason: "account_locked",
      ...clientInfo,
    });
    return res
      .status(429)
      .json(
        createErrorResponse(
          `الحساب مقفل بسبب محاولات فاشلة. حاول بعد ${mins} دقيقة.`,
          ErrorCode.ACCOUNT_LOCKED,
        ),
      );
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, normalizedPhone))
    .limit(1);
  if (!user) {
    await recordFailedAttempt(normalizedPhone);
    await logAuthActivity({
      identifier: normalizedPhone,
      action: "login",
      success: false,
      failureReason: "user_not_found",
      ...clientInfo,
    });
    return res
      .status(401)
      .json(
        createErrorResponse("رقم الهاتف أو كلمة المرور غير صحيحة", ErrorCode.INVALID_CREDENTIAL),
      );
  }

  if (!user.passwordLoginEnabled) {
    await logAuthActivity({
      userId: user.id,
      identifier: normalizedPhone,
      action: "login",
      success: false,
      failureReason: "password_login_disabled",
      ...clientInfo,
    });
    return res
      .status(403)
      .json(
        createErrorResponse(
          "تسجيل الدخول بكلمة المرور معطل لهذا الحساب. يرجى الدخول عبر كود الهاتف.",
          ErrorCode.UNAUTHORIZED,
        ),
      );
  }

  const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(normalizedPhone);
    await logAuthActivity({
      userId: user.id,
      identifier: normalizedPhone,
      action: "login",
      success: false,
      failureReason: "invalid_credentials",
      ...clientInfo,
    });
    return res
      .status(401)
      .json(
        createErrorResponse("رقم الهاتف أو كلمة المرور غير صحيحة", ErrorCode.INVALID_CREDENTIAL),
      );
  }
  // Auto-migrate legacy SHA-256 hash to argon2id
  if (needsRehash) {
    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(usersTable.id, user.id));
  }
  await resetAttempts(normalizedPhone);

  await logAuthActivity({
    userId: user.id,
    identifier: normalizedPhone,
    action: "login",
    success: true,
    provider: "password",
    ...clientInfo,
  });

  const token = signUserToken({ userId: user.id });
  return res.json({ user: formatUser(user), token });
});

router.post("/logout", requireUser, async (req, res) => {
  const auth = getFirebaseAdminAuth();
  const userId = (req as AuthenticatedRequest).userId;
  const clientInfo = getClientInfo(req);

  // Get user info for logging
  const [user] = await db
    .select({ phone: usersTable.phone, firebaseUid: usersTable.firebaseUid })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  // If user is authenticated and Firebase is enabled, revoke their Firebase refresh tokens
  if (auth && userId) {
    try {
      if (user?.firebaseUid) {
        await auth.revokeRefreshTokens(user.firebaseUid);
      }
    } catch (err) {
      // Log but don't fail logout if Firebase revocation fails
      logger.warn({ err, userId }, "Failed to revoke Firebase tokens during logout");
    }
  }

  await logAuthActivity({
    userId,
    identifier: user?.phone || `user_${userId}`,
    action: "logout",
    success: true,
    ...clientInfo,
  });

  return res.json({ success: true, message: "تم تسجيل الخروج" });
});

router.post("/logout-all-devices", requireUser, async (req, res) => {
  const auth = getFirebaseAdminAuth();
  const userId = (req as AuthenticatedRequest).userId;
  const clientInfo = getClientInfo(req);

  // Get user info for logging
  const [user] = await db
    .select({ phone: usersTable.phone, firebaseUid: usersTable.firebaseUid })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  // Revoke Firebase refresh tokens to logout from all devices
  if (auth && userId) {
    try {
      if (user?.firebaseUid) {
        await auth.revokeRefreshTokens(user.firebaseUid);

        await logAuthActivity({
          userId,
          identifier: user.phone || `user_${userId}`,
          action: "logout_all",
          success: true,
          ...clientInfo,
        });

        return res.json({ success: true, message: "تم تسجيل الخروج من جميع الأجهزة" });
      }
    } catch (err) {
      logger.warn({ err, userId }, "Failed to revoke Firebase tokens during logout all devices");

      await logAuthActivity({
        userId,
        identifier: user?.phone || `user_${userId}`,
        action: "logout_all",
        success: false,
        failureReason: "firebase_revocation_failed",
        ...clientInfo,
      });

      return res
        .status(500)
        .json(createErrorResponse("فشل تسجيل الخروج من جميع الأجهزة", ErrorCode.INTERNAL_ERROR));
    }
  }

  await logAuthActivity({
    userId,
    identifier: user?.phone || `user_${userId}`,
    action: "logout_all",
    success: true,
    ...clientInfo,
  });

  return res.json({ success: true, message: "تم تسجيل الخروج من الجهاز الحالي" });
});

// Get linked auth providers for current user
router.get("/providers/linked", requireUser, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    const identities = await db
      .select({
        provider: userAuthIdentitiesTable.provider,
        providerUid: userAuthIdentitiesTable.providerUid,
        firebaseUid: userAuthIdentitiesTable.firebaseUid,
        phone: userAuthIdentitiesTable.phone,
        email: userAuthIdentitiesTable.email,
        emailVerified: userAuthIdentitiesTable.emailVerified,
        phoneVerified: userAuthIdentitiesTable.phoneVerified,
        createdAt: userAuthIdentitiesTable.createdAt,
      })
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.userId, userId));

    return res.json({ providers: identities });
  } catch (err) {
    logger.error({ err, userId }, "Failed to fetch linked providers");
    return res
      .status(500)
      .json(createErrorResponse("فشل جلب مزودي المصادقة", ErrorCode.INTERNAL_ERROR));
  }
});

// Unlink an auth provider
router.post("/providers/unlink", requireUser, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { provider, provider_uid } = req.body as { provider?: string; provider_uid?: string };
  const clientInfo = getClientInfo(req);

  if (!provider || !provider_uid) {
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  }

  try {
    // Check if this is the user's primary auth method (has password)
    const [user] = await db
      .select({
        passwordHash: usersTable.passwordHash,
        firebaseUid: usersTable.firebaseUid,
        phone: usersTable.phone,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));
    }

    // Prevent unlinking if this is the only auth method
    const [identity] = await db
      .select()
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.userId, userId))
      .limit(1);

    const hasPassword = user.passwordHash && user.passwordHash.length > 0;
    const hasOtherIdentity =
      identity && (identity.provider !== provider || identity.providerUid !== provider_uid);

    if (!hasPassword && !hasOtherIdentity) {
      await logAuthActivity({
        userId,
        identifier: user.phone,
        action: "provider_unlink",
        success: false,
        failureReason: "would_lock_user",
        provider,
        ...clientInfo,
      });
      return res
        .status(400)
        .json(createErrorResponse("لا يمكن فصل آخر طريقة مصادقة", ErrorCode.INVALID_DATA));
    }

    // If unlinking Firebase, revoke refresh tokens
    if (provider === "firebase.com" && user.firebaseUid) {
      const auth = getFirebaseAdminAuth();
      if (auth) {
        await auth.revokeRefreshTokens(user.firebaseUid);
      }
    }

    // Delete the identity
    await db
      .delete(userAuthIdentitiesTable)
      .where(
        and(
          eq(userAuthIdentitiesTable.userId, userId),
          eq(userAuthIdentitiesTable.provider, provider),
          eq(userAuthIdentitiesTable.providerUid, provider_uid),
        ),
      );

    await logAuthActivity({
      userId,
      identifier: user.phone,
      action: "provider_unlink",
      success: true,
      provider,
      ...clientInfo,
    });

    return res.json({ success: true, message: "تم فصل مزود المصادقة" });
  } catch (err) {
    logger.error({ err, userId, provider }, "Failed to unlink provider");
    return res
      .status(500)
      .json(createErrorResponse("فشل فصل مزود المصادقة", ErrorCode.INTERNAL_ERROR));
  }
});

router.post("/forgot-password", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || typeof phone !== "string") {
    return res.status(400).json(createErrorResponse("رقم الهاتف مطلوب", ErrorCode.INVALID_DATA));
  }
  const normalizedPhone = normalizeLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);
  if (!normalizedPhone) {
    return res
      .status(400)
      .json(createErrorResponse("رقم الهاتف غير صالح", ErrorCode.INVALID_PHONE));
  }

  // Always respond success to prevent user enumeration
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, normalizedPhone))
    .limit(1);

  if (user) {
    const code = Math.floor(100_000 + Math.random() * 900_000).toString();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await db.insert(otpsTable).values({
      phone: normalizedPhone,
      code,
      expiresAt,
    });
    notifyPasswordResetRequest(normalizedPhone, code);
  }

  return res.json({ success: true, message: "إذا كان الرقم مسجلاً، سيتم إرسال كود التحقق قريباً" });
});

router.post("/reset-password", async (req, res) => {
  const { phone, otp, newPassword } = req.body as {
    phone?: string;
    otp?: string;
    newPassword?: string;
  };
  if (!phone || !otp || !newPassword) {
    return res.status(400).json(createErrorResponse("جميع الحقول مطلوبة", ErrorCode.INVALID_DATA));
  }
  const normalizedPhone = normalizeLibyanPhone(phone) ?? phone.replace(/\D/g, "").slice(-9);

  const passwordTrimmed = newPassword.trim();
  if (passwordTrimmed.length < 8 || passwordTrimmed.length > 128) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
          ErrorCode.INVALID_PASSWORD_LENGTH,
        ),
      );
  }

  const MAX_OTP_ATTEMPTS = 5;
  const now = new Date();
  const [otpRecord] = await db
    .select()
    .from(otpsTable)
    .where(and(eq(otpsTable.phone, normalizedPhone), gt(otpsTable.expiresAt, now)))
    .orderBy(otpsTable.createdAt)
    .limit(1);

  if (!otpRecord) {
    return res
      .status(400)
      .json(createErrorResponse("كود التحقق غير صحيح أو منتهي الصلاحية", ErrorCode.INVALID_OTP));
  }

  if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
    // Invalidate OTP entirely after too many wrong tries.
    await db.delete(otpsTable).where(eq(otpsTable.id, otpRecord.id));
    return res
      .status(429)
      .json(
        createErrorResponse("تم تجاوز عدد المحاولات. اطلب كوداً جديداً.", ErrorCode.INVALID_OTP),
      );
  }

  if (otpRecord.code !== otp.trim()) {
    await db
      .update(otpsTable)
      .set({ attempts: otpRecord.attempts + 1 })
      .where(eq(otpsTable.id, otpRecord.id));
    return res
      .status(400)
      .json(createErrorResponse("كود التحقق غير صحيح أو منتهي الصلاحية", ErrorCode.INVALID_OTP));
  }

  const [user] = await db
    .update(usersTable)
    .set({ passwordHash: await hashPassword(passwordTrimmed) })
    .where(eq(usersTable.phone, normalizedPhone))
    .returning();

  if (!user)
    return res
      .status(404)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  // Delete used OTP and any expired OTPs for this phone
  await db
    .delete(otpsTable)
    .where(and(eq(otpsTable.phone, normalizedPhone), lt(otpsTable.expiresAt, now)));
  await db.delete(otpsTable).where(eq(otpsTable.id, otpRecord.id));
  const token = signUserToken({ userId: user.id });
  return res.json({ success: true, token });
});

router.post("/change-password", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
  }
  const tokenResult = verifyUserTokenDetailed(authHeader.slice(7));
  if (!tokenResult.ok) {
    return res
      .status(401)
      .json(
        createErrorResponse(
          tokenResult.reason === "expired" ? "جلسة منتهية" : "رمز الجلسة غير صالح",
          tokenResult.reason === "expired" ? ErrorCode.SESSION_EXPIRED : ErrorCode.INVALID_TOKEN,
        ),
      );
  }
  const payload = tokenResult.payload;

  const { current_password, new_password } = req.body as {
    current_password?: string;
    new_password?: string;
  };
  const clientInfo = getClientInfo(req);

  if (!current_password || !new_password) {
    return res.status(400).json(createErrorResponse("جميع الحقول مطلوبة", ErrorCode.INVALID_DATA));
  }
  const newTrimmed = new_password.trim();
  if (newTrimmed.length < 8) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل",
          ErrorCode.INVALID_PASSWORD_LENGTH,
        ),
      );
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);
  if (!user)
    return res
      .status(404)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  const { valid: currentValid, needsRehash: currentNeedsRehash } = await verifyPassword(
    current_password,
    user.passwordHash,
  );
  if (!currentValid) {
    await logAuthActivity({
      userId: user.id,
      identifier: user.phone,
      action: "password_change",
      success: false,
      failureReason: "invalid_current_password",
      ...clientInfo,
    });
    return res
      .status(400)
      .json(createErrorResponse("كلمة المرور الحالية غير صحيحة", ErrorCode.INVALID_CREDENTIAL));
  }
  if (currentNeedsRehash) {
    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(current_password) })
      .where(eq(usersTable.id, user.id));
  }

  await db
    .update(usersTable)
    .set({ passwordHash: await hashPassword(newTrimmed) })
    .where(eq(usersTable.id, payload.userId));

  await logAuthActivity({
    userId: user.id,
    identifier: user.phone,
    action: "password_change",
    success: true,
    ...clientInfo,
  });

  return res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
});

router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
  }
  const tokenResult = verifyUserTokenDetailed(authHeader.slice(7));
  if (!tokenResult.ok) {
    return res
      .status(401)
      .json(
        createErrorResponse(
          tokenResult.reason === "expired" ? "جلسة منتهية" : "رمز الجلسة غير صالح",
          tokenResult.reason === "expired" ? ErrorCode.SESSION_EXPIRED : ErrorCode.INVALID_TOKEN,
        ),
      );
  }
  const payload = tokenResult.payload;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);
  if (!user)
    return res
      .status(401)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  const identities = await db
    .select()
    .from(userAuthIdentitiesTable)
    .where(eq(userAuthIdentitiesTable.userId, user.id));

  return res.json({
    ...formatUser(user),
    linked_identities: identities.map((id) => ({
      provider: id.provider,
      provider_uid: id.providerUid,
      email: id.email,
      phone: id.phone,
      linked_at: id.linkedAt,
      last_seen_at: id.lastSeenAt,
    })),
  });
});

router.post("/toggle-password-login", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
  }
  const tokenResult = verifyUserTokenDetailed(authHeader.slice(7));
  if (!tokenResult.ok)
    return res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    return res.status(400).json(createErrorResponse("الحالة مطلوبة", ErrorCode.INVALID_DATA));
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, tokenResult.payload.userId))
    .limit(1);
  if (!user)
    return res
      .status(404)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  // If disabling, ensure they have at least one Firebase identity linked
  if (!enabled) {
    const [identity] = await db
      .select()
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.userId, user.id))
      .limit(1);

    if (!identity && !user.firebaseUid) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "يجب ربط حساب Firebase أولاً لإيقاف كلمة المرور",
            ErrorCode.INVALID_DATA,
          ),
        );
    }
  }

  await db
    .update(usersTable)
    .set({
      passwordLoginEnabled: enabled,
      legacyPasswordDisabledAt: enabled ? null : new Date(),
    })
    .where(eq(usersTable.id, user.id));

  return res.json({ success: true, password_login_enabled: enabled });
});

router.post("/firebase/session", async (req, res) => {
  const { id_token, referral_code } = req.body as { id_token?: string; referral_code?: string };
  if (!id_token || typeof id_token !== "string") {
    return res.status(400).json(createErrorResponse("رمز Firebase مطلوب", ErrorCode.INVALID_DATA));
  }

  // Optional: Check if user is already authenticated (for account linking)
  let currentUserId: number | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const tokenResult = verifyUserTokenDetailed(authHeader.slice(7));
    if (tokenResult.ok) currentUserId = tokenResult.payload.userId;
  }

  try {
    // Use checkRevoked to detect revoked sessions during initial login
    const decoded = await verifyFirebaseIdToken(id_token, true);
    const result = await resolveFirebaseSession(
      decoded,
      typeof referral_code === "string" ? referral_code.trim().toUpperCase() : undefined,
      currentUserId,
    );
    if (result.isNewUser) notifyNewUser(result.user.phone, !!result.user.referredBy);
    const token = signUserToken({ userId: result.user.id });
    return res.status(result.isNewUser ? 201 : 200).json({
      user: formatUser(result.user),
      token,
      provider: result.provider,
      is_new_user: result.isNewUser,
      needs_phone: !result.user.phoneVerified,
    });
  } catch (err) {
    if (err instanceof FirebaseAuthError) {
      const code = err.statusCode === 503 ? ErrorCode.SERVICE_UNAVAILABLE : ErrorCode.INVALID_TOKEN;
      return res
        .status(err.statusCode)
        .json(createErrorResponse(getFirebaseErrorMessage(err), code));
    }
    return res
      .status(401)
      .json(createErrorResponse("فشل إنشاء جلسة آمنة", ErrorCode.INVALID_TOKEN));
  }
});

router.post("/firebase/refresh", async (req, res) => {
  const { id_token } = req.body as { id_token?: string };
  const clientInfo = getClientInfo(req);

  if (!id_token || typeof id_token !== "string") {
    return res
      .status(400)
      .json(createErrorResponse("رمز Firebase ID مطلوب", ErrorCode.INVALID_DATA));
  }

  try {
    const decoded = await verifyFirebaseIdToken(id_token, true);
    const result = await resolveFirebaseSession(decoded);

    await logAuthActivity({
      userId: result.user.id,
      identifier: result.user.phone || `firebase_${decoded.uid}`,
      action: "login",
      success: true,
      provider: "firebase",
      ...clientInfo,
    });

    const token = signUserToken({ userId: result.user.id });
    return res.json({
      user: formatUser(result.user),
      token,
    });
  } catch (err) {
    if (err instanceof FirebaseAuthError) {
      const code = err.statusCode === 503 ? ErrorCode.SERVICE_UNAVAILABLE : ErrorCode.INVALID_TOKEN;
      await logAuthActivity({
        identifier: `firebase_refresh_error`,
        action: "login",
        success: false,
        failureReason: "firebase_error",
        provider: "firebase",
        ...clientInfo,
      });
      return res
        .status(err.statusCode)
        .json(createErrorResponse(getFirebaseErrorMessage(err), code));
    }
    await logAuthActivity({
      identifier: `firebase_refresh_error`,
      action: "login",
      success: false,
      failureReason: "unknown_error",
      provider: "firebase",
      ...clientInfo,
    });
    return res.status(401).json(createErrorResponse("فشل تجديد الجلسة", ErrorCode.INVALID_TOKEN));
  }
});

router.get("/sessions", requireUser, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const [user] = await db
    .select({ lastAuthAt: usersTable.lastAuthAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  return res.json({
    sessions: [
      {
        id: "current",
        device: "الجهاز الحالي",
        lastActive: user?.lastAuthAt?.toISOString() ?? new Date().toISOString(),
        current: true,
      },
    ],
  });
});

router.post("/onboarding/complete", requireUser, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  await db
    .update(usersTable)
    .set({ onboardedAt: new Date(), onboardingStep: 5 })
    .where(eq(usersTable.id, userId));

  return res.json({ success: true });
});

export function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email ?? null,
    email_verified: user.emailVerified,
    phone_verified: user.phoneVerified,
    display_name: user.displayName ?? null,
    photo_url: user.photoUrl ?? null,
    auth_provider: user.authProvider,
    password_login_enabled: user.passwordLoginEnabled,
    wallet_balance: user.walletBalance,
    loyalty_points: user.loyaltyPoints,
    loyalty_tier: user.loyaltyTier,
    lifetime_spend: parseFloat(String(user.lifetimeSpend)),
    referral_code: user.referralCode ?? null,
    onboarded_at: user.onboardedAt ?? null,
    onboarding_step: user.onboardingStep,
    created_at: user.createdAt?.toISOString(),
  };
}

export { router as authRouter };
