/**
 * R122 (A11-F2): Arabic-script search enablement for the English-named
 * catalog.
 *
 * DEFECT (live audit r122-a11 §P1-1): product names are English ("Netflix
 * Premium", "PlayStation Plus 12-Month" …) but the Libyan audience searches
 * in Arabic. The storefront's own hero copy advertises «نتفلكس، ديزني+،
 * شاهد، سبوتفاي» — and searching ANY of those returned «لا توجد منتجات
 * تطابق بحثك» (0 results, verified live: `GET /api/products?search=نتفلكس`
 * → 200 []), because the only match path was a raw ILIKE over the English
 * name column. Brand search is the highest-intent query type for this
 * market; failing it in the customer's language kills conversion.
 *
 * STRATEGY (pragmatic, catalog-bounded, deterministic — no new deps):
 *
 *   1. NORMALIZE the query (standard Arabic search normalization): strip
 *      tashkeel diacritics + tatweel, fold alef variants (أإآٱ→ا),
 *      ta marbuta (ة→ه), alef maksura (ى→ي), Arabic-Indic digits → ASCII.
 *      The product side stays untouched (English).
 *   2. Match tokens against a CURATED brand-alias map — the pragmatic
 *      core. The aliases enumerate the brands this catalog actually sells
 *      (docs/SEO_PRODUCTS.json, 45 products) plus the marketplace staples
 *      the site's own marketing names (PlayStation, Xbox, Telegram,
 *      WhatsApp, Shahid, Steam …), each mapped to the lowercase English
 *      token that ILIKEs the product NAME.
 *   3. FALLBACK transliteration: an unmatched Arabic token yields its
 *      Latin consonant skeleton (Arabic script omits short vowels, so
 *      «نتفليكس» and «نتفلكس» collapse to the same "ntflyks"), OR'd in
 *      as a best-effort literal ILIKE when ≥3 chars. The curated map is
 *      the primary mechanism; the skeleton is belt-and-braces for
 *      brand tokens not yet in the map.
 *
 * WHAT THIS IS NOT: not a phonetic/fuzzy engine and not a DB index — all
 * expansion happens on the QUERY side at request time. These helpers mint
 * NO cache keys and never touch the database; the caller
 * (routes/products.ts GET /) keeps search requests UNCACHEABLE exactly as
 * before (B6-02) and escapes every expanded term with escapeLikeTerm.
 */

// ── 1. Arabic normalization ────────────────────────────────────────────────

/**
 * R122 (A11-F2): stripped BEFORE matching — the full tashkeel set
 * (tanwin/fatha/kasra/damma/shadda/sukun + small marks + superscript alef,
 * U+064B–U+065F + U+0670) plus tatweel (ـ U+0640), the stretching kashida
 * users paste from stylized headlines. Diacritics are pronunciation marks,
 * not part of the searchable form.
 */
const STRIP_BEFORE_MATCH = /[\u064B-\u065F\u0670\u0640]/g;

/** Alef variants fold to bare alef: «أمازون» ≡ «امازون». */
const ALEF_VARIANTS = /[أإآٱ]/g;

/** Ta marbuta folds to ha: «سحابة» ≡ «سحابه». */
const TA_MARBUTA = /ة/g;

/** Alef maksura folds to yeh: «ديزنى» ≡ «ديزني». */
const ALEF_MAKSURA = /ى/g;

/** R122 (A11-F2): Arabic-Indic digits → ASCII («ويندوز ١٠» ≡ «ويندوز 10»). */
const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

/**
 * Standard Arabic search normalization — applied to the QUERY (and, at
 * module load, to the alias-map KEYS, so both sides fold identically).
 * Pure function, deterministic, no locale services.
 */
export function normalizeArabicText(input: string): string {
  return input
    .replace(STRIP_BEFORE_MATCH, "")
    .replace(ALEF_VARIANTS, "ا")
    .replace(TA_MARBUTA, "ه")
    .replace(ALEF_MAKSURA, "ي")
    .replace(/[٠-٩]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d);
}

