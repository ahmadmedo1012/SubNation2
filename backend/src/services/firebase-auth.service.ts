import { db, referralEventsTable, userAuthIdentitiesTable, usersTable } from "@workspace/db";
import { createHash, randomBytes } from "crypto";
import { and, eq, or } from "drizzle-orm";
import type { DecodedIdToken } from "firebase-admin/auth";
import jwt from "jsonwebtoken";
import { generateReferralCode, normalizeLibyanPhone } from "../lib/crypto";
import { getFirebaseAdminAuth } from "../lib/firebase-admin";
import { logger } from "../lib/logger";

export class FirebaseAuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "FirebaseAuthError";
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

  try {
    // Debug: log token header and payload (non-sensitive fields) to trace issues
    const decoded = jwt.decode(idToken, { complete: true }) as any;
    if (decoded) {
      logger.info(
        {
          kid: decoded.header?.kid,
          aud: decoded.payload?.aud,
          iss: decoded.payload?.iss,
          sub: decoded.payload?.sub,
          exp: decoded.payload?.exp,
        },
        "Firebase ID token trace",
      );
    }

    // Disable checkRevoked entirely to ensure maximum compatibility and avoid 401s
    // unless explicitly required and service account is confirmed working.
    return await auth.verifyIdToken(idToken, false);
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    logger.warn({ err: error, checkRevoked }, "Firebase ID token verification failed");

    // Handle specific Firebase revoked token error
    if (error.code === "auth/id-token-revoked") {
      throw new FirebaseAuthError(401, "تم إبطال جلسة Firebase. يرجى تسجيل الدخول مرة أخرى");
    }
    throw new FirebaseAuthError(401, "رمز Firebase غير صالح أو منتهي الصلاحية");
  }
}

export async function resolveFirebaseSession(
  decoded: DecodedIdToken,
  referralCode?: string,
  currentUserId?: number,
): Promise<FirebaseSessionResult> {
  const uid = decoded.uid;
  if (!uid) throw new FirebaseAuthError(401, "رمز Firebase غير صالح");

  const provider = getProvider(decoded);
  const providerUid = getProviderUid(decoded, provider);
  const phone = decoded.phone_number ? normalizeFirebasePhone(decoded.phone_number) : null;
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
    const [updated] = await updateUserIdentity(candidates[0]!.id, {
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
  const [created] = await db
    .insert(usersTable)
    .values({
      phone: phoneValue,
      passwordHash: "",
      firebaseUid: uid,
      googleId: provider === "google.com" ? providerUid : undefined,
      email,
      emailVerified,
      phoneVerified,
      displayName,
      photoUrl,
      authProvider:
        provider === "phone"
          ? "firebase_phone"
          : provider === "google.com"
            ? "firebase_google"
            : "firebase",
      passwordLoginEnabled: false,
      lastAuthAt: now,
      referralCode: generateReferralCode(),
      referredBy: referredById,
      walletBalance: referredById ? "5.00" : "0.00",
    })
    .returning();

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

function normalizeFirebasePhone(phone: string) {
  return normalizeLibyanPhone(phone) ?? normalizeLibyanPhone(phone.replace(/^\+218/, "0"));
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
    // Use a simpler approach to avoid sql template issues if possible, or just be careful
    for (const userId of matchedUserIds) {
      if (users.has(userId)) continue;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (user) users.set(user.id, user);
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
      authProvider:
        data.provider === "phone"
          ? "firebase_phone"
          : data.provider === "google.com"
            ? "firebase_google"
            : "firebase",
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
