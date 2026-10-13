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

// ═══════════════════════════════════════════════════════════════════════════
// R132 — the structured expansion: categories, mixed script, modifiers,
// compounds, and the exact-match-first ranking inputs. Every case is
// derived from the REAL catalog (docs/SEO_PRODUCTS.json, 45 products)
// and the live category enum (frontend/src/lib/categories.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { expandArabicSearch } from "../arabic-search";

describe("expandArabicSearch (R132) — category intent", () => {
  it.each([
    // (category words — the route ORs `category = slug` branches)
    ["افلام", "streaming"],
    ["مسلسلات", "streaming"],
    ["الافلام", "streaming"], // definite article — containment path
    ["موسيقى", "music"],
    ["اغاني", "music"],
    ["برامج", "software"],
    ["تطبيقات", "software"],
    ["مفاتيح", "software"],
    ["ذكاء اصطناعي", "ai-tools"], // multi-word phrase
    ["ذكاءاصطناعي", "ai-tools"], // …typed without a space
    ["سيو", "seo-tools"],
    ["ادوات سيو", "seo-tools"],
    ["تعليم", "education"],
    ["كورسات", "education"],
    ["كتب", "education"],
    ["في بي ان", "vpn"],
    ["فيبيان", "vpn"], // collapsed form of the phrase
    ["برايفت", "vpn"],
  ])("expandArabicSearch(%j).categories → [%j]", (query, slug) => {
    expect(expandArabicSearch(query).categories).toContain(slug);
  });

  it("a category word also keeps the brand-name terms it maps to («في بي ان» carries the R122 name alias)", () => {
    const exp = expandArabicSearch("في بي ان");
    expect(exp.nameTerms).toContain("vpn");
    expect(exp.categories).toContain("vpn");
  });

  it("category words emit NO transliteration skeletons (a skeleton can never name a category)", () => {
    const exp = expandArabicSearch("افلام");
    expect(exp.categories).toEqual(["streaming"]);
    expect(exp.nameTerms).toEqual([]);
  });
});

describe("expandArabicSearch (R132) — mixed-script queries", () => {
  it("«netflix اشتراك» rides the Latin token as its own ILIKE branch (the raw whole-string ILIKE can never match)", () => {
    const exp = expandArabicSearch("netflix اشتراك");
    expect(exp.latinTerms).toEqual(["netflix"]);
    // the Arabic filler still yields its skeleton
    expect(exp.nameTerms).toContain("ashtrak");
  });

  it("«نتفلكس 4k» rides the mixed digit-letter token", () => {
    const exp = expandArabicSearch("نتفلكس 4k");
    expect(exp.nameTerms).toContain("netflix");
    expect(exp.latinTerms).toEqual(["4k"]);
  });

  it("a Latin twin of an Arabic alias does not mint a duplicate branch («netflix نتفلكس»)", () => {
    const exp = expandArabicSearch("netflix نتفلكس");
    expect(exp.latinTerms).toEqual([]); // "netflix" already a nameTerm
    expect(exp.nameTerms).toEqual(["netflix"]);
  });

  it("pure-digit tokens are compound refinements, never standalone OR noise", () => {
    const exp = expandArabicSearch("نتفلكس 12 شهر");
    expect(exp.latinTerms).toEqual([]);
    expect(exp.compounds).toEqual([{ brand: "netflix", modifier: "month", digits: "12" }]);
  });

  it("Arabic-Indic digits fold before the digit refinement («نتفلكس ١٢ شهر»)", () => {
    expect(expandArabicSearch("نتفلكس ١٢ شهر").compounds).toEqual([
      { brand: "netflix", modifier: "month", digits: "12" },
    ]);
  });

  it("pure-English queries expand to NOTHING — the R122 byte-identical SQL invariant", () => {
    for (const q of ["netflix premium", "NETFLIX", "windows 10", "100%", ""]) {
      expect(expandArabicSearch(q)).toEqual({
        nameTerms: [],
        categories: [],
        latinTerms: [],
        compounds: [],
        variantTerms: [],
      });
    }
  });
});

describe("expandArabicSearch (R132) — modifiers + compound branches", () => {
  it("duration words map to the catalog's name fragments", () => {
    expect(expandArabicSearch("شهر").nameTerms).toEqual(["month"]);
    expect(expandArabicSearch("سنة").nameTerms).toEqual(["year"]); // ta-marbuta folded
    expect(expandArabicSearch("سنوي").nameTerms).toEqual(["year"]);
    expect(expandArabicSearch("اسبوع").nameTerms).toEqual(["week"]);
    expect(expandArabicSearch("يوم").nameTerms).toEqual(["day"]);
  });

  it("tier words map to the catalog's tier fragments", () => {
    expect(expandArabicSearch("بريميوم").nameTerms).toEqual(["premium"]);
    expect(expandArabicSearch("برو").nameTerms).toEqual(["pro"]);
    expect(expandArabicSearch("بلس").nameTerms).toEqual(["plus"]);
  });

  it("«نتفلكس شهر» → one compound AND branch + both plain terms", () => {
    const exp = expandArabicSearch("نتفلكس شهر");
    expect(exp.compounds).toEqual([{ brand: "netflix", modifier: "month" }]);
    expect(exp.nameTerms).toEqual(["netflix", "month"]);
  });

  it("«نتفلكس بريميوم» compounds brand × tier", () => {
    expect(expandArabicSearch("نتفلكس بريميوم").compounds).toEqual([
      { brand: "netflix", modifier: "premium" },
    ]);
  });

  it("a modifier-only query never mints a self-compound («شهر» has no brand side)", () => {
    const exp = expandArabicSearch("شهر");
    expect(exp.compounds).toEqual([]);
    expect(exp.nameTerms).toEqual(["month"]);
  });

  it("two brands × one modifier stay bounded and pair with the modifier each", () => {
    const exp = expandArabicSearch("نتفلكس ديزني شهر");
    expect(exp.compounds).toEqual([
      { brand: "netflix", modifier: "month" },
      { brand: "disney", modifier: "month" },
    ]);
  });

  it("skeletons never act as the brand side of a compound", () => {
    // «خضار شهر» — an unmatched Arabic word + a modifier: no compound
    // (the skeleton "khsar" must not mint "khsar ∧ month").
    const exp = expandArabicSearch("خضار شهر");
    expect(exp.compounds).toEqual([]);
    expect(exp.nameTerms).toContain("month");
    expect(exp.nameTerms).toContain("khsar");
  });
});

