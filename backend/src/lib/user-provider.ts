/**
 * Derive a single primary-provider tag from a user's identity columns.
 *
 * Used by the Telegram notification helpers to surface "where did this
 * user sign up" in operator-facing messages. Order matters — telegramId
 * wins over firebaseUid because Telegram-bot sign-in is the more
 * specific signal (a user can have BOTH columns populated if they
 * later linked Telegram, but we want to show their original entry
 * channel).
 *
 * Why a helper: the same 3-branch ternary was repeated in routes/auth.ts,
 * routes/orders.ts, and routes/wallet.ts. One source of truth means
 * future provider additions (e.g. WhatsApp Cloud API) need a single
 * code change.
 */
export function derivePrimaryProvider(user: {
  telegramId?: string | null;
  firebaseUid?: string | null;
}): "telegram" | "firebase" | "phone" {
  if (user.telegramId) return "telegram";
  if (user.firebaseUid) return "firebase";
  return "phone";
}
