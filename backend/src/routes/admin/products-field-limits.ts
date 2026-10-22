/**
 * R143 (L16-1): the pure field-bound validators extracted from
 * routes/admin/products.ts (the r137 orders-meta.ts precedent) — the
 * parent route crossed the 1,000-line ceiling mid-round (993 → 1,021)
 * and this was the only React-free, dependency-free cohesive block to
 * lift. Behavior byte-identical; the doc comments ride along verbatim
 * (they ARE the contract).
 */

/**
 * B2-F3 (R111, round-111 B2 audit): the generated Create/UpdateProductBody
 * schemas carry no string bounds, but products.name / category / image_url
 * are varchar(255/100/1000) — an over-long value 500'd (22001) instead of
 * answering 400. Handler-enforced bounds (the wallet.ts payment_reference
 * pattern): the generated zod stays the looser outer perimeter, the
 * handler enforces the COLUMN-aligned semantic bound with a clear Arabic
 * message. product-variants.ts already bounds its labels/sku the same
 * way — this closes the inconsistency the audit flagged.
 */
const PRODUCT_FIELD_LIMITS = {
  name: { max: 255, label: "اسم المنتج" },
  category: { max: 100, label: "الفئة" },
  image_url: { max: 1000, label: "رابط الصورة" },
} as const;

/** Returns an Arabic field error for the first over-limit string, else null. */
export function productFieldError(
  fields: Partial<Record<keyof typeof PRODUCT_FIELD_LIMITS, string | null | undefined>>,
): string | null {
  for (const key of Object.keys(PRODUCT_FIELD_LIMITS) as Array<keyof typeof PRODUCT_FIELD_LIMITS>) {
    const value = fields[key];
    const { max, label } = PRODUCT_FIELD_LIMITS[key];
    if (typeof value === "string" && value.length > max) {
      return `${label} طويل جداً (الحد الأقصى ${max} حرف)`;
    }
  }
  return null;
}

/**
 * R119-B1 (A1 F-4): the R118 crypto v2 format ("v2:iv:tag:ct") is 3 chars
 * longer than v1 at the same plaintext length. Its fixed overhead is 61
 * chars ("v2:" 3 + hex IV 24 + ":" + hex auth tag 32 + ":"), so a
 * varchar(512) inventory.account_password column fits 61 + 2L ≤ 512 →
 * L ≤ 225 plaintext chars (v1 fit 227). Fresh ingest had NO length cap —
 * a 226/227-char password encrypted fine, then 500'd (22001) at the
 * INSERT. Handler-enforced bound, the same B2-F3 discipline as
 * PRODUCT_FIELD_LIMITS above; the v1→v2 re-encrypt job length-guards the
 * legacy rows separately (jobs/reencrypt-v1-credentials.ts).
 */
export const ACCOUNT_PASSWORD_PLAINTEXT_MAX = 225;
