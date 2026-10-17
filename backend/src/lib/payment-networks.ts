/**
 * R158 (B-F4): the payment-network registry — ONE map for what was
 * previously three hand-synced registrations:
 *
 *   1. the creation allowlist (the B2-F2 400 gate on payment_network,
 *      consumed by TopupService.createPendingTopup);
 *   2. the operator-card labels (telegram.ts notifyNewTopup's «الشبكة»
 *      line, A8 F1);
 *   3. the allowlist-honesty copy of the 400 message (L8a residual,
 *      R127-L11).
 *
 * Key = the canonical (normalized: trimmed + lowercased) network slug
 * stored in wallet_topups.payment_network; value = the Arabic
 * operator-facing label. The allowlist Set derives from the map keys.
 *
 * The 400 message is deliberately NOT composed from the map values: the
 * message lists the SHORT network names («ليبيانا، مدار، سداد، LyPay»)
 * while the operator-card label for lypay is «LyPay (تحويل مصرفي)» —
 * composing from the map would CHANGE the user-facing copy on a money
 * path, so the exact rendered text is kept as a constant below
 * (byte-identical to the pre-R158 wallet.ts literal: same wording, same
 * order). Byte-identity was chosen over derivation.
 */
export const PAYMENT_NETWORKS: Record<string, string> = {
  libyana: "ليبيانا",
  madar: "مدار",
  lypay: "LyPay (تحويل مصرفي)",
  sadad: "سداد",
};

/**
 * B2-F2 (R111, round-111 B2 audit): wallet_topups.payment_network is
 * varchar(50) with NO schema bound, and the field was free-form — an
 * over-long or arbitrary string 500'd (22001) on the money path instead
 * of answering 400. Allowlist = the networks the wallet UI offers plus
 * every value present in the live table (verified 2026-09-24):
 * libyana / madar (frontend), sadad + lypay (legacy rows). Normalized
 * (trimmed + lowercased) BEFORE the membership check so " Madar " is
 * canonicalized, not rejected — the same normalization discipline the
 * payment_reference F-03 fix applies.
 */
export const PAYMENT_NETWORK_ALLOWLIST = new Set(Object.keys(PAYMENT_NETWORKS));

/**
 * The 400 copy for an off-allowlist network — byte-identical to the
 * pre-R158 literal in routes/wallet.ts (see the module header for why
 * it is a constant and not derived from PAYMENT_NETWORKS).
 */
export const PAYMENT_NETWORK_INVALID_MESSAGE =
  "شبكة الدفع غير صالحة (المسموح: ليبيانا، مدار، سداد، LyPay)";
