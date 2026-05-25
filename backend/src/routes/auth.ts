import {
  db,
  sessionsTable,
  userAuthIdentitiesTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import crypto from "node:crypto";
import { getClientInfo, logAuthActivity } from "../lib/auth-activity";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { getFirebaseAdminAuth } from "../lib/firebase-admin";
import { signUserToken, verifyUserTokenDetailed } from "../lib/jwt";
import { logger } from "../lib/logger";
import { captureAuthFailure, captureSubsystemException } from "../lib/sentry";
import type { AuthenticatedRequest } from "../middlewares/requireUser";
import { requireUser } from "../middlewares/requireUser";
import {
  FirebaseAuthError,
  getFirebaseErrorMessage,
  resolveFirebaseSession,
  verifyFirebaseIdToken,
} from "../services/firebase-auth.service";
import { notifyNewUser } from "../telegram";

const router = Router();

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

  // Clear httpOnly cookie
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
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
        linkedAt: userAuthIdentitiesTable.linkedAt,
      })
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.userId, userId));

    return res.json({ providers: identities });
  } catch (err) {
    logger.error({ err, userId }, "Failed to fetch linked providers");
    captureSubsystemException("auth", err, { userId, route: "providers/linked" });
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
    // Look up the user — needed for the firebaseUid revocation path
    // and for audit-log identifier.
    const [user] = await db
      .select({
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

    const hasOtherIdentity =
      identity && (identity.provider !== provider || identity.providerUid !== provider_uid);

    if (!hasOtherIdentity) {
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
    captureSubsystemException("auth", err, { userId, provider, route: "providers/unlink" });
    return res
      .status(500)
      .json(createErrorResponse("فشل فصل مزود المصادقة", ErrorCode.INTERNAL_ERROR));
  }
});

router.get("/me", requireUser, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user)
    return res
      .status(401)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

  const identities = await db
    .select()
    .from(userAuthIdentitiesTable)
    .where(eq(userAuthIdentitiesTable.userId, user.id));

  // 30 s private browser cache. Concurrency win: 6 components on the
  // page (Navbar, Footer, profile, product, home, SocketInitializer)
  // share the same React Query queryKey so client-side they already
  // dedupe. The browser-cache layer additionally absorbs page
  // navigations and back-button revisits, so /api/auth/me hits the
  // origin at most twice per minute per user under steady-state
  // navigation. `private` keeps it out of any CDN — the response is
  // user-specific.
  res.set("Cache-Control", "private, max-age=30");

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

/**
 * GET /api/auth/probe — 200-always cookie-presence probe.
 *
 * Used by `frontend/src/lib/auth.tsx` on every cold boot to detect
 * whether the httpOnly auth_token cookie carries a live session,
 * WITHOUT producing a console-visible 401 on the unauthenticated
 * path. The browser network panel logs every non-2xx response
 * regardless of how JS handles it; calling /api/auth/me (which
 * legitimately returns 401 for typed clients) leaves a misleading
 * "Failed to load resource: 401" line in DevTools that Lighthouse
 * counts as a console error.
 *
 * Behaviour:
 *   - Cookie/header missing or invalid → 200 with { authenticated: false }
 *   - Cookie/header valid + user found → 200 with { authenticated: true, user, linked_identities }
 *   - User row missing for a valid token → 200 with { authenticated: false }
 *
 * The response shape on the authenticated path matches /api/auth/me
 * exactly so the React Query cache pre-seed in lib/auth.tsx still
 * lights up the typed useGetMe queryKey with full data.
 *
 * Cache-Control: same `private, max-age=30` as /me.
 */
router.get("/probe", async (req, res) => {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace("Bearer ", "");

  res.set("Cache-Control", "private, max-age=30");

  if (!token) {
    return res.status(200).json({ authenticated: false });
  }

  const result = verifyUserTokenDetailed(token);
  if (!result.ok) {
    return res.status(200).json({ authenticated: false });
  }

  const userId = result.payload.userId;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    return res.status(200).json({ authenticated: false });
  }

  const identities = await db
    .select()
    .from(userAuthIdentitiesTable)
    .where(eq(userAuthIdentitiesTable.userId, user.id));

  return res.status(200).json({
    authenticated: true,
    user: {
      ...formatUser(user),
      linked_identities: identities.map((id) => ({
        provider: id.provider,
        provider_uid: id.providerUid,
        email: id.email,
        phone: id.phone,
        linked_at: id.linkedAt,
        last_seen_at: id.lastSeenAt,
      })),
    },
  });
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
    if (result.isNewUser) {
      notifyNewUser({
        phone: result.user.phone,
        userId: result.user.id,
        hadReferral: !!result.user.referredBy,
        provider: result.user.telegramId
          ? "telegram"
          : result.user.firebaseUid
            ? "firebase"
            : "phone",
      });
    }

    const sessionId = crypto.randomUUID();
    const uaHeader = req.headers["user-agent"];
    const ua = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
    await db.insert(sessionsTable).values({
      id: sessionId,
      userId: result.user.id,
      userAgent: ua?.substring(0, 255),
      ipAddress: req.ip?.substring(0, 45),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const token = signUserToken({ userId: result.user.id, sessionId });

    // Set httpOnly cookie for better security
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // Lax for OAuth redirects
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.status(result.isNewUser ? 201 : 200).json({
      user: formatUser(result.user),
      token,
      provider: result.provider,
      is_new_user: result.isNewUser,
      needs_phone: !result.user.phoneVerified,
    });
  } catch (err) {
    logger.error({ err, id_token_length: id_token?.length }, "Firebase session creation failed");
    if (err instanceof FirebaseAuthError) {
      const code = err.statusCode === 503 ? ErrorCode.SERVICE_UNAVAILABLE : ErrorCode.INVALID_TOKEN;
      return res
        .status(err.statusCode)
        .json(createErrorResponse(getFirebaseErrorMessage(err), code));
    }
    // Non-Firebase error (database, network, etc.) — capture for Sentry
    // triage. FirebaseAuthError above is expected user-facing failure
    // noise (invalid/expired token); we only escalate the unexpected
    // path that warrants engineer attention.
    captureAuthFailure("firebase", err, { id_token_length: id_token?.length });
    // Return 500, not 401. A 401 here would cause the frontend to enter
    // an infinite refresh loop because it would interpret it as "session
    // invalid, retry".
    return res
      .status(500)
      .json(
        createErrorResponse(
          "تعذّر إنشاء الجلسة بسبب خطأ في الخادم. يرجى المحاولة مرة أخرى.",
          ErrorCode.INTERNAL_ERROR,
        ),
      );
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

    const sessionId = crypto.randomUUID();
    const ua = Array.isArray(req.headers["user-agent"])
      ? req.headers["user-agent"][0]
      : req.headers["user-agent"];
    await db.insert(sessionsTable).values({
      id: sessionId,
      userId: result.user.id,
      userAgent: ua?.substring(0, 255),
      ipAddress: req.ip?.substring(0, 45),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const token = signUserToken({ userId: result.user.id, sessionId });

    // Set httpOnly cookie
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.json({
      user: formatUser(result.user),
      token,
    });
  } catch (err) {
    logger.error({ err, id_token_length: id_token?.length }, "Firebase session refresh failed");
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
    // Non-Firebase error (database, network, etc.) — capture for Sentry
    // triage. The FirebaseAuthError branch above is expected user-facing
    // noise; we only escalate the unexpected path.
    captureAuthFailure("firebase", err, { id_token_length: id_token?.length });
    // Return 500, not 401. A 401 here would trigger the frontend's
    // onIdTokenChanged listener to retry indefinitely, creating an
    // infinite refresh loop.
    return res
      .status(500)
      .json(
        createErrorResponse(
          "تعذّر تجديد الجلسة بسبب خطأ في الخادم. يرجى المحاولة لاحقاً.",
          ErrorCode.INTERNAL_ERROR,
        ),
      );
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

router.delete("/sessions/:id", requireUser, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.id;
  await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.id, String(sessionId)), eq(sessionsTable.userId, userId)));
  res.json({ success: true });
});

export { router as authRouter };
