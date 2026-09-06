import { db, referralEventsTable, userAuthIdentitiesTable, usersTable } from "@workspace/db";
import { createHash, randomBytes } from "crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import type { DecodedIdToken } from "firebase-admin/auth";
import jwt from "jsonwebtoken";
import { generateReferralCode, normalizeLibyanPhone } from "../lib/crypto";
import { getFirebaseAdminAuth } from "../lib/firebase-admin";
import {
  ConsentTokenError,
  consumeConsentToken,
  issueConsentToken,
  maskEmail,
  maskPhone,
} from "../lib/account-link-consent";
import { logger } from "../lib/logger";
import { insertReferralSignupLedger } from "../lib/ledger";

export class FirebaseAuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "FirebaseAuthError";
  }
}

/**
 * F-003 (security audit 004) — explicit consent required to link a
 * fresh Firebase identity to an existing SubNation user. Thrown by
 * `resolveFirebaseSession` when a single link candidate is found AND
 * no consent token was supplied. The route handler catches this,
 * surfaces a 409 carrying the consent token + masked candidate hint,
 * and the frontend renders a confirmation modal.
 *
 * The hint is intentionally masked (j••••@example.com / 9•••••••12)
 * so the modal proves the user knows their own account without
 * leaking enough information for an attacker to confirm the match.
 */
export class LinkConsentRequiredError extends Error {
  readonly statusCode = 409;
  readonly reason = "link_consent_required" as const;
  constructor(
    public readonly linkToken: string,
    public readonly candidateHint: {
      maskedEmail: string | null;
      maskedPhone: string | null;
    },
  ) {
    super("Account-link confirmation required");
    this.name = "LinkConsentRequiredError";
  }
}

