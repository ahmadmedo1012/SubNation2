import { describe, expect, it } from "vitest";
import {
  arabicRatio,
  validateDescription,
  validateDescriptionLong,
  validateFaq,
} from "../validator";

/**
 * Pure-function validator tests (012-arabic-catalog-enrichment, T013).
 * Algorithm: research §R-4 (70% Arabic ratio + length bounds).
 */

describe("arabicRatio", () => {
  it("returns 0 for empty / whitespace-only strings", () => {
    expect(arabicRatio("")).toBe(0);
    expect(arabicRatio("    \n  ")).toBe(0);
  });

  it("returns 1 for pure Arabic text", () => {
    expect(arabicRatio("اشترك بأفضل الأسعار")).toBe(1);
  });

  it("returns 0 for pure Latin text", () => {
    expect(arabicRatio("Subscribe at the best price")).toBe(0);
  });

  it("ignores whitespace in the denominator", () => {
    // 5 Arabic + 5 Latin chars (ignoring spaces) → 0.5
    expect(arabicRatio("اشترك Hello")).toBeCloseTo(5 / 10, 5);
  });
});

describe("validateDescription", () => {
  const arabicShort = "اشترك واستمتع بأفضل خدمة بث في السوق الليبي بأسعار مناسبة.";

  it("passes a 50–1000 char Arabic description", () => {
    expect(validateDescription(arabicShort).ok).toBe(true);
  });

  it("rejects under 50 chars", () => {
    const r = validateDescription("اشترك");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/length/);
  });

  it("rejects English-only output", () => {
    const longEnglish = "x".repeat(200);
    const r = validateDescription(longEnglish);
    expect(r.ok).toBe(false);
  });

  it("rejects over 1000 chars", () => {
    const big = arabicShort + " اشترك ".repeat(500);
    const r = validateDescription(big);
    expect(r.ok).toBe(false);
  });
});

describe("validateDescriptionLong", () => {
  const longArabic = ("اشترك واستمتع بأفضل خدمة بث في السوق الليبي. ").repeat(8);

  it("passes a 300–8000 char Arabic long description", () => {
    expect(validateDescriptionLong(longArabic).ok).toBe(true);
  });

  it("rejects under 300 chars", () => {
    expect(validateDescriptionLong("اشترك واستمتع بالعرض").ok).toBe(false);
  });
});

describe("validateFaq", () => {
  const validFaq = [
    {
      question: "كيف أحصل على بيانات الدخول بعد الشراء؟",
      answer: "ستصلك بيانات الدخول مباشرة على بريدك الإلكتروني بعد إتمام الدفع.",
    },
    {
      question: "هل يمكنني استرجاع المبلغ؟",
      answer: "نعم، خلال ٢٤ ساعة من الشراء وقبل استخدام الحساب يمكنك طلب الاسترجاع.",
    },
  ];

  it("passes a well-formed Arabic FAQ", () => {
    expect(validateFaq(validFaq).ok).toBe(true);
  });

  it("rejects non-array input", () => {
    expect(validateFaq("not an array").ok).toBe(false);
    expect(validateFaq(null).ok).toBe(false);
  });

  it("rejects empty array", () => {
    expect(validateFaq([]).ok).toBe(false);
  });

  it("rejects entries missing question/answer fields", () => {
    expect(validateFaq([{ question: "؟" }]).ok).toBe(false);
  });

  it("rejects English-only entries", () => {
    expect(
      validateFaq([
        { question: "How do I subscribe?", answer: "Just buy and use the credentials." },
      ]).ok,
    ).toBe(false);
  });

  it("rejects too many entries", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      question: `سؤال رقم ${i} عن الخدمة؟`,
      answer: `إجابة كاملة بالعربية حول الخدمة المقدمة للعميل رقم ${i}.`,
    }));
    expect(validateFaq(many).ok).toBe(false);
  });
});
