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
  سبوتيفاي: "spotify",
  سبوتفاي: "spotify",
  سبوتيفي: "spotify",
  ديزني: "disney",
  برايم: "prime video",
  امازون: "prime video", // the only Amazon storefront product in this catalog
  يوتيوب: "youtube",
  يوتوب: "youtube",
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
  دايركت: "directv",
  فوكس: "fox",
  فانيميشن: "funimation",
  هولمارك: "hallmark",
  شادر: "shudder",
  شاهد: "shahid", // hero-chip brand (restock-ready)
  // ── Music / audio / focus (10) ──
  تايدال: "tidal",
  تايدل: "tidal",
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
  "سكيل شير": "skillshare",
  سكريد: "scribd",
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

// ── 4. Query expansion ────────────────────────────────────────────────────

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

/**
 * R122 (A11-F2): expand an Arabic (or mixed-script) search query into the
 * extra literal ILIKE terms the products route ORs in beside the raw
 * query. Returns [] for pure-English/empty queries — their SQL is
 * byte-identical to the pre-R122 behavior, so English search cannot
 * regress.
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
  const tokens = normalizeArabicText(query)
    .split(/\s+/)
    .map((t) => t.replace(TOKEN_JUNK, ""))
    .filter((t) => t.length > 0)
    .slice(0, MAX_TOKENS_CONSIDERED);
  if (tokens.length === 0) return [];

  const terms: string[] = [];
  const seen = new Set<string>();
  const addTerm = (term: string) => {
    if (term && !seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  };

  // Whole-query collapsed form FIRST: a recognized multi-word phrase
  // resolves as one unit and suppresses per-token skeletons for its
  // fragments («جي», «بي», «تي» would otherwise emit 2-char noise).
  const phrase = ALIAS_LOOKUP.get(tokens.join(""));

  let translitBudget = phrase ? 0 : MAX_TRANSLIT_TERMS;
  for (const token of tokens) {
    // R122 (A11-F2): Latin/digit tokens are never expanded — the raw
    // whole-string ILIKE already covers them, and expanding them would
    // change pure-English multi-word semantics.
    if (!ARABIC_LETTER.test(token)) continue;

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

    if (translitBudget > 0) {
      const skeleton = transliterateArabicToLatin(token);
      if (skeleton.length >= MIN_TRANSLIT_LENGTH && !seen.has(skeleton)) {
        seen.add(skeleton);
        terms.push(skeleton);
        translitBudget -= 1;
      }
    }
  }

  if (phrase) addTerm(phrase);
  return terms;
}