export function getFirebaseErrorMessage(error: { code?: string; message?: string }): string {
  const code = error?.code || "";
  const message = error?.message || "";

  if (code === "auth/invalid-phone-number") {
    return "رقم الهاتف غير صالح. تأكد من كتابته بشكل صحيح.";
  }
  if (code === "auth/too-many-requests") {
    return "تم تجاوز عدد المحاولات. انتظر 5 دقائق ثم حاول مجدداً.";
  }
  if (code === "auth/code-expired") {
    return "انتهت صلاحية الكود. اطلب كوداً جديداً.";
  }
  if (code === "auth/invalid-verification-code") {
    return "كود التحقق غير صحيح.";
  }
  if (code === "auth/quota-exceeded") {
    return "تجاوزت الحد اليومي لإرسال الرسائل. حاول غداً.";
  }
  if (code === "auth/user-disabled") {
    return "تم تعطيل هذا الحساب. يرجى التواصل مع الدعم.";
  }
  if (code === "auth/captcha-check-failed") {
    return "فشل التحقق من الكابتشا. حاول مرة أخرى.";
  }
  if (code === "auth/internal-error") {
    return "حدث خطأ داخلي في Firebase. حاول مرة أخرى.";
  }
  if (code === "auth/network-request-failed") {
    return "فشل الاتصال بالشبكة. تحقق من اتصال الإنترنت.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "تم إغلاق نافذة تسجيل الدخول. حاول مرة أخرى.";
  }
  if (code === "auth/popup-blocked") {
    return "تم حظر النافذة المنبثقة. يرجى السماح بالنوافذ المنبثقة.";
  }
  if (code === "auth/unauthorized-domain") {
    return "المجال غير مصرح به. يرجى التواصل مع الدعم.";
  }
  if (message.includes("تعارض في بيانات الحساب")) {
    return message; // Already in Arabic
  }
  if (message.includes("هذا الحساب مرتبط")) {
    return message; // Already in Arabic
  }
  if (message.includes("تسجيل الدخول عبر Firebase غير مفعّل")) {
    return message; // Already in Arabic
  }
  if (message.includes("رمز Firebase غير صالح")) {
    return message; // Already in Arabic
  }
  if (message.includes("المستخدم غير موجود")) {
    return message; // Already in Arabic
  }

  return message || "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

export interface FirebaseSessionResult {
  user: typeof usersTable.$inferSelect;
  isNewUser: boolean;
  provider: string;
}

export async function verifyFirebaseIdToken(idToken: string, checkRevoked = false) {
  const auth = getFirebaseAdminAuth();
  if (!auth) {
    logger.error(
      "Firebase Admin Auth is null - service account credentials are missing or invalid",
    );
    throw new FirebaseAuthError(
      503,
      "خدمة Firebase غير مهيأة بشكل صحيح على الخادم. يرجى التواصل مع الدعم.",
    );
  }

  // Decode token (without verifying) to log non-sensitive metadata for diagnostics.
  // This helps us catch project-mismatch issues (token aud != backend project_id).
  const decoded = jwt.decode(idToken, { complete: true }) as {
    header?: { kid?: string; alg?: string };
    payload?: Record<string, unknown>;
  } | null;
  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;

  if (decoded?.payload) {
    const tokenAud = decoded.payload.aud as string | undefined;
    const tokenIss = decoded.payload.iss as string | undefined;
    logger.info(
      {
        kid: decoded.header?.kid,
        alg: decoded.header?.alg,
        aud: tokenAud,
        iss: tokenIss,
        sub: decoded.payload.sub,
        exp: decoded.payload.exp,
        firebase_provider: (decoded.payload.firebase as { sign_in_provider?: string } | undefined)
          ?.sign_in_provider,
        expected_project_id: expectedProjectId,
        project_match: tokenAud === expectedProjectId,
      },
      "Firebase ID token trace",
    );

    // Early diagnostic: if the token's audience doesn't match our expected project,
    // surface a clear error instead of a generic 401.
    if (expectedProjectId && tokenAud && tokenAud !== expectedProjectId) {
      logger.error(
        { tokenAud, expectedProjectId },
        "Token project mismatch - frontend Firebase project differs from backend project",
      );
      throw new FirebaseAuthError(
        401,
        `عدم تطابق مشروع Firebase: المتوقع "${expectedProjectId}" والمستلم "${tokenAud}". تحقق من إعدادات Firebase.`,
      );
    }
  }

  // Minimum length guard: a real Firebase ID token is a JWT with 3 base64url
  // segments separated by dots. The shortest valid Firebase JWT is ~500 chars.
  // Tokens shorter than 100 chars are definitely truncated/corrupted — this
  // happens when the popup communication is broken by CSP/COOP and the SDK
  // returns a garbage value from getIdToken(). Fail fast with a clear message.
  if (idToken.length < 100) {
    logger.error(
      { id_token_length: idToken.length },
      "Firebase ID token is too short to be valid — popup communication likely broken by CSP/COOP. " +
        "Check that trusted-types CSP directive is not blocking Firebase SDK internal policies.",
    );
    throw new FirebaseAuthError(
      400,
      "رمز Firebase غير مكتمل. يبدو أن النافذة المنبثقة لم تكمل عملية المصادقة. حاول مرة أخرى.",
    );
  }

  try {
    // F-002 (security audit 004) — forward the caller's `checkRevoked`
    // intent to the SDK. Previously this was hardcoded to `false`, which
    // silently dropped the parameter even when callers (`routes/auth.ts`
    // login + admin path) passed `true` expecting Firebase to enforce
    // revocation. With the SDK call honoring the parameter, callers that
    // explicitly want revocation enforcement get it; callers that omit
    // the second arg default to `false` and incur no extra round-trip.
    //
    // The original "compatibility" concern (extra round-trip causing 401s
    // when the service account has permission issues) is mitigated by:
    // (a) the SDK's verifyIdToken already requires the same service-
    //     account permissions for the basic verification call, so a
    //     revocation check that fails for permission reasons would be
    //     symptomatic of a broken service-account config we'd want to
    //     surface, not hide;
    // (b) callers default to `checkRevoked=false` and only opt in for
    //     security-sensitive entry points (initial login, admin auth).
    return await auth.verifyIdToken(idToken, checkRevoked);
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string; errorInfo?: { code?: string } };
    const errorCode = error.code || error.errorInfo?.code;
    logger.error(
      {
        err: { code: errorCode, message: error.message },
        checkRevoked,
        token_kid: decoded?.header?.kid,
        token_aud: decoded?.payload?.aud,
        expected_project_id: expectedProjectId,
      },
      "Firebase ID token verification failed",
    );

    // Handle specific Firebase admin error codes for clearer diagnostics
    if (errorCode === "auth/id-token-revoked") {
      throw new FirebaseAuthError(401, "تم إبطال جلسة Firebase. يرجى تسجيل الدخول مرة أخرى");
    }
    if (errorCode === "auth/id-token-expired") {
      throw new FirebaseAuthError(401, "انتهت صلاحية الرمز. يرجى تسجيل الدخول مرة أخرى");
    }
    if (errorCode === "auth/argument-error") {
      throw new FirebaseAuthError(400, "تنسيق الرمز غير صحيح");
    }
    if (errorCode === "auth/invalid-credential" || errorCode === "auth/internal-error") {
      // This typically means Firebase Admin couldn't authenticate to Google's
      // public-key servers — almost always a service-account misconfig.
      throw new FirebaseAuthError(
        503,
        "تعذّر التحقق من الرمز بسبب خطأ في إعدادات الخادم. يرجى التواصل مع الدعم.",
      );
    }
    throw new FirebaseAuthError(401, "رمز Firebase غير صالح أو منتهي الصلاحية");
  }
}

