/**
 * R163 (size-gate carve): the SPA shell's static meta constants moved
 * VERBATIM from lib/spa-shell.ts (the growth-banned 1,039-line register —
 * the R163 JSON-LD arm pushed the file past its pin). Pure data + their
 * pinning contracts; no behavior here. The parity tests and app.ts
 * re-exports keep importing them through spa-shell.ts.
 */
/**
 * Category landing-page meta for the static shell — DUPLICATED from
 * frontend/src/lib/categories.ts (metaTitle / metaDescription verbatim).
 * The backend build cannot import the frontend source (tsc rootDir:
 * "src"), so parity is PINNED by test:
 * src/__tests__/spa-shell-category-parity.test.ts fails when either
 * copy drifts. Keep both files in sync when a category's meta changes.
 * Exported for that parity test.
 */
export const SHELL_CATEGORY_META: Record<
  string,
  { label: string; h1: string; metaTitle: string; metaDescription: string }
> = {
  streaming: {
    // R176: label + h1 mirror categories.ts verbatim — the no-JS fallback
    // nav (lib/shell-seo-nav.ts) uses them as link text and page heading.
    label: "منصات المشاهدة",
    h1: "اشتراكات منصات المشاهدة في ليبيا",
    // R161-C: mirrors categories.ts's streaming metaTitle verbatim
    // (the parity suite pins the pair — keep both sides in sync).
    metaTitle: "منصات المشاهدة في ليبيا — Netflix و Disney+ | SubNation",
    // I-4 (R142): Shahid VIP dropped — the live catalog sells neither it
    // nor Crunchyroll; the frontend CATEGORY_META twin (categories.ts)
    // carries the same edit (the parity suite pins the pair verbatim).
    metaDescription:
      "اشترِ اشتراكات Netflix و Disney+ و Amazon Prime Video بالدينار الليبي. تسليم فوري في طرابلس وبنغازي ومصراتة وكامل ليبيا.",
  },
  music: {
    label: "الموسيقى والصوتيات",
    h1: "اشتراكات الموسيقى والصوتيات في ليبيا",
    metaTitle: "اشتراكات الموسيقى في ليبيا — Spotify | SubNation",
    metaDescription:
      "اشترِ اشتراك Spotify Premium وخدمات الموسيقى الأخرى بالدينار الليبي. تسليم فوري، جودة صوت عالية، استماع بدون إعلانات في كامل ليبيا.",
  },
  software: {
    label: "البرامج والتراخيص",
    h1: "مفاتيح ورخص برامج أصلية في ليبيا",
    metaTitle: "مفاتيح Windows وبرامج أصلية في ليبيا | SubNation",
    metaDescription:
      "اشترِ مفاتيح Windows 10 و WinRAR و Grammarly و cPanel أصلية بالدينار الليبي. تراخيص دائمة، تفعيل فوري، ضمان استبدال في كامل ليبيا.",
  },
  vpn: {
    label: "شبكات VPN",
    h1: "اشتراكات VPN في ليبيا",
    metaTitle: "اشتراكات VPN في ليبيا — ExpressVPN | SubNation",
    metaDescription:
      "اشترِ اشتراكات ExpressVPN و CyberGhost و IPVanish و HMA بالدينار الليبي. تسليم فوري، تشفير كامل، خوادم عالمية، تعمل في كامل ليبيا.",
  },
  "ai-tools": {
    label: "أدوات الذكاء الاصطناعي",
    h1: "اشتراكات الذكاء الاصطناعي في ليبيا",
    metaTitle: "اشتراك ChatGPT Plus في ليبيا | SubNation",
    metaDescription:
      "فعّل ChatGPT Plus و Shopia AI بالدينار الليبي بدون بطاقة دولية. تسليم فوري لبيانات الحساب، وصول كامل للنماذج المتقدمة، دعم في كامل ليبيا.",
  },
  "seo-tools": {
    label: "أدوات SEO",
    h1: "أدوات السيو والتسويق الرقمي في ليبيا",
    metaTitle: "أدوات SEO في ليبيا — Ahrefs و Semrush | SubNation",
    metaDescription:
      "اشترِ اشتراكات Ahrefs و Semrush الاحترافية بالدينار الليبي. تحليل روابط وكلمات مفتاحية ومنافسين، فاتورة شهرية أو سنوية، تسليم فوري في ليبيا.",
  },
  education: {
    label: "التعليم والمكتبات",
    h1: "منصات التعلم والكتب الرقمية في ليبيا",
    metaTitle: "اشتراكات Skillshare و Scribd في ليبيا | SubNation",
    metaDescription:
      "اشترِ اشتراكات Skillshare و Scribd الأصلية بالدينار الليبي. آلاف الدورات ومكتبة كتب غير محدودة، تنزيل بدون إنترنت، تسليم فوري في كامل ليبيا.",
  },
};