// ── 2. Transliteration fallback ───────────────────────────────────────────

/**
 * R122 (A11-F2): best-effort Arabic-script → Latin skeleton map. Arabic
 * omits short vowels, so the output is a consonant skeleton: «نتفليكس» →
 * "ntflyks". Letter-level spelling variants («نتفلكس» has no ي →
 * "ntflks") remain distinguishable — which is exactly why the curated
 * alias map below is the PRIMARY mechanism and this skeleton is only
 * the fallback. Mirrors the design brief (ن→n, ت→t, ف→f, ل→l, ي→y,
 * ك→k, س→s, ش→sh, ذ→th, ص/ض→s, ط→t, ع→a, غ→gh …). Input is normalized
 * first, so only canonical letters ever reach this map (ة/ى/أ… are
 * pre-folded).
 */
const ARABIC_TO_LATIN: Record<string, string> = {
  ء: "", // bare hamza carries no sound of its own
  ا: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "th",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "s",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ؤ: "w",
  ئ: "y",
};

/**
 * Latin consonant skeleton of an Arabic (or mixed) string: lowercase
 * [a-z0-9] run, spaces/punctuation dropped. Deterministic table lookup —
 * no phonetic rules, no digraph guessing beyond the fixed letter map.
 */
export function transliterateArabicToLatin(input: string): string {
  let out = "";
  for (const ch of normalizeArabicText(input)) {
    const mapped = ARABIC_TO_LATIN[ch];
    if (mapped !== undefined) {
      out += mapped;
    } else if (/[a-z0-9]/i.test(ch)) {
      // R122 (A11-F2): Latin letters/digits ride along unchanged so
      // mixed-script input still yields one contiguous skeleton.
      out += ch.toLowerCase();
    }
    // Everything else (spaces, punctuation, symbols, non-Arabic scripts)
    // is dropped — the skeleton is a contiguous [a-z0-9] run.
  }
  return out;
}

// ── 3. Curated brand-alias map (the pragmatic core) ───────────────────────

/**
 * R122 (A11-F2): Arabic alias → English ILIKE term, enumerated from the
 * REAL catalog (docs/SEO_PRODUCTS.json — all 45 product names) plus the
 * marketplace staples the site's own hero/marketing copy names (Shahid,
 * PlayStation, Xbox, Telegram, WhatsApp, Steam … — restock-ready: an
 * alias whose brand isn't stocked simply returns [] cleanly).
 *
 * Multi-word aliases are written spaced; the lookup indexes their
 * spaceless collapsed form too, so «شات جي بي تي» and «شاتجيبيتي» both
 * resolve. Keys are normalized at module load (same folds as the query),
 * so variant spellings (أ/ا, ة/ه, ى/ي) collide correctly.
 *
 * Terms are lowercase tokens that substring-match the English product
 * names. Where the pragmatic target differs from the literal brand, the
 * term is the PRODUCT-NAME fragment with a comment (Amazon sells here as
 * "Prime Video"; the Drive-shaped need «درايف» maps to the storage
 * product).
 */
