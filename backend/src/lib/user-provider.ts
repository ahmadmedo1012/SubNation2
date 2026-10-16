/**
 * Derive a single primary-provider tag from a user's identity columns.
 *
 * Used by the Telegram notification helpers to surface "where did this
 * user sign up" in operator-facing messages. Order matters — the
 * auth_provider ORIGIN marker decides the WhatsApp channel first (a
 * WhatsApp signup has no telegram/firebase columns), then telegramId
 * wins over firebaseUid because Telegram-bot sign-in is the more
 * specific signal (a user can have BOTH columns populated if they
 * later linked Telegram, but we want to show their original entry
 * channel).
 *
 * Why a helper: the same 3-branch ternary was repeated in routes/auth.ts,
 * routes/orders.ts, and routes/wallet.ts. One source of truth means
 * future provider additions need a single code change. (R150: the
 * WhatsApp channel is and stays the self-hosted OpenWA linked-device
 * gateway — WhatsApp Cloud API is permanently excluded from the
 * architecture; it is not a "future provider" option.)
 *
 * R154 (P3-B): returns "whatsapp" for the WhatsApp OTP channel — it
 * used to collapse into "phone" (rendered «هاتف (Firebase)» on every
 * operator card, false information for an OpenWA signup).
 */
export function derivePrimaryProvider(user: {
  telegramId?: string | null;
  firebaseUid?: string | null;
  authProvider?: string | null;
}): "telegram" | "firebase" | "phone" | "whatsapp" {
  if (user.authProvider === "whatsapp_phone") return "whatsapp";
  if (user.telegramId) return "telegram";
  if (user.firebaseUid) return "firebase";
  return "phone";
}