/**
 * Home shell meta — DUPLICATED from the runtime useSeo block in
 * frontend/src/pages/home.tsx (title + description verbatim).
 * B12-F1 (R127-L9): the shipped index.html baseline is the generic
 * brand-first default («SubNation — سوق الاشتراكات الرقمية» + the
 * R120-B3 catalog description) while the hydrated home page renders
 * this keyword-forward copy — a split title+description signal for
 * every non-rendering engine (the exact class R122 A7-P1-1 closed for
 * /product/*). The backend build cannot import the frontend source
 * (tsc rootDir: "src"), so parity is PINNED by test:
 * src/__tests__/spa-shell-route-parity.test.ts fails when either
 * copy drifts. Exported for that parity test.
 */
export const SHELL_HOME_META: { title: string; description: string } = {
  // The money query leads («سوق الاشتراكات الرقمية في ليبيا»), brand
  // tail, ≤60 chars — the rendered page's exact title.
  title: "سوق الاشتراكات الرقمية في ليبيا | SubNation",
  // Intent-led ~147-char copy: locale inside the first clause, the
  // Arabic brand transliterations users actually type, closing with
  // the three differentiators (LYD, instant delivery, local support).
  description:
    "متجر اشتراكات رقمية في ليبيا — نتفلكس، سبوتيفاي، ChatGPT وأكثر بالدينار الليبي. الدفع عبر ليبيانا ومدار وLyPay، تسليم فوري، دعم محلي.",
};

/**
 * Static public routes with fixed meta (mirrors each page's useSeo
 * block). Same pinning contract as SHELL_HOME_META above: parity is
 * PINNED by src/__tests__/spa-shell-route-parity.test.ts — keep both
 * sides in sync when a route's meta changes. Exported for that test.
 */
export const SHELL_STATIC_ROUTE_META: Record<string, { title: string; description: string }> = {
  "/flash-sales": {
    title: "عروض فلاش — SubNation",
    // R124 (A10-F3) lengthened the rendered description 53 → 140 chars
    // but shipped frontend-only — B12-F2 (R127-L9): the shell kept
    // serving the pre-R124 copy to every non-rendering engine. Now
    // the runtime builder's copy verbatim.
    // R143 (L12-1, backend half): the page's description became
    // RUNTIME-GATED (active sale → the A10-F3 discount copy; no sale →
    // the honest seasonal copy — the live probe found the page saying
    // «لا عرض نشط حالياً» under a meta promising «عروض فلاش بخصومات
    // حقيقية…», the J-3/F1 truthfulness class). The shell is static and
    // cannot know sale state, so it serves the HONEST no-sale arm: a
    // non-rendering engine must never be promised live discounts the
    // page itself denies; the hydrated page upgrades the meta to the
    // active-sale copy when one is actually running. Parity with the
    // no-sale arm is pinned by spa-shell-route-parity.test.ts.
    description:
      "صفحة عروض SubNation — تابع العروض الموسمية على الاشتراكات الرقمية بالدينار الليبي مع تسليم فوري في كامل ليبيا.",
  },
  "/support": {
    title: "الدعم والأسئلة الشائعة — SubNation",
    description:
      "إجابات حول الدفع وشحن المحفظة والاشتراكات والاسترداد وتسجيل الدخول في SubNation. افتح تذكرة دعم في أي وقت.",
  },
  "/terms": {
    title: "الشروط والأحكام — SubNation",
    description:
      "شروط استخدام منصة SubNation: سياسة الشراء، شحن المحفظة، الاشتراكات الرقمية، والاسترداد.",
  },
};