describe("expandArabicSearch (R132) — R132 Libyan brand variants", () => {
  it.each([
    ["نفليكس", "netflix"], // transposed لا
    ["يوتيب", "youtube"],
    ["سيمرش", "semrush"],
    ["سكريبد", "scribd"],
    ["سيلنج", "sling"],
    ["تيدال", "tidal"],
  ])("expandArabicSearchTerms(%j) → [%j]", (query, term) => {
    expect(expandArabicSearchTerms(query)).toEqual([term]);
  });
});

describe("expandArabicSearch (R142 I-1) — multi-word phrases survive rider tokens", () => {
  it("«اشتراك شات جي بي تي» (a filler word before the phrase) resolves ChatGPT", () => {
    const exp = expandArabicSearch("اشتراك شات جي بي تي");
    expect(exp.nameTerms).toContain("chatgpt");
    // the filler keeps its skeleton (R122 behavior for «اشتراك نتفلكس»),
    // the phrase words must NOT mint «جي»/«بي»/«تي» skeleton noise.
    expect(exp.nameTerms.filter((t) => ["jy", "by", "ty", "jyb", "jyby"].includes(t))).toEqual([]);
  });

  it("«شات جي بي تي برو» (a modifier after the phrase) → the chatgpt ∧ pro compound", () => {
    const exp = expandArabicSearch("شات جي بي تي برو");
    expect(exp.nameTerms).toContain("chatgpt");
    expect(exp.compounds).toEqual([{ brand: "chatgpt", modifier: "pro" }]);
  });

  it("«في بي ان سنوي» resolves the vpn phrase beside a duration word", () => {
    const exp = expandArabicSearch("في بي ان سنوي");
    expect(exp.nameTerms).toContain("vpn");
    expect(exp.variantTerms).toContain("سنوي");
  });

  it("a rider word that breaks the phrase still keeps the existing single-token behavior (no false phrase)", () => {
    // «جي بي» is NOT a key — the tokens fall to skeletons exactly as R132 did.
    const exp = expandArabicSearch("جي بي");
    expect(exp.nameTerms.every((t) => t !== "chatgpt")).toBe(true);
  });

  it("the whole-query phrase path still wins when the query IS the phrase (skeleton suppression kept)", () => {
    const exp = expandArabicSearch("شات جي بي تي");
    expect(exp.nameTerms).toEqual(["chatgpt"]);
  });

  it("a multi-word CATEGORY phrase rides along a filler word («اشتراك ادوات سيو»)", () => {
    const exp = expandArabicSearch("اشتراك ادوات سيو");
    expect(exp.categories).toContain("seo-tools");
  });
});

describe("expandArabicSearch (R142 I-2) — duration tokens for the variant-label EXISTS branch", () => {
  it("duration words emit their Arabic token (+ ta-marbuta twin) as variantTerms", () => {
    expect(expandArabicSearch("شهر").variantTerms).toEqual(["شهر"]);
    // «سنة» normalizes to «سنه» — the ة twin keeps the live label spelling
    // («سنة كاملة») reachable.
    expect(expandArabicSearch("سنة").variantTerms).toEqual(["سنه", "سنة"]);
    expect(expandArabicSearch("شهر واحد").variantTerms).toEqual(["شهر"]);
  });

  it("tier modifiers emit NO variantTerms (durations are the variant-axis words)", () => {
    expect(expandArabicSearch("برو").variantTerms).toEqual([]);
    expect(expandArabicSearch("بريميوم").variantTerms).toEqual([]);
  });

  it("variantTerms stay bounded for an adversarial many-modifier query", () => {
    const exp = expandArabicSearch("شهر سنه اسبوع يوم برو بلس");
    expect(exp.variantTerms.length).toBeLessThanOrEqual(6);
  });
});

describe("expandArabicSearch (R132) — adversarial bounds", () => {
  it("every output family is hard-capped for a 20-token adversarial query", () => {
    const tokens = [
      "نتفلكس",
      "ديزني",
      "شهر",
      "سنه",
      "افلام",
      "موسيقى",
      "برامج",
      "تعليم",
      "سيو",
      "كتب",
      "كورسات",
      "دورات",
      "قمر",
      "شمس",
      "بحر",
      "نجم",
      "رمل",
      "مطر",
      "غيم",
      "ثلج",
    ];
    const exp = expandArabicSearch(
      tokens.join(" ") + " netflix disney hbo hulu prime extra1 extra2",
    );
    expect(exp.categories.length).toBeLessThanOrEqual(3);
    expect(exp.latinTerms.length).toBeLessThanOrEqual(4);
    expect(exp.compounds.length).toBeLessThanOrEqual(4);
    // name terms keep the R122 ≤12 bound (8 tokens considered, ≤3 skeletons)
    expect(exp.nameTerms.length).toBeLessThanOrEqual(12);
  });
});
