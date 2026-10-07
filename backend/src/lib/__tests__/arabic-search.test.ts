import { describe, expect, it } from "vitest";
import {
  expandArabicSearchTerms,
  normalizeArabicText,
  transliterateArabicToLatin,
} from "../arabic-search";

/**
 * R122 (A11-F2): unit coverage for the Arabic search bridge. Everything
 * here is a pure function — table-driven and deterministic (the route
 * behavior is covered separately against the pglite harness in
 * routes/__tests__/products-arabic-search.test.ts).
 */

describe("normalizeArabicText (R122 A11-F2)", () => {
  it.each([
    // tashkeel diacritics are pronunciation marks, not searchable form
    ["نَتْفَلِكْس", "نتفلكس"],
    ["سبـُوتـِفـاي", "سبوتفاي"],
    // tanwin forms
    ["شاهِدًا", "شاهدا"],
    // tatweel (kashida) stretching
    ["نتـفـلـكـس", "نتفلكس"],
    // alef variants fold to bare alef
    ["أمازون", "امازون"],
    ["إكس", "اكس"],
    ["آيتونز", "ايتونز"],
    // ta marbuta folds to ha
    ["سحابة", "سحابه"],
    // alef maksura folds to yeh
    ["ديزنى", "ديزني"],
    // Arabic-Indic digits fold to ASCII
    ["ويندوز ١٠", "ويندوز 10"],
    ["١٢٣٤٥٦٧٨٩٠", "1234567890"],
    // Latin input passes through untouched
    ["Netflix Premium", "Netflix Premium"],
    ["", ""],
    ["   ", "   "],
  ])("normalizeArabicText(%j) → %j", (input, expected) => {
    expect(normalizeArabicText(input)).toBe(expected);
  });
});

describe("transliterateArabicToLatin (R122 A11-F2)", () => {
  it.each([
    // the two Netflix spellings differ only by the ي — skeletons keep
    // that letter but drop the short vowels Arabic script omits
    ["نتفليكس", "ntflyks"],
    ["نتفلكس", "ntflks"],
    ["سبوتفاي", "sbwtfay"],
    ["يوتيوب", "ywtywb"],
    ["ديزني", "dyzny"],
    ["واتساب", "watsab"],
    // diacritics/tatweel vanish BEFORE the letter walk
    ["نـتـفـلـكـس", "ntflks"],
    // hamza carriers
    ["اؤ", "aw"],
    ["اؤذ", "awth"],
    // mixed script: Latin + digits ride along, separators dropped
    ["Netflix 10", "netflix10"],
    ["نتفلكس 4K", "ntflks4k"],
    // non-mapped symbols are dropped from the skeleton
    ["نتفلكس+ديزني", "ntflksdyzny"],
    ["", ""],
  ])("transliterateArabicToLatin(%j) → %j", (input, expected) => {
    expect(transliterateArabicToLatin(input)).toBe(expected);
  });
});