export async function resolveFirebaseSession(
  decoded: DecodedIdToken,
  referralCode?: string,
  currentUserId?: number,
  /**
   * F-003 (security audit 004) — when a single link candidate is found
   * and the caller has NOT supplied a consent token, this function
   * throws `LinkConsentRequiredError` carrying a freshly-issued token.
   * The frontend confirms with the user, then re-submits the same
   * Firebase ID token PLUS this token — pass it in `linkConsentToken`
   * on the second call. The token is one-shot (Redis GETDEL); after
   * consumption the link is committed in the same transaction.
   */
  linkConsentToken?: string,
): Promise<FirebaseSessionResult> {
  const uid = decoded.uid;
  if (!uid) throw new FirebaseAuthError(401, "رمز Firebase غير صالح");

  const provider = getProvider(decoded);
  const providerUid = getProviderUid(decoded, provider);
  // Firebase Phone OTP is permanently retired — `decoded.phone_number`
  // is essentially never present anymore. The check is kept defensively
  // for legacy Google tokens that may carry a linked phone claim, but no
  // new phone-provider tokens reach this code path (rejected at the route).
  const phone = decoded.phone_number
    ? (normalizeLibyanPhone(decoded.phone_number) ??
      normalizeLibyanPhone(decoded.phone_number.replace(/^\+218/, "0")))
    : null;
  const email = typeof decoded.email === "string" ? decoded.email.toLowerCase() : null;
  const emailVerified = decoded.email_verified === true;
  const phoneVerified = !!phone;
  const displayName = typeof decoded.name === "string" ? decoded.name : null;
  const photoUrl = typeof decoded.picture === "string" ? decoded.picture : null;
  const now = new Date();

  // 1. Check if this Firebase UID is already linked to a user
  const [existingByFirebaseUid] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.firebaseUid, uid))
    .limit(1);

  if (existingByFirebaseUid) {
    if (currentUserId && existingByFirebaseUid.id !== currentUserId) {
      throw new FirebaseAuthError(409, "هذا الحساب مرتبط بمستخدم آخر بالفعل");
    }

    const [updated] = await updateUserIdentity(existingByFirebaseUid.id, {
      uid,
      provider,
      providerUid,
      phone,
      email,
      emailVerified,
      phoneVerified,
      displayName,
      photoUrl,
      now,
    });
    await upsertIdentity(
      updated.id,
      provider,
      providerUid,
      uid,
      phone,
      email,
      emailVerified,
      phoneVerified,
      now,
    );
    return { user: updated, isNewUser: false, provider };
  }

  // 2. If currentUserId is provided, link this new identity to them
  if (currentUserId) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId))
      .limit(1);
    if (!user) throw new FirebaseAuthError(404, "المستخدم غير موجود");

    const [updated] = await updateUserIdentity(user.id, {
      uid,
      provider,
      providerUid,
      phone,
      email,
      emailVerified,
      phoneVerified,
      displayName,
      photoUrl,
      now,
    });
    await upsertIdentity(
      updated.id,
      provider,
      providerUid,
      uid,
      phone,
      email,
      emailVerified,
      phoneVerified,
      now,
    );
    return { user: updated, isNewUser: false, provider };
  }

  // 3. Search for existing users that match this identity
  const candidates = await findLinkCandidates(
    uid,
    provider,
    providerUid,
    phone,
    email,
    emailVerified,
  );
  if (candidates.length > 1) {
    throw new FirebaseAuthError(
      409,
      "تعارض في بيانات الحساب. يرجى التواصل مع الدعم لربط الحساب بأمان",
    );
  }

  if (candidates.length === 1) {
    const candidate = candidates[0]!;

    // F-003 (security audit 004) — auto-linking on a single match
    // without explicit consent was the failure mode. Two paths:
    //
    //   1. Caller supplied a consent token from a previous 409
    //      response → consume it (validates candidate id + firebase
    //      UID match against issuance) and proceed with the link.
    //
    //   2. No token supplied → issue one bound to this exact
    //      (candidate, firebase UID) pair and throw
    //      LinkConsentRequiredError with a masked hint. The frontend
    //      shows a modal; on confirm it re-calls this endpoint with
    //      the consent token.
    if (linkConsentToken) {
      try {
        await consumeConsentToken(linkConsentToken, {
          candidateUserId: candidate.id,
          firebaseUid: uid,
        });
      } catch (err) {
        if (err instanceof ConsentTokenError) {
          // Bubble up as a Firebase-flavoured error so the route's
          // existing error handler maps it to the right HTTP shape.
          throw new FirebaseAuthError(err.statusCode, err.message);
        }
        throw err;
      }
    } else {
      const token = await issueConsentToken({
        candidateUserId: candidate.id,
        firebaseUid: uid,
      });
      logger.info(
        {
          candidate_user_id: candidate.id,
          firebase_provider: provider,
          // Length only — never log the token itself or the raw email.
          link_token_length: token.length,
        },
        "F-003 link consent token issued",
      );
      throw new LinkConsentRequiredError(token, {
        maskedEmail: maskEmail(candidate.email),
        maskedPhone: maskPhone(candidate.phone),
      });
    }

    const [updated] = await updateUserIdentity(candidate.id, {
      uid,
      provider,
      providerUid,
      phone,
      email,
      emailVerified,
      phoneVerified,
      displayName,
      photoUrl,
      now,
    });
    await upsertIdentity(
      updated.id,
      provider,
      providerUid,
      uid,
      phone,
      email,
      emailVerified,
      phoneVerified,
      now,
    );
    logger.info(
      { user_id: updated.id, firebase_provider: provider },
      "F-003 account-link committed with consent",
    );
    return { user: updated, isNewUser: false, provider };
  }

  // 4. Create new user if no match found
  let referredById: number | undefined;
  if (referralCode) {
    const [referrer] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.referralCode, referralCode))
      .limit(1);
    if (referrer) referredById = referrer.id;
  }

  const phoneValue = phone ?? firebasePhonePlaceholder(uid);
  const [created] = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(usersTable)
      .values({
        phone: phoneValue,
        firebaseUid: uid,
        googleId: provider === "google.com" ? providerUid : undefined,
        email,
        emailVerified,
        phoneVerified,
        displayName,
        photoUrl,
        authProvider: provider === "google.com" ? "firebase_google" : "firebase",
        lastAuthAt: now,
        referralCode: generateReferralCode(),
        referredBy: referredById,
        walletBalance: referredById ? "5.00" : "0.00",
      })
      .returning();

    if (referredById && referredById !== u.id) {
      await insertReferralSignupLedger(tx as unknown as typeof db, u.id);
    }

    return [u];
  });

  if (referredById && referredById !== created.id) {
    await db
      .insert(referralEventsTable)
      .values({ referrerId: referredById, refereeId: created.id, status: "pending" })
      .onConflictDoNothing();
  }

  await upsertIdentity(
    created.id,
    provider,
    providerUid,
    uid,
    phone,
    email,
    emailVerified,
    phoneVerified,
    now,
  );
  return { user: created, isNewUser: true, provider };
}

