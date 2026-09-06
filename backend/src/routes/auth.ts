import { db, sessionsTable, userAuthIdentitiesTable, usersTable } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { Router } from "express";
import { getClientInfo, logAuthActivity } from "../lib/auth-activity";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { getFirebaseAdminAuth } from "../lib/firebase-admin";
import { verifyUserTokenDetailed } from "../lib/jwt";
import { createUserSession } from "../lib/session";
import { logger } from "../lib/logger";
import { scoreEventFireAndForget } from "../lib/risk-emit";
import { captureAuthFailure, captureSubsystemException } from "../lib/sentry";
import { derivePrimaryProvider } from "../lib/user-provider";
import type { AuthenticatedRequest } from "../middlewares/requireUser";
import { requireUser } from "../middlewares/requireUser";
import {
  FirebaseAuthError,
  LinkConsentRequiredError,
  getFirebaseErrorMessage,
  resolveFirebaseSession,
  verifyFirebaseIdToken,
} from "../services/firebase-auth.service";
import { notifyNewUser } from "../telegram";
import { getAuthCookieOptions, getAuthCookieSameSite } from "../lib/cookie-options";

const router = Router();

router.post("/logout", requireUser, async (req, res) => {
  const auth = getFirebaseAdminAuth();
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = (req as AuthenticatedRequest).sessionId;
  const clientInfo = getClientInfo(req);

  // Get user info for logging
  const [user] = await db
    .select({ phone: usersTable.phone, firebaseUid: usersTable.firebaseUid })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  // V1-H3 (red-team 2026-09-06): delete THIS session row so the JWT is
  // actually revoked server-side. requireUser now checks the row (60s
  // cache), but logout previously never deleted it — the exact "stolen
  // token survives logout" scenario the row check exists to close.
  // Best-effort: a failed delete must not block the cookie clear below.
  if (sessionId) {
    try {
      await db.delete(sessionsTable).where(eq(sessionsTable.id, String(sessionId)));
    } catch (err) {
      logger.warn({ err, userId, sessionId }, "Failed to delete session row during logout");
    }
  }

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

  // Clear the session cookie — previously logout only revoked Firebase
  // refresh tokens and left `auth_token` set, so for non-Firebase users
  // (WhatsApp/Telegram) the browser kept sending a valid JWT after
  // "logout". Mirror the cookie options used at issuance (sameSite lax,
  // secure in prod, 30d maxAge) so the removal actually matches.
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: getAuthCookieSameSite(),
    path: "/",
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

  // Revoke every session row for this user FIRST — the device list is
  // backed by these rows, and previously the Firebase branch returned
  // early without touching them (and without clearing the cookie).
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));

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

        // Clear httpOnly cookie (the firebase branch used to skip this)
        res.clearCookie("auth_token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: getAuthCookieSameSite(),
          path: "/",
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
    sameSite: getAuthCookieSameSite(),
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

  // Round-3 (8-c §2.6): user + identities read concurrently — /me sits
  // on the critical path of every page load (Navbar boot probe).
  const [[user], identities] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1),
    db
      .select()
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.userId, userId)),
  ]);
  if (!user)
    return res
      .status(401)
      .json(createErrorResponse("المستخدم غير موجود", ErrorCode.ACCOUNT_NOT_FOUND));

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
  // Round-3 (8-c §2.6): concurrent user + identities read.
  const [[user], identities] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1),
    db
      .select()
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.userId, userId)),
  ]);
  if (!user) {
    return res.status(200).json({ authenticated: false });
  }

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
  const { id_token, referral_code, link_consent_token } = req.body as {
    id_token?: string;
    referral_code?: string;
    /**
     * F-003 (security audit 004) — when the previous call returned 409
     * with `reason === "link_consent_required"`, the frontend re-submits
     * the same id_token plus the `link_token` value from that 409 body
     * (renamed to link_consent_token here for clarity at the boundary).
     * The resolver consumes it one-shot via Redis and only then
     * commits the link.
     */
    link_consent_token?: string;
  };
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

    // ── Firebase Phone OTP — permanently retired ──────────────────────────
    // Reject phone-provider Firebase tokens unconditionally. The platform
    // uses WhatsApp OTP for all phone-based authentication. This is
    // defense-in-depth: even if Firebase Phone is mistakenly re-enabled
    // in the Firebase Console, the backend will not issue a session for it.
    // Google tokens (sign_in_provider === "google.com") are unaffected.
    const signInProvider = (decoded.firebase as { sign_in_provider?: string } | undefined)
      ?.sign_in_provider;
    if (signInProvider === "phone") {
      return res
        .status(403)
        .json(
          createErrorResponse(
            "تسجيل الدخول برقم الهاتف عبر Firebase معطّل — استخدم WhatsApp OTP",
            ErrorCode.SERVICE_UNAVAILABLE,
            { reason: "phone_auth_disabled" },
          ),
        );
    }

    const result = await resolveFirebaseSession(
      decoded,
      typeof referral_code === "string" ? referral_code.trim().toUpperCase() : undefined,
      currentUserId,
      typeof link_consent_token === "string" ? link_consent_token : undefined,
    );
    if (result.isNewUser) {
      notifyNewUser({
        phone: result.user.phone,
        userId: result.user.id,
        hadReferral: !!result.user.referredBy,
        provider: derivePrimaryProvider(result.user),
      });
    }

    const uaHeader = req.headers["user-agent"];
    const ua = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
    const { token } = await createUserSession({
      userId: result.user.id,
      ipAddress: req.ip,
      userAgent: ua,
    });

    // Risk pipeline (003-anomaly-detection) — emit login_success.
    // Fire-and-forget; gated on RISK_PIPELINE_ENABLED inside scoreEvent.
    scoreEventFireAndForget({
      eventType: "login_success",
      userId: result.user.id,
      ipAddress: req.ip ?? null,
      userAgent: ua ?? null,
      phone: result.user.phone ?? null,
      ruleContext: {
        event: {
          eventType: "login_success",
          ipAddress: req.ip ?? null,
          userAgent: ua ?? null,
        },
        user: { id: result.user.id },
      },
    });

    // Set httpOnly cookie for better security
    res.cookie("auth_token", token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });

    return res.status(result.isNewUser ? 201 : 200).json({
      user: formatUser(result.user),
      token,
      provider: result.provider,
      is_new_user: result.isNewUser,
      needs_phone: !result.user.phoneVerified,
    });
  } catch (err) {
    // F-003 (security audit 004) — surface a 409 with the consent
    // token + masked candidate hint so the frontend can render the
    // confirmation modal. This branch is BEFORE the generic
    // FirebaseAuthError handler because LinkConsentRequiredError is
    // not a Firebase error — it's a SubNation-specific control flow.
    if (err instanceof LinkConsentRequiredError) {
      logger.info(
        {
          // The candidate hint already redacts the email/phone; the
          // log carries only the lengths so an analyst can sanity-
          // check shape without seeing the raw values.
          masked_email_present: !!err.candidateHint.maskedEmail,
          masked_phone_present: !!err.candidateHint.maskedPhone,
        },
        "Account-link consent required (F-003)",
      );
      return res.status(err.statusCode).json({
        success: false,
        // Round-3 envelope drift fix: include the standard `error` field
        // (the consent screen parses `reason` — kept unchanged).
        error: "هذا الحساب مرتبط بمستخدم آخر. أكمل ربط الحسابات للمتابعة.",
        reason: err.reason,
        link_token: err.linkToken,
        candidate_hint: err.candidateHint,
      });
    }
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

    const ua = Array.isArray(req.headers["user-agent"])
      ? req.headers["user-agent"][0]
      : req.headers["user-agent"];
    const { token } = await createUserSession({
      userId: result.user.id,
      ipAddress: req.ip,
      userAgent: ua,
    });

    // Set httpOnly cookie
    res.cookie("auth_token", token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
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

/**
 * Round-3 (8-e §3): human-readable Arabic device label from a user-agent
 * string — "كروم على ويندوز" instead of the raw UA blob. Deliberately
 * coarse (browser family + OS family); version numbers would age the
 * label and leak fingerprinting detail users never asked to see.
 */
function describeDeviceInArabic(ua: string | null | undefined): string {
  if (!ua) return "جهاز غير معروف";
  const s = ua.toLowerCase();

  let browser = "متصفح غير معروف";
  if (s.includes("edg/")) browser = "إيدج";
  else if (s.includes("opr/") || s.includes("opera")) browser = "أوبرا";
  else if (s.includes("samsungbrowser")) browser = "متصفح سامسونج";
  else if (s.includes("firefox")) browser = "فيرفكس";
  else if (s.includes("chrome") || s.includes("crios")) browser = "كروم";
  else if (s.includes("safari")) browser = "سفاري";

  let os = "جهاز غير معروف";
  if (s.includes("android")) os = "أندرويد";
  else if (s.includes("iphone") || s.includes("ipad") || s.includes("ios")) {
    os = s.includes("ipad") ? "آيباد" : "آيفون";
  } else if (s.includes("windows")) os = "ويندوز";
  else if (s.includes("mac os") || s.includes("macintosh")) os = "ماك";
  else if (s.includes("linux")) os = "لينكس";

  return `${browser} على ${os}`;
}

router.get("/sessions", requireUser, async (req, res) => {
  const authReq = req as AuthenticatedRequest;

  // Real session rows written by createUserSession at every login. The
  // previous implementation returned a single hardcoded "current" row —
  // pure cosmetics that made the device list meaningless.
  const rows = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.userId, authReq.userId), gte(sessionsTable.expiresAt, new Date())))
    .orderBy(desc(sessionsTable.createdAt));

  return res.json({
    sessions: rows.map((r) => ({
      id: r.id,
      // Round-3 (8-e §3): the raw user-agent string (120 chars of
      // "Mozilla/5.0 (Windows NT 10.0…) Chrome/126…") was shown verbatim
      // in the user's "الأجهزة النشطة" list. Parse it into an Arabic
      // "browser on OS" label instead; the full UA stays available for
      // support via the API response below.
      device: describeDeviceInArabic(r.userAgent),
      user_agent: r.userAgent?.slice(0, 120) ?? null,
      ip: r.ipAddress ?? null,
      created_at: r.createdAt?.toISOString() ?? null,
      expires_at: r.expiresAt?.toISOString() ?? null,
      lastActive: r.createdAt?.toISOString() ?? new Date().toISOString(),
      current: authReq.sessionId ? r.id === authReq.sessionId : false,
    })),
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
    wallet_balance: parseFloat(String(user.walletBalance)),
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
  // Silent no-op → 404 (audit §5): revoking a non-existent or non-owned
  // session used to return `{success:true}` — the user believed a device
  // was logged out when nothing happened. Security-relevant honesty.
  const deleted = await db
    .delete(sessionsTable)
    .where(and(eq(sessionsTable.id, String(sessionId)), eq(sessionsTable.userId, userId)))
    .returning({ id: sessionsTable.id });
  if (deleted.length === 0)
    return res
      .status(404)
      .json(createErrorResponse("الجلسة غير موجودة", ErrorCode.NOT_FOUND));
  return res.json({ success: true });
});

export { router as authRouter };
