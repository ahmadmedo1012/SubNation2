// Libyan mobile phone validation
// Valid prefixes: 091, 092, 093, 094 (Libyana & Almadar)
// Total: 10 digits (0 + prefix digit + 7 more)

export const LIBYAN_PHONE_REGEX = /^(091|092|093|094)\d{7}$/;

export function isValidLibyanPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  // normalize to 10-digit format if entered as 9
  const normalized = digits.length === 9 ? `0${digits}` : digits;
  return LIBYAN_PHONE_REGEX.test(normalized);
}

export function libyanPhoneError(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return "رقم الهاتف يجب أن يتكون من 10 أرقام";
  if (digits.length > 10) return "رقم الهاتف طويل جداً";
  if (!["091", "092", "093", "094"].some((p) => digits.startsWith(p))) {
    return "يجب أن يبدأ الرقم بـ 091 أو 092 أو 093 أو 094";
  }
  return null;
}