function getProvider(decoded: DecodedIdToken) {
  const provider = decoded.firebase?.sign_in_provider;
  return typeof provider === "string" && provider.length > 0 ? provider : "firebase";
}

function getProviderUid(decoded: DecodedIdToken, provider: string) {
  const identities = (decoded.firebase?.identities ?? {}) as Record<string, unknown>;
  const values = identities[provider];
  if (Array.isArray(values) && values.length > 0 && typeof values[0] === "string") return values[0];
  return decoded.uid;
}

function firebasePhonePlaceholder(uid: string) {
  return `f_${createHash("sha256").update(uid).digest("hex").slice(0, 18)}`;
}

async function findLinkCandidates(
  uid: string,
  provider: string,
  providerUid: string,
  phone: string | null,
  email: string | null,
  emailVerified: boolean,
) {
  const users = new Map<number, typeof usersTable.$inferSelect>();

  // Match by users table columns
  const userConditions = [eq(usersTable.firebaseUid, uid)];
  if (phone) userConditions.push(eq(usersTable.phone, phone));
  if (provider === "google.com") userConditions.push(eq(usersTable.googleId, providerUid));
  if (email && emailVerified) userConditions.push(eq(usersTable.email, email));

  const userRows = await db
    .select()
    .from(usersTable)
    .where(or(...userConditions));
  for (const row of userRows) users.set(row.id, row);

  // Match by user_auth_identities table
  const identityConditions = [
    eq(userAuthIdentitiesTable.firebaseUid, uid),
    and(
      eq(userAuthIdentitiesTable.provider, provider),
      eq(userAuthIdentitiesTable.providerUid, providerUid),
    ),
  ];
  if (phone) identityConditions.push(eq(userAuthIdentitiesTable.phone, phone));
  if (email && emailVerified) identityConditions.push(eq(userAuthIdentitiesTable.email, email));

  const identityRows = await db
    .select({ userId: userAuthIdentitiesTable.userId })
    .from(userAuthIdentitiesTable)
    .where(or(...identityConditions));

  if (identityRows.length > 0) {
    const matchedUserIds = identityRows.map((r) => r.userId);
    // Round-3 (8-c §3.1): N+1 on the LOGIN path — one select per matched
    // identity user. One inArray() batch instead; login latency is the
    // one place every millisecond is user-visible.
    const unseen = matchedUserIds.filter((id) => !users.has(id));
    if (unseen.length > 0) {
      const rows = await db.select().from(usersTable).where(inArray(usersTable.id, unseen));
      for (const user of rows) users.set(user.id, user);
    }
  }

  return [...users.values()];
}

