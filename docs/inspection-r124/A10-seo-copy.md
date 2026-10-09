# R124-A10 — SEO & discoverability + UX copy audit

- **Agent:** R124-A10 (READ-ONLY audit; GET-only live probes against https://subnation.ly; only this report + worklog entry written)
- **Date:** 2026-10-08 ~20:30–21:00 UTC
- **Repo ref:** SubNation2 @ `c736d13` (clean tree)
- **Method:** code walk of `frontend/src/components/seo/*`, `frontend/src/hooks/useSeo.tsx`, `frontend/src/lib/seo-builders.ts`, `frontend/src/lib/categories.ts`, `frontend/src/App.tsx` (fallback + `NOINDEX_ROUTES`), `backend/src/routes/seo.ts`, `frontend/index.html`, `frontend/public/*`, `frontend/vite.config.ts` (seoHeadInject); live GET probes (robots, sitemap, apex/www HTML + redirect matrix, OG/PWA assets, `/api/products*`); length math on every static title/description; terminology grep sweep (طلب/طلبية، محفظة/رصيد، عملية/معاملة، دفع/سداد، السلة، الدعم); UX-copy review per `skills/impeccable-repo` clarify.md.

---

## A. Route × meta inventory (all storefront routes)

| Route | Title (len, chars) | Description (len) | Robots | Canonical | JSON-LD |
|---|---|---|---|---|---|
| `/` | «سوق الاشتراكات الرقمية في ليبيا \| SubNation» (43) | 147 | index,follow | `/` | Organization + WebSite(+SearchAction) + ItemList (loaded-only, ≤50) |
| `/product/:slug` | operator `seo_title` (all 45 present in DB/import; default fallback `name — price`) | operator `seo_description` (import source avg 123, range 110–131; live spot-check 84) | index,follow | `/product/<slug>` (slug-canonical; numeric legacy URLs client-rewritten) | Product (Offer: LYD, availability from `is_available`, brand, sku, url) + BreadcrumbList + FAQPage (product FAQs, when present) |
| `/category/:slug` (7 live) | unique per category, 53–63 | 130–140 | index,follow; **unknown slug → noindex,follow** (category.tsx:213) | `/category/<slug>` | BreadcrumbList + FAQPage + ItemList (loaded-only) |
| `/flash-sales` | «عروض فلاش — SubNation» (21) | **53** ⚠ #3 | index,follow | `/flash-sales` | ItemList (loaded-only, ≤30) |
| `/support` | «الدعم والأسئلة الشائعة — SubNation» (34) | 106 | index,follow | `/support` | FAQPage (visible-matched) |
| `/terms` (+`#privacy` tab) | 27 / 26 | 87 / 87 | index,follow | `/terms` / **`/terms#privacy`** ⚠ #4 | — (legal, fine) |
| `/cart` | 25 | 30 | noindex,follow | `/cart` | — |
| `/checkout` | 23 | 36 | noindex,follow | `/checkout` | — |
| `/status` | 23 | 57 | noindex,follow | `/status` | — |
| any unknown route | «الصفحة غير موجودة — SubNation» (29) | 40 | noindex,follow | **`/404`** ⚠ #12 | — |
| /login /register /onboarding /auth/* /wallet /orders /loyalty /referrals /profile /admin/* | App fallback (34) | fallback (135) | noindex,follow (robotsForPath) | self | — |

Lengths measured with code-point counting; `MetaTags.clamp` enforces ≤60/≤160 at runtime with Arabic word-boundary truncation (MetaTags.tsx:86-98) — no indexable page ships the default meta, and every page title is unique.

## B. Eval-area verdicts

1. **Title/description quality — VERIFIED-OK (2 data nits).** Unique per route; branded everywhere except the 7 category titles (#5); no indexable route misses meta; runtime clamp guarantees budgets; category descriptions 130–140 (ideal); nits: flash-sales desc 53 (#3), ai-tools title 63→clamped (#5), 13/45 import-source titles >60 (#6).
2. **OG/Twitter — VERIFIED-OK (1 nit, #11).** Runtime set complete: og:title/description/type/url/image (+dims **only when known** — honest-dims policy R122-A7), og:locale=**ar_LY**, og:site_name; twitter:card=summary_large_image + title/description/image. og:image absolutized (r103 fix; WhatsApp-dominant channel); static no-JS baseline carries og:title/desc/type/image+1280×720+twitter:card; **og:locale ar_LY is the correct Libya-specific choice** (the brief's `ar_AR` is the generic Arabic tag — ar_LY is better for a Libyan market); /opengraph.jpg live 200, real 1280×720 verified with `file`.
3. **Structured data — VERIFIED-OK.** Product LD: full Offer shape (price `toFixed(2)`, priceCurrency **LYD**, priceValidUntil, itemCondition, url top-level since R123-E4b, sku=slug-based, brand=SubNation, category, **availability threaded from the real `is_available`** — R111 D2-F2 honesty fix). Organization (home) with areaServed=Libya + LY address; WebSite+SearchAction pointing at the wired `/?search=` param; BreadcrumbList on product+category; FAQPage visible-matched (Google requirement, support.tsx:337-339) with empty-array suppression; ItemList emitted only when loaded. All client-injected (JsonLd) — **justified by SPA architecture** (react-helmet-async removed V3-A1; direct DOM insertion is CSP-safe with `<>&` escaping).
4. **Canonical — one P2 (#1) + two P3 (#4, #12).** Static apex canonical in index.html (R117); runtime per-route; VITE_APP_ORIGIN pinned `https://subnation.ly` in COOLIFY_FINAL_SETUP §2.2; sitemap/robots/og all apex; **www→apex 301 now live** (GET-verified, path-preserving — R117's P2-2 resolved; corroborates A7). The one defect: unknown product slugs (#1).
5. **Sitemap — VERIFIED-OK.** Live: 56 `<loc>` = 11 static (/, 7 categories, /support, /terms, /flash-sales) + 45 products; all apex; slug URLs; hreflang `ar` + `x-default` per URL; lastmod policy is catalog-scoped (products' MAX(updated_at) for catalog-rendering routes; per-product updatedAt; **omitted** for /terms+/support — R122 A7-P2); 60 s TTL + `bumpSitemapCache()` on admin CRUD; 50k cap single file — pagination unnecessary at 45. Live lastmod 2026-09-20 = catalog import date, sane.
6. **robots.txt — VERIFIED-OK.** Complete private-surface Disallow set (auth/cart/checkout/wallet/orders/loyalty/referrals/profile/admin+/status+/api/), Sitemap pointer (apex), Crawl-delay 1. Frontend `NOINDEX_ROUTES` (App.tsx:179-194) matches the Disallow list in **both directions** — /support, /terms, /category/, /product/, /flash-sales are the only indexable surfaces, exactly as intended.
7. **lang/dir/og:locale — VERIFIED-OK.** `<html lang="ar" dir="rtl">` static (index.html:2), locked at boot (lib/direction.ts — helmet-unmount LTR-flip fixed), manifest `lang:"ar", dir:"rtl"`, sitemap hreflang ar, WebSite LD `inLanguage:"ar"`, og:locale ar_LY. One consistent Arabic identity.
8. **UX copy — VERIFIED-OK at a high bar** (impeccable clarify.md): buttons name actions («إرسال طلب الشحن», «إرسال الرد», «إتمام الطلب — الإجمالي بعد الكوبون», «اشترِ الآن — 25.00 د.ل», «تحويل الرصيد», «تأكيد الربط»); errors name problem + why + recovery («حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة», profile's «رصيدك ونقاطك سليمة» reassurance, order-detail's escalation path); empty states distinguish filter-empty / first-use / outage with next-action CTAs (home, orders incl. honest load-more incompleteness note, wallet). Residuals: #7, #8, #9 + terminology table below.
9. **PWA/manifest — VERIFIED-OK (1 nit, #10).** manifest.json complete: name/short_name/description (Arabic, catalog-accurate), id/start_url/scope, standalone, background/theme (#dc1840 = dark --primary), **lang ar + dir rtl**, categories, icons 96/192/512 + maskable (real pixel sizes verified), screenshots with form_factor + Arabic labels, Arabic shortcuts. apple-touch-icon + apple-mobile-web-app-title + status-bar-style set; all assets 200 live (manifest 2,231 B; og 39.6 KB; icons correct types).
10. **404 page — VERIFIED-OK UX / one canonical quirk (#12).** noindex,follow (SPA soft-404 honestly documented, not-found.tsx:7-12), honest copy + primary CTA «العودة للرئيسية» + «رجوع» + 44px quick links; Latin-digit "404" per the site numeral convention. Canonical points at `/404` (a non-route that itself renders the 404) — defensible but odd.

---

## C. Findings

1. **[P2] Unknown product slugs render `index,follow` + canonical → `/` (homepage-canonicalized soft-404).**
   Evidence: `frontend/src/pages/product.tsx:775-780` — the `product == null` SEO fallback passes `path: "/"` and omits `robots`, so **every** `/product/<anything>` URL that 404s (infinite space; live `by-slug/nonexistent` → 404 verified by R117) emits runtime `rel=canonical → https://subnation.ly/` + `robots=index,follow` + generic title, while the UI says «المنتج غير موجود» (product.tsx:824-836). Google explicitly flags homepage-canonicalized soft-404s (canonical ignored, "Duplicate without user-selected canonical" noise, crawl-budget waste). Contrast: category.tsx:207-213 does it right (noindex,follow + «صفحة غير موجودة» title).
   Fix: mirror the category pattern — a dedicated not-found SEO branch (`title: "المنتج غير موجود — SubNation"`, `robots: "noindex,follow"`, keep or drop canonical) once `isNotFoundError` is true; keep the current neutral block only for the loading state. Effort **S**.

2. **[P2] Google Search Console verification token unset — the whole SEO surface is unmonitored.**
   Evidence: live `https://subnation.ly/` HTML ships `<meta name="google-site-verification" content="">` (empty by design when `VITE_GSC_VERIFICATION` unset — vite.config.ts:162-180 seoHeadInject works, Dockerfile:108 defaults the ARG to `""`). With no verified GSC property the operator cannot see indexing status, the 56-URL sitemap, Product/FAQ rich-result eligibility, or manual actions — for a site whose category/product meta was hand-tuned this round-trip is the single highest-leverage SEO action available. (The R97 J-2 injection bug was fixed; the token just was never supplied.)
   Fix: operator: generate the GSC HTML-tag token → set `VITE_GSC_VERIFICATION` build arg (COOLIFY_FINAL_SETUP §2.2 block) → rebuild + redeploy → "Verify" in Search Console → submit `https://subnation.ly/sitemap.xml`. Effort **S** (ops, no code).

3. **[P3] `/flash-sales` meta description is 53 chars — half the codebase's own 120–160 target.**
   Evidence: `flash-sales.tsx:223` «خصومات حصرية لفترة محدودة على أفضل الاشتراكات الرقمية» vs MetaTags.tsx:6 doc contract ("120-160 chars description"). It's an indexable money page (sitemap priority 0.8, changefreq daily) — wasting SERP snippet real estate.
   Fix: expand to ~130 chars naming categories, د.ل, and تسليم فوري (match home/category register). Effort **S**.

4. **[P3] `/terms#privacy` emits canonical + og:url containing a URL fragment.**
   Evidence: `terms.tsx:216` (`path: isPrivacy ? "/terms#privacy" : "/terms"`) → MetaTags.tsx:150/193 build `https://subnation.ly/terms#privacy` into `rel=canonical` and `og:url`. Google strips fragments from canonicals (tolerated but non-standard); og:url with a fragment mismatches the `/terms` sitemap URL.
   Fix: keep the distinct per-tab **title** (legit CTR signal) but pass `path: "/terms"` for canonical/og (fragment never reaches the server anyway). Effort **S**.

5. **[P3] Category metaTitles are unbranded; ai-tools title is 63 chars and gets clamped.**
   Evidence: categories.ts:55,104,148,203,260,308,358 — titles 59/60/53/58/**63**/55/53 chars; none carries «| SubNation» (home, products, flash-sales, support, terms, status, 404 all do). The 63-char ai-tools title is word-boundary-clamped to 60 at runtime (brand-style tails are the first casualty). 
   Fix: shorten ai-tools to ≤60 («اشتراك ChatGPT Plus في ليبيا — بالدينار الليبي»); optionally restructure 2–3 titles to fit a brand tail. Effort **S**.

6. **[P3] 13/45 import-source `seo_title` values exceed 60 chars (max 72); admin editor hints against 200/320 instead of the SERP budgets.**
   Evidence: `docs/SEO_PRODUCTS.json` (13 titles 61–72 chars; all carry «| SubNation» at the tail — the part runtime clamping eats); admin editor counters use the DB column caps (`admin/products.tsx:999,1004,1017,1025` show «200/320»), so nothing tells the operator that Google truncates at ~60.
   Fix: trim the 13 source titles to ≤60 and re-apply (or per-product admin edit); add a soft advisory in the editor («يُعرض في جوجل حتى ~60 حرفاً» / «~160 حرفاً»). Effort **S**.

7. **[P3] profile.tsx still ships the vague «فشلت العملية» error fallback the R111-F2 sweep retired everywhere else.**
   Evidence: `profile.tsx:193` vs the upgraded family `loyalty.tsx:328,353`, `support.tsx:281,312` («تعذّر إتمام العملية — حاول مرة أخرى» — problem + recovery, per clarify.md).
   Fix: one-line copy change to match. Effort **S**.

8. **[P3] Terminology drift: one «معاملة», a triple-named support surface, and two ai-tools label variants.**
   Evidence: (a) `home.tsx:1264` TrustCard «جميع معاملاتك موثقة» — the only «معاملة» in the storefront; every transaction concept elsewhere is «عملية/عمليات» (wallet.tsx:495 «عمليات الشحن والشراء والاسترداد»). (b) Support page named «الدعم الفني» (h1 support.tsx:373, Navbar:378, Footer:79) but titled «الدعم والأسئلة الشائعة» (support.tsx:341) and cross-referenced as «صفحة المساعدة» in a category FAQ (categories.ts:70 — a name that exists nowhere in the nav). (c) ai-tools: «أدوات الذكاء الاصطناعي» (categories.ts:250 page label, admin/products.tsx:102) vs «ذكاء اصطناعي» (lib/utils.ts:150 — chips **and the Product-LD `category` field**). Full table in §D.
   Fix: (a) «عملياتك موثقة»; (b) change categories.ts:70 to «الدعم الفني»; (c) unify utils.ts:150 to «أدوات ذكاء اصطناعي» (chip length ok) so LD/category agree. Effort **S**.

9. **[P3] The WhatsApp OTP send button is the storefront's lone generic «إرسال».**
   Evidence: `WhatsAppPhoneSignIn.tsx:550` (bare «إرسال» + icon on the phone step; the resend link names it properly: «لم يصلك الرمز؟ إعادة الإرسال»). Every other submit names its action.
   Fix: «إرسال الرمز» (or «إرسال الرمز إلى واتساب») + update the label in whatsapp-phone-sign-in.test.tsx (~10 references). Effort **S**.

10. **[P3] Safari tab favicon gap: SVG-only favicon, no PNG/ICO fallback.**
    Evidence: `index.html:90` — single `<link rel="icon" type="image/svg+xml">`; Safari (macOS/iOS tabs) does not render SVG favicons and there is no `favicon.ico`/PNG link, so Safari tabs fall back to a generic letter. All other PWA icons are complete.
    Fix: add `<link rel="icon" type="image/png" sizes="192x192" href="/pwa-192x192.png">` (asset already shipped) or emit a favicon.ico. Effort **S**.

11. **[P3] Static no-JS baseline lacks og:locale / og:site_name / twitter:image (+twitter:title/description).**
    Evidence: index.html:32-88 static block has og:title/description/type/image(+dims)/twitter:card only; the rest are runtime-upserted (MetaTags.tsx:195-234). Non-JS unfurlers (the exact audience the static baseline exists for — WhatsApp) get an un-locale'd, un-branded card; WhatsApp still unfurls (title+desc+image+card suffice) so impact is cosmetic-to-minor.
    Fix: add the three/five static metas mirroring the runtime values (site_name «SubNation», locale ar_LY, twitter:image absolute apex). Effort **S**.

12. **[P3] noindex pages carry self-canonicals; NotFound canonical points at the synthetic `/404`.**
    Evidence: fallback MetaTags always upserts canonical (App.tsx:680-686 + MetaTags.tsx:193) including on `noindex,follow` routes (/login, /wallet, /cart, …); not-found.tsx:13-18 sets canonical `https://subnation.ly/404` — a URL that is not a route (any unknown path renders the same page), deliberately so phantom paths don't consolidate against the homepage. Google's guidance: don't mix noindex + canonical (noindex wins; canonical is noise). Harmless today; cleanup is cheap.
    Fix (optional): in MetaTags, skip the canonical upsert when `robots` starts with `noindex`; on NotFound either drop the canonical or leave documented as-is. Effort **S**.

**Not double-counted (cross-ref A7):** apex `http→https` uses **302** (temporary) rather than 301 — A7's redirect-matrix finding; SEO impact negligible since every canonical signal (sitemap/robots/og/canonical/HSTS) is https-apex, but the edge rule should be permanent for hygiene.

## D. Terminology consistency table

| Concept | Standard (dominant) | Divergence | Locations | Verdict |
|---|---|---|---|---|
| order | **طلب** (طلباتي / سجل الطلبات / طلبات الشحن) | «طلبية» — 0 hits anywhere | — | ✅ clean |
| payment | **دفع** (الدفع، عملية الدفع، الدفع بالدينار) | «سداد» — 0 hits | — | ✅ clean |
| wallet vs balance | **المحفظة** (container) / **الرصيد** (amount) — semantically split, consistently | — | wallet.tsx, checkout, product | ✅ clean |
| transaction | **عملية** (عملية الشراء/الدفع، عمليات الشحن) | «معاملة» ×1 | home.tsx:1264 (TrustCard «معاملاتك») | ❌ → #8a |
| support surface | **الدعم الفني** (h1, Navbar, Footer, admin) | «الدعم والأسئلة الشائعة» (page title); «صفحة المساعدة» (FAQ cross-ref — name doesn't exist in nav) | support.tsx:341 vs :373; categories.ts:70 | ⚠ → #8b |
| ai-tools category | **أدوات الذكاء الاصطناعي** (page label, admin select) | «ذكاء اصطناعي» (chips, breadcrumbs **and Product-LD `category`**) | utils.ts:150 vs categories.ts:250 | ⚠ → #8c |
| education category | **التعليم والمكتبات** (page label) | «تعليم ومكتبات» (chips, admin) | utils.ts:152 | △ chip-brevity convention (same for streaming/software/music chips) — acceptable if intentional |
| cart | **السلة** (nav, cards, toasts) | «سلة المشتريات» (page title + h1 only) | cart.tsx:42 | △ formal-title form — acceptable |
| top-up flow | **طلب الشحن / شحن المحفظة / سجل الشحن** — consistent | — | wallet.tsx | ✅ clean |
| loyalty points | **نقاط** (نقاط الشراء/الإحالة/التحويل) | — | loyalty.tsx | ✅ clean |
| generic error fallback | **«تعذّر إتمام العملية — حاول مرة أخرى»** | «فشلت العملية» ×1 | profile.tsx:193 | ❌ → #7 |
| submit buttons | verb + object («إرسال طلب الشحن», «إرسال الرد», «إتمام الطلب», «تأكيد الربط», «تحويل الرصيد») | bare «إرسال» ×1 | WhatsAppPhoneSignIn.tsx:550 | ❌ → #9 |

## E. Counts + verdict

- **P0: 0 · P1: 0 · P2: 2 · P3: 10** — all fixes are effort **S**.
- The SEO surface is unusually mature for an SPA storefront: per-route meta with runtime clamp + honest og-dims policy, complete JSON-LD (Product/Offer-LYD/FAQ/Breadcrumb/ItemList/Organization/WebSite), a thoughtful sitemap (catalog-scoped lastmod, hreflang, admin-CRUD invalidation), an aligned robots/noindex system, a complete Arabic-first PWA manifest, and a now-consolidated www→apex 301. The two P2s are the unknown-product soft-404 (#1, one component branch) and the missing Search Console verification (#2, ops).
- UX copy already meets the clarify.md bar (action-named buttons, problem+recovery errors, distinguishing empty states); the three residuals (#7-#9) are single-line stragglers from earlier unification sweeps.