const BRAND_ALIASES: Record<string, string> = {
  // ── Streaming (17 products) ──
  نتفليكس: "netflix", // the standard Arabic spelling
  نتفلكس: "netflix", // the site's own hero spelling (r122-a11)
  نفلكس: "netflix", // short form users type (r122-a11 §P1-1 action item)
  نفليكس: "netflix", // R132: transposed لا variant, common Libyan typo
  سبوتيفاي: "spotify",
  سبوتفاي: "spotify",
  سبوتيفي: "spotify",
  ديزني: "disney",
  برايم: "prime video",
  امازون: "prime video", // the only Amazon storefront product in this catalog
  يوتيوب: "youtube",
  يوتوب: "youtube",
  يوتيب: "youtube", // R132: Libyan variant
  ابل: "apple tv",
  ماكس: "hbo", // only HBO Max carries "Max" here
  "اتش بي او": "hbo",
  هولو: "hulu",
  اوسن: "osn",
  باراماونت: "paramount",
  بارامونت: "paramount",
  شوتايم: "showtime",
  "اي ام سي": "amc",
  سلينج: "sling",
  سيلنج: "sling", // R132: Libyan variant
  دايركت: "directv",
  فوكس: "fox",
  فانيميشن: "funimation",
  هولمارك: "hallmark",
  شادر: "shudder",
  شاهد: "shahid", // hero-chip brand (restock-ready)
  // ── Music / audio / focus (10) ──
  تايدال: "tidal",
  تايدل: "tidal",
  تيدال: "tidal", // R132: Libyan variant
  "ساوند كلاود": "soundcloud",
  باندورا: "pandora",
  نابستر: "napster",
  كوبوز: "qobuz",
  ايداجيو: "idagio",
  "تيون ان": "tunein",
  هيدسبيس: "headspace",
  برين: "brain", // Brain.fm Pro
  غيتار: "guitar", // UltimateGuitar Pro
  جيتار: "guitar",
  // ── VPN (4) ──
  "في بي ان": "vpn", // generic: matches every VPN product name
  اكسبرس: "expressvpn",
  سايبر: "cyberghost",
  "سايبر جوست": "cyberghost",
  فانيش: "ipvanish",
  "اتش ام اي": "hma",
  // ── AI / SEO / education (6) ──
  "شات جي بي تي": "chatgpt",
  "جي بي تي": "chatgpt",
  جيبيتي: "chatgpt",
  شوبيا: "shopia", // Shopia AI (sic — product name spelling)
  افريفس: "ahrefs",
  سيمراش: "semrush",
  سيمرش: "semrush", // R132: Libyan variant
  "سكيل شير": "skillshare",
  سكريد: "scribd",
  سكريبد: "scribd", // R132: Libyan variant
  // ── Software (7) ──
  ويندوز: "windows",
  "وين رار": "winrar",
  رار: "winrar",
  جرامرلي: "grammarly",
  جراملي: "grammarly",
  "سي بانل": "cpanel",
  بانل: "cpanel",
  تخزين: "cloud storage", // Lifetime Cloud Storage
  سحابه: "cloud storage",
  درايف: "cloud storage", // the Drive-shaped need → the storage product
  // ── Marketplace staples named in marketing copy (restock-ready) ──
  بلايستيشن: "playstation",
  بلاستيشن: "playstation", // common Libyan variant
  بلايستشن: "playstation",
  "اكس بوكس": "xbox",
  اكس: "xbox", // exact-only (3 chars): «اكسبرس» must stay ExpressVPN
  تلغرام: "telegram",
  تليجرام: "telegram",
  تيليجرام: "telegram",
  تلجرام: "telegram",
  واتساب: "whatsapp",
  واتس: "whatsapp",
  جوجل: "google",
  ستيم: "steam",
  نينتندو: "nintendo",
  ايتونز: "itunes",
  ريديت: "reddit",
  ديسكورد: "discord",
  "لينكد ان": "linkedin",
  لينكدن: "linkedin",
  كانفا: "canva",
  "كاب كات": "capcut",
};

/**
 * R122 (A11-F2): lookup keyed by the NORMALIZED + SPACE-COLLAPSED alias
 * → lowercase English term. Built once at module load. Keys go through
 * the same {@link normalizeArabicText} as the query, so «إكس» in the
 * table and «اكس» in the query collide correctly; collapsing means
 * «في بي ان» (spaced) and «فيبيان» (typed as one word) share one key.
 */
const ALIAS_LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [alias, term] of Object.entries(BRAND_ALIASES)) {
    const key = normalizeArabicText(alias).replace(/\s+/g, "");
    map.set(key, term.toLowerCase());
  }
  return map;
})();