describe("expandArabicSearchTerms (R122 A11-F2)", () => {
  it.each([
    // ── the live defect (r122-a11 §P1-1): both Netflix spellings ──
    ["نتفليكس", ["netflix"]],
    ["نتفلكس", ["netflix"]],
    ["نفلكس", ["netflix"]],
    // the site's hero chips resolve too
    ["سبوتفاي", ["spotify"]],
    ["سبوتيفاي", ["spotify"]],
    ["ديزني", ["disney"]],
    ["يوتيوب", ["youtube"]],
    ["شاهد", ["shahid"]],
    // catalog brands the SEO keyword set says users type
    ["هولمارك", ["hallmark"]],
    ["باراماونت", ["paramount"]],
    ["اكسبرس", ["expressvpn"]],
    ["جرامرلي", ["grammarly"]],
    ["ويندوز", ["windows"]],
    ["تخزين", ["cloud storage"]],
    ["امازون", ["prime video"]], // the only Amazon product here is Prime Video
    ["بلاستيشن", ["playstation"]],
    ["بلايستيشن", ["playstation"]],
    ["واتس", ["whatsapp"]],
    ["اكس", ["xbox"]],
    // ── normalization is applied to the query before matching ──
    ["نـتـفـلـكـس", ["netflix"]], // tatweel
    ["نَتْفَلِكْس", ["netflix"]], // diacritics
    ["إكسبرس", ["expressvpn"]], // hamza-on-alef variant
    // ── containment: the definite article + spaceless compounds ──
    ["النتفلكس", ["netflix"]],
    ["نتفلكسبريميوم", ["netflix"]],
    ["اشتراكنتفلكس", ["netflix"]],
    // 3-char exact-only aliases never fire inside longer words
    // («اكسبرس» is ExpressVPN, not Xbox)
    ["اكسبرس", ["expressvpn"]],
    // ── multi-word queries ──
    ["اشتراك نتفلكس", ["ashtrak", "netflix"]], // unrecognized word → skeleton
    ["نتفلكس ديزني", ["netflix", "disney"]], // both brands, token order kept
    // multi-word alias typed with spaces resolves as ONE phrase
    // (and suppresses per-token skeleton noise)
    ["شات جي بي تي", ["chatgpt"]],
    ["اتش بي او", ["hbo"]],
    ["في بي ان", ["vpn"]],
    // …and spaceless, via the collapsed key
    ["شاتجيبيتي", ["chatgpt"]],
    ["فيبيان", ["vpn"]],
    // ── mixed script: Arabic token expands, Latin token untouched ──
    ["netflix نتفلكس", ["netflix"]],
    // ── pure-English and empty inputs expand to NOTHING (SQL identical
    //    to the pre-R122 behavior — English search cannot regress) ──
    ["netflix", []],
    ["netflix premium", []],
    ["NETFLIX", []],
    ["", []],
    ["   ", []],
    ["%%%", []],
    ["100%", []],
  ])("expand(%j) → %j", (query, expected) => {
    expect(expandArabicSearchTerms(query)).toEqual(expected);
  });

  it("unrecognized Arabic words yield only their Latin skeleton (garbage in → inert terms out)", () => {
    // A garbage query must not resolve to a catalog brand; the skeletons
    // match no English name, which is why the route returns [] cleanly.
    const terms = expandArabicSearchTerms("خضار طازج");
    expect(terms).toEqual(["khsar", "tazj"]);
    expect(terms.every((t) => t !== "netflix" && t !== "disney")).toBe(true);
  });

  it("deduplicates repeated brand hits", () => {
    expect(expandArabicSearchTerms("نتفلكس نتفليكس نفلكس")).toEqual(["netflix"]);
  });

  it("bounds the expansion (B6-02 DoS class: no unbounded OR chain from a long query)", () => {
    // 20 distinct Arabic tokens — only the first 8 are considered and at
    // most 3 skeletons are emitted, so the OR chain stays ≤ 12 terms.
    const tokens = [
      "نتفلكس",
      "ديزني",
      "هولو",
      "اوسن",
      "فوكس",
      "شادر",
      "تايدل",
      "كوبوز",
      "نابستر",
      "باندورا",
      "قمر",
      "شمس",
      "بحر",
      "نجم",
      "رمل",
      "مطر",
      "غيم",
      "ثلج",
      "ريح",
      "نار",
    ];
    const terms = expandArabicSearchTerms(tokens.join(" "));
    // 8 alias hits (the first 8 tokens are all mapped brands)
    expect(terms).toEqual(["netflix", "disney", "hulu", "osn", "fox", "shudder", "tidal", "qobuz"]);
    // and the hard bound even when nothing matches (skeleton cap = 3)
    const garbage = Array.from({ length: 20 }, (_, i) => `كلمة${i}زل`).join(" ");
    expect(expandArabicSearchTerms(garbage).length).toBeLessThanOrEqual(12);
  });
});
