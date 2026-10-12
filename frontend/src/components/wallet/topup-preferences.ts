// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the topup form's localStorage preference/sender-phone helpers moved to
// their own module so the page file shrinks to orchestration. Pure
// functions over localStorage; ZERO React, zero behavior change (the
// page imports them by name — every key and call site stays
// byte-identical).

/** 93-C5 / F-03: the review-queue cap the pending gate enforces. */
export const MAX_PENDING = 3;

// LocalStorage keys
const STORAGE_KEYS = {
  SENDER_PHONES: "subnation_saved_sender_phones",
  TOPUP_PREFERENCES: "subnation_topup_preferences",
};

// Get saved sender phones from localStorage
export function getSavedSenderPhones(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SENDER_PHONES);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// Save sender phone to localStorage
export function saveSenderPhone(phone: string) {
  const phones = getSavedSenderPhones();
  if (!phones.includes(phone)) {
    phones.unshift(phone);
    if (phones.length > 5) phones.pop(); // Keep only last 5
    localStorage.setItem(STORAGE_KEYS.SENDER_PHONES, JSON.stringify(phones));
  }
}

// Get saved topup preferences. `method` is included so a user who
// previously chose LyPay doesn't have to re-pick mobile_transfer
// every visit — the wallet form remembers their last choice.
export function getTopupPreferences() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.TOPUP_PREFERENCES);
    return saved
      ? JSON.parse(saved)
      : { network: "libyana", amount: "", method: "mobile_transfer" };
  } catch {
    return { network: "libyana", amount: "", method: "mobile_transfer" };
  }
}

// Save topup preferences
export function saveTopupPreferences(network: string, amount: string, method: string) {
  localStorage.setItem(STORAGE_KEYS.TOPUP_PREFERENCES, JSON.stringify({ network, amount, method }));
}
