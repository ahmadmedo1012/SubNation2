/**
 * USSD transfer-code generator for the wallet top-up flow.
 *
 * Receiver phone is the platform's registered receiver number — the
 * wallet page already advertises it (`091-3456789`) so the value is
 * fixed here intentionally to match what the user is told in the UI.
 *
 * Libyana format:  *122*218XXXXXXXXX*AMOUNT*1#
 *   (international, drop leading 0, prefix 218)
 *
 * Madar format:    *140*4*1*AMOUNT*09XXXXXXXX#
 *   (local 10-digit number)
 *
 * `#` is reserved in URI fragments — `tel:` URLs encode it as `%23`.
 * `*` is allowed verbatim in the `tel:` scheme.
 */

export type TransferNetwork = "libyana" | "madar";

const RECEIVER_LOCAL = "0913456789";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function toInternational(local: string): string {
  const d = digitsOnly(local);
  if (d.startsWith("218")) return d;
  if (d.startsWith("0")) return `218${d.slice(1)}`;
  return `218${d}`;
}

/** Whole-dinar amount string. Returns null when the input is invalid. */
function normalizeAmount(amount: number | string): string | null {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n).toString();
}

export function transferCode(
  network: TransferNetwork,
  amount: number | string,
  receiver: string = RECEIVER_LOCAL,
): string | null {
  const amt = normalizeAmount(amount);
  if (!amt) return null;

  if (network === "libyana") {
    const intl = toInternational(receiver);
    return `*122*${intl}*${amt}*1#`;
  }

  if (network === "madar") {
    const local = digitsOnly(receiver);
    return `*140*4*1*${amt}*${local}#`;
  }

  return null;
}

/** USSD string, ready for `<a href={...}>` — `#` becomes `%23`. */
export function transferCodeTelHref(code: string): string {
  return `tel:${code.replace(/#/g, "%23")}`;
}

export const RECEIVER_PHONE = RECEIVER_LOCAL;