// ── 3b. Category + modifier aliases (R132) ────────────────────────────────

/**
 * R132: Arabic CATEGORY intent → the live `products.category` enum.
 *
 * The R122 bridge only translated BRAND words — a customer typing the
 * CATEGORY («افلام», «برامج», «موسيقى») got zero results because no
 * English name token means "movies". The seven values mirror
 * frontend/src/lib/categories.ts (verified against the live catalog).
 * The route ORs `category = <slug>` branches beside the name ILIKEs, so
 * «افلام» returns every streaming product — the honest answer to the
 * intent, not a fabricated brand match.
 *
 * Matching mirrors the brand machinery (normalized exact token →
 * ≥4-char containment for definite articles), but there is NO
 * transliteration fallback: a skeleton can never name a category.
 */
const CATEGORY_ALIASES: Record<string, CategoryAlias> = {
  // streaming
  بث: "streaming",
  افلام: "streaming",
  مسلسلات: "streaming",
  مسلسل: "streaming",
  سينما: "streaming",
  // music
  موسيقى: "music",
  اغاني: "music",
  بودكاست: "music",
  // software
  برامج: "software",
  برنامج: "software",
  تطبيقات: "software",
  تطبيق: "software",
  مفاتيح: "software", // «مفاتيح برامج» — activation keys
  تراخيص: "software", // «رخص / تراخيص» — licenses
  // vpn
  "في بي ان": "vpn", // the name-alias "vpn" only substring-matches
  برايفت: "vpn", // «برايفت» / «شبكة برايفت» — Libyan VPN shorthand
  // ai-tools
  "ذكاء اصطناعي": "ai-tools",
  ذكاء: "ai-tools",
  // seo-tools
  سيو: "seo-tools", // "seo" matches no product NAME — category is the only path
  "ادوات سيو": "seo-tools",
  // education
  تعليم: "education",
  كورسات: "education",
  دورات: "education",
  كتب: "education", // Scribd's books — education category
};

/**
 * R132: duration/tier words → the Latin fragments the catalog's product
 * and variant names actually carry ("1-Month", "12-Month", "1 Year",
 * "Plus", "Pro" …). These are MODIFIERS, not brands: alone they widen
 * the match (every month-plan product); beside a brand the route builds
 * compound AND branches («نتفلكس شهر» → name ILIKE %netflix% AND
 * %month%) that rank first — the customer's plan-level intent surfaces
 * at the top instead of drowning in the OR recall.
 *
 * Exact/phrase matching only — no containment, no skeletons («برو»
 * must never fire inside an unrelated word).
 */
const MODIFIER_ALIASES: Record<string, string> = {
  // durations (catalog convention: "-Month" / "Year" / week / day)
  شهر: "month",
  شهري: "month",
  اشهر: "month",
  شهرين: "month",
  سنوي: "year",
  سنويه: "year", // normalized from «سنوية» (ة→ه)
  سنه: "year", // normalized from «سنة»
  اسبوع: "week",
  اسبوعي: "week",
  يوم: "day",
  يومي: "day",
  // tiers the catalog actually names
  بريميوم: "premium",
  برو: "pro",
  بلس: "plus",
  ستاندرد: "standard",
};

/** The live `products.category` enum (mirrors lib/categories.ts). */
type CategoryAlias =
  "streaming" | "music" | "software" | "vpn" | "ai-tools" | "seo-tools" | "education";

/** Lookup for the category map — same normalization + space-collapse
 * as ALIAS_LOOKUP (multi-word «في بي ان» ≡ «فيبيان», «ذكاء اصطناعي» ≡
 * «ذكاءاصطناعي»). */
const CATEGORY_LOOKUP: ReadonlyMap<string, CategoryAlias> = (() => {
  const map = new Map<string, CategoryAlias>();
  for (const [alias, slug] of Object.entries(CATEGORY_ALIASES)) {
    map.set(normalizeArabicText(alias).replace(/\s+/g, ""), slug);
  }
  return map;
})();