async function updateUserIdentity(
  userId: number,
  data: {
    uid: string;
    provider: string;
    providerUid: string;
    phone: string | null;
    email: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    displayName: string | null;
    photoUrl: string | null;
    now: Date;
  },
) {
  return db
    .update(usersTable)
    .set({
      firebaseUid: data.uid,
      googleId: data.provider === "google.com" ? data.providerUid : undefined,
      email: data.email ?? undefined,
      emailVerified: data.emailVerified,
      phoneVerified: data.phoneVerified,
      displayName: data.displayName ?? undefined,
      photoUrl: data.photoUrl ?? undefined,
      authProvider: data.provider === "google.com" ? "firebase_google" : "firebase",
      lastAuthAt: data.now,
    })
    .where(eq(usersTable.id, userId))
    .returning();
}

async function upsertIdentity(
  userId: number,
  provider: string,
  providerUid: string,
  firebaseUid: string,
  phone: string | null,
  email: string | null,
  emailVerified: boolean,
  phoneVerified: boolean,
  now: Date,
) {
  const fallbackUid = `${firebaseUid}:${randomBytes(4).toString("hex")}`;
  await db
    .insert(userAuthIdentitiesTable)
    .values({
      userId,
      provider,
      providerUid: providerUid || fallbackUid,
      firebaseUid,
      phone,
      email,
      emailVerified,
      phoneVerified,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [userAuthIdentitiesTable.provider, userAuthIdentitiesTable.providerUid],
      set: { userId, firebaseUid, phone, email, emailVerified, phoneVerified, lastSeenAt: now },
    });
}
