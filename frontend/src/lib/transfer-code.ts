/**
 * USSD transfer-code generator for the wallet top-up flow.
 *
 * Receiver phone is the platform's registered receiver number — the
 * wallet page already advertises it (`091-3456789`) so the value is
 * fixed here intentionally to match what the user is told in the UI.
 *
 * Libyana format:  *122*218XXXXXXXXX*AMOUNT*1#
 *   (international, drop leading 0, prefix 218)
 *   The USSD amount parameter is in MILLIMES — dinars × 1000 — and a
 *   single Libyana transfer carries at most 50 LYD (50000).
 *
 * Madar format:    *140*4*1*AMOUNT*09XXXXXXXX#
 *   (local 10-digit number)
 *   The USSD amount parameter is already in LYD (no scaling), and a
 *   single Madar transfer carries at most 20 LYD.
 *
 * R154: amounts above a network's per-transfer limit are represented as
 * MULTIPLE installments (each ≤ the limit, sum exactly the total) —
 * the plan is the one honest contract between what the customer is
 * told to dial and what the backend will be asked to credit.
 *
 * `#` is reserved in URI fragments — `tel:` URLs encode it as `%23`.
 * `*` is allowed verbatim in the `tel:` scheme.
 */

export type TransferNetwork = "libyana" | "madar";

const RECEIVER_LOCAL = "0913456789";

/** R154: per-network cap on a SINGLE telecom transfer (LYD). */
export const TRANSFER_LIMITS: Record<TransferNetwork, number> = {
  libyana: 50,
  madar: 20,
};

export interface TransferInstallment {
  /** This individual transfer's amount, whole LYD. */
  amount: number;
  /** The USSD code the customer dials for THIS individual transfer. */
  code: string;
}

export interface TransferPlan {
  /** The requested total (whole LYD) — what the top-up request submits. */
  total: number;
  /** Ordered installments; sum === total; every amount within the limit. */
  installments: TransferInstallment[];
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function toInternational(local: string): string {
  const d = digitsOnly(local);
  if (d.startsWith("218")) return d;
  if (d.startsWith("0")) return `218${d.slice(1)}`;
  return `218${d}`;
}

/**
 * Whole-dinar amount. Returns null when the input is invalid.
 *
 * R116 (P2): Math.round, not Math.floor — the wallet form snaps the
 * typed amount to an integer at blur AND submit (USSD transfer codes
 * can only carry whole dinars), so a fraction never legitimately
 * reaches this generator. Rounding (rather than flooring) keeps the
 * CODE and the SUBMITTED amount identical even if a fractional value
 * slips through a stale pref/restore path — flooring a stray "24.9"
 * would dial 24 while the request credits 24.9 (the original
 * guaranteed-mismatch defect, reintroduced one layer down).
 */
function normalizeAmount(amount: number | string): number | null {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * R154: split a total into per-transfer installments, each within the
 * network's single-transfer limit, conserving the total exactly.
 * Deterministic: maximum installments first, exact positive remainder
 * last (e.g. 75 LYD on Libyana → 50 + 25; 50 LYD on Madar → 20+20+10).
 */
export function splitInstallments(total: number, limit: number): number[] {
  if (!Number.isInteger(total) || total <= 0 || limit <= 0) return [];
  const full = Math.floor(total / limit);
  const rest = total % limit;
  const parts: number[] = Array.from({ length: full }, () => limit);
  if (rest > 0) parts.push(rest);
  return parts;
}

/**
 * R154: the full transfer plan for a top-up amount — one installment
 * when the total fits the network's limit, several when it doesn't.
 * Returns null when the amount is invalid (nothing fictitious is ever
 * rendered or dialed).
 */
export function transferPlan(
  network: TransferNetwork,
  amount: number | string,
  receiver: string = RECEIVER_LOCAL,
): TransferPlan | null {
  const total = normalizeAmount(amount);
  if (total === null) return null;

  if (network === "libyana") {
    const intl = toInternational(receiver);
    const installments = splitInstallments(total, TRANSFER_LIMITS.libyana).map((a) => ({
      amount: a,
      // USSD parameter is in millimes: dinars × 1000.
      code: `*122*${intl}*${a * 1000}*1#`,
    }));
    return installments.length > 0 ? { total, installments } : null;
  }

  if (network === "madar") {
    const local = digitsOnly(receiver);
    const installments = splitInstallments(total, TRANSFER_LIMITS.madar).map((a) => ({
      amount: a,
      // Madar's USSD amount is already LYD — never scaled.
      code: `*140*4*1*${a}*${local}#`,
    }));
    return installments.length > 0 ? { total, installments } : null;
  }

  return null;
}

/** USSD string, ready for `<a href={...}>` — `#` becomes `%23`. */
export function transferCodeTelHref(code: string): string {
  return `tel:${code.replace(/#/g, "%23")}`;
}

export const RECEIVER_PHONE = RECEIVER_LOCAL;