/** Modifier lookup — normalized + collapsed, mirroring the two above. */
const MODIFIER_LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [alias, term] of Object.entries(MODIFIER_ALIASES)) {
    map.set(normalizeArabicText(alias).replace(/\s+/g, ""), term.toLowerCase());
  }
  return map;
})();

/**
 * R122 (A11-F2): per-request work is BOUNDED — an adversarial
 * 10k-char query must not mint an unbounded OR chain (the B6-02 class
 * of self-DoS, this time on the SQL-parameter axis).
 */
const MAX_TOKENS_CONSIDERED = 8;
const MAX_TRANSLIT_TERMS = 3;
const MIN_TRANSLIT_LENGTH = 3;
/** Containment (substring) matching is only allowed for aliases this long,
 * so the 3-char exact-only aliases («اكس», «رار») can never fire inside a
 * longer unrelated word. */
const MIN_CONTAIN_ALIAS_LENGTH = 4;

/** Token charset after normalization: Arabic letters + Latin + digits.
 * Everything else (punctuation, +, %, ؟ ، …) is stripped per token. */
const TOKEN_JUNK = /[^\u0621-\u063A\u0641-\u064Aa-zA-Z0-9]/g;

/** A token counts as Arabic (and is thus eligible for expansion) if it
 * carries at least one Arabic letter. */
const ARABIC_LETTER = /[\u0621-\u063A\u0641-\u064A]/;

// ── 4. Query expansion ────────────────────────────────────────────────────

/**
 * R132: the structured expansion the products route consumes. Every
 * field is independently bounded; together they cover the four gaps the
 * R122 bridge left: category intent, mixed-script queries, duration/
 * tier refinement, and rankable compound branches.
 */
export interface ArabicSearchExpansion {
  /**
   * Extra literal ILIKE terms for the NAME column (brand aliases +
   * modifier fragments + transliteration skeletons) — the R122
   * behavior, unchanged.
   */
  nameTerms: string[];
  /**
   * Live `products.category` enum values matched from Arabic category
   * words («افلام» → "streaming"). The route ORs `category = slug`
   * branches beside the name ILIKEs.
   */
  categories: string[];
  /**
   * Per-token Latin/digit ILIKE branches, emitted ONLY when the query
   * also carries Arabic letters (mixed script). The raw whole-string
   * ILIKE can never match an English name when an Arabic word rides
   * along, so «netflix اشتراك» used to return nothing; OR-ing the
   * Latin fragments restores the match. Pure-English queries keep
   * their byte-identical single-ILIKE SQL (the R122 invariant).
   */
  latinTerms: string[];
  /**
   * Brand × modifier AND-branches («نتفلكس شهر» →
   * `name ILIKE %netflix% AND name ILIKE %month%`, optionally AND
   * `%<digits>%` for «نتفلكس ١٢ شهر»). The route ranks these first —
   * the plan-level intent surfaces above the OR recall.
   */
  compounds: Array<{ brand: string; modifier: string; digits?: string }>;
}

/** R132 bounds — the OR chain stays capped for adversarial input. */
const MAX_LATIN_TERMS = 4;
const MAX_COMPOUNDS = 4;
const MAX_CATEGORIES = 3;
/** Digit tokens this short are pure noise for the compound AND. */
const MIN_DIGIT_LENGTH = 1;
const MAX_DIGIT_LENGTH = 3;

/**
 * R132: the full expansion. Pure-function and deterministic like its
 * R122 sibling; see {@link ArabicSearchExpansion} for the fields.
 *
 * @example
 *   expandArabicSearch("افلام")            → { nameTerms: [], categories: ["streaming"], … }
 *   expandArabicSearch("نتفلكس شهر")       → { nameTerms: ["netflix","month"], compounds: [{brand:"netflix",modifier:"month"}], … }
 *   expandArabicSearch("netflix اشتراك")   → { nameTerms: [], latinTerms: ["netflix"], … }
 *   expandArabicSearch("netflix premium")  → all empty (pure English unchanged)
 */
export function expandArabicSearch(query: string): ArabicSearchExpansion {
  const tokens = normalizeArabicText(query)
    .split(/\s+/)
    .map((t) => t.replace(TOKEN_JUNK, ""))
    .filter((t) => t.length > 0)
    .slice(0, MAX_TOKENS_CONSIDERED);
  if (tokens.length === 0) {
    return { nameTerms: [], categories: [], latinTerms: [], compounds: [] };
  }

  const hasArabicToken = tokens.some((t) => ARABIC_LETTER.test(t));
  if (!hasArabicToken) {
    // Pure English/digits — the R122 invariant: byte-identical SQL.
    return { nameTerms: [], categories: [], latinTerms: [], compounds: [] };
  }

  const nameTerms: string[] = [];
  /** Alias-derived name terms only (brand + modifier hits) — the
   * compound candidates. Skeletons never qualify. */
  const aliasTerms: string[] = [];
  const seen = new Set<string>();
  const addTerm = (term: string, fromAlias = true) => {
    if (term && !seen.has(term)) {
      seen.add(term);
      nameTerms.push(term);
      if (fromAlias) aliasTerms.push(term);
    }
  };

  // R132 collections: modifiers, digit refinements, Latin branches,
  // category hits.
  const modifiers: string[] = [];
  const digitTokens: string[] = [];
  const latinTokens: string[] = [];
  const categoryHits = new Set<string>();

  // Whole-query collapsed forms FIRST (brand phrase, then category
  // phrase) — a recognized multi-word phrase resolves as one unit and
  // suppresses per-token skeleton noise («جي», «بي», «تي»).
  const collapsed = tokens.join("");
  const phrase = ALIAS_LOOKUP.get(collapsed);
  const categoryPhrase = CATEGORY_LOOKUP.get(collapsed);

  let translitBudget = phrase ? 0 : MAX_TRANSLIT_TERMS;
  for (const token of tokens) {
    if (!ARABIC_LETTER.test(token)) {
      // R132: mixed-script — ride Latin/digit tokens along (bounded).
      // Pure-English queries never reach here (guard above). Pure
      // digits become compound REFINEMENTS only (a bare %1% ILIKE
      // would match half the catalog's plan numbers as noise);
      // ≥2-char Latin tokens become their own OR branches.
      if (/^\d+$/.test(token)) {
        if (token.length >= MIN_DIGIT_LENGTH && token.length <= MAX_DIGIT_LENGTH) {
          digitTokens.push(token);
        }
      } else if (token.length >= 2 && latinTokens.length < MAX_LATIN_TERMS) {
        const lower = token.toLowerCase();
        if (!seen.has(lower) && !latinTokens.includes(lower)) latinTokens.push(lower);
      }
      continue;
    }

    // R132: category words — exact, then ≥4-char containment («الافلام»).
    const catExact = CATEGORY_LOOKUP.get(token);
    let categoryMatched: string | null = catExact ?? null;
    if (!categoryMatched) {
      for (const [alias, slug] of CATEGORY_LOOKUP) {
        if (alias.length >= MIN_CONTAIN_ALIAS_LENGTH && token.includes(alias)) {
          categoryMatched = slug;
          break;
        }
      }
    }
    if (categoryMatched) categoryHits.add(categoryMatched);

    // R132: modifier words — exact/phrase only, never containment. A
    // matched modifier CONSUMES its token: the skeleton fallback would
    // only add a no-match ILIKE branch («شهر» → "shhr" matches nothing).
    const modifier = MODIFIER_LOOKUP.get(token);
    if (modifier) {
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier);
        // Alone, the modifier still widens the OR recall («شهر» → every
        // month-plan product) — honest breadth for a modifier-only query.
        addTerm(modifier);
      }
      continue;
    }

    const exact = ALIAS_LOOKUP.get(token);
    if (exact) {
      addTerm(exact);
      continue;
    }

    let contained = false;
    for (const [alias, term] of ALIAS_LOOKUP) {
      if (alias.length >= MIN_CONTAIN_ALIAS_LENGTH && token.includes(alias)) {
        addTerm(term);
        contained = true;
      }
    }
    if (contained) continue;

    if (translitBudget > 0 && !categoryMatched) {
      // A category-matched token is RESOLVED — its skeleton is noise.
      const skeleton = transliterateArabicToLatin(token);
      if (skeleton.length >= MIN_TRANSLIT_LENGTH && !seen.has(skeleton)) {
        seen.add(skeleton);
        nameTerms.push(skeleton); // NOT aliasTerms — skeletons never compound
        translitBudget -= 1;
      }
    }
  }

  if (phrase) addTerm(phrase);
  if (categoryPhrase) categoryHits.add(categoryPhrase);

  // R132: compounds — alias-derived brand terms × modifiers, each
  // refined by the FIRST pure-digit token when one rode along
  // («نتفلكس ١٢ شهر» → netflix ∧ month ∧ 12). Bounded to MAX_COMPOUNDS.
  // Modifier words themselves never act as the BRAND side (a
  // modifier-only query must not mint "month ∧ month").
  const brandCandidates = aliasTerms.filter((t) => !modifiers.includes(t));
  const compounds: ArabicSearchExpansion["compounds"] = [];
  if (modifiers.length > 0 && brandCandidates.length > 0) {
    const digitRef = digitTokens[0];
    outer: for (const brand of brandCandidates) {
      for (const modifier of modifiers) {
        if (compounds.length >= MAX_COMPOUNDS) break outer;
        compounds.push(digitRef ? { brand, modifier, digits: digitRef } : { brand, modifier });
      }
    }
  }

  return {
    nameTerms,
    categories: Array.from(categoryHits).slice(0, MAX_CATEGORIES),
    // Deduped against nameTerms (a Latin twin of an Arabic alias, e.g.
    // «netflix نتفلكس», must not mint a duplicate ILIKE branch).
    latinTerms: latinTokens.filter((t) => !seen.has(t)).slice(0, MAX_LATIN_TERMS),
    compounds,
  };
}

/**
 * R122 (A11-F2): expand an Arabic (or mixed-script) search query into the
 * extra literal ILIKE terms the products route ORs in beside the raw
 * query. Returns [] for pure-English/empty queries — their SQL is
 * byte-identical to the pre-R122 behavior, so English search cannot
 * regress.
 *
 * R132: thin compatibility wrapper over {@link expandArabicSearch}
 * (nameTerms only) — the unit-suite pins from R122 keep their shape.
 *
 * Matching, in order:
 *   - exact token hit («نتفلكس» → netflix);
 *   - whole-query collapsed hit for multi-word phrases («شات جي بي تي» →
 *     chatgpt — recognized phrases also suppress skeleton noise);
 *   - containment: a token CARRYING a ≥4-char alias («النتفلكس» with the
 *     definite article, «نتفلكسبريميوم» typed without a space);
 *   - transliteration skeleton for unmatched Arabic tokens (≥3 chars,
 *     capped) — best-effort fallback for unmapped brand words.
 *
 * @example
 *   expandArabicSearchTerms("نتفليكس")            → ["netflix"]
 *   expandArabicSearchTerms("اشتراك نتفلكس")       → ["ashtrak", "netflix"]
 *   expandArabicSearchTerms("شاهد")                → ["shahid"]
 *   expandArabicSearchTerms("netflix premium")     → []  (English unchanged)
 */
export function expandArabicSearchTerms(query: string): string[] {
  return expandArabicSearch(query).nameTerms;
}
