# R162 — Catalog Content Review (DB-owned copy census)

**Task ID:** R162-A · **Date:** 2026-10-17 · **Mode:** read-only (GET-only production probes + web verification; zero production writes, zero logins)

> **The original R161 17-row table was never committed; this census is the reconstructed evidence-based replacement.** The R161 close report claimed "the census table with exact proposed wording ships to the operator via this report" — the report contained only summary phrases. The raw findings lived in the R161-E-AUDIT worklog entry (worklog.md:596). Every one of those 17 findings was re-verified against the LIVE catalog below, and the full 45-product sweep was re-run from scratch to complete the census.

**Method:** `GET https://subnation.ly/api/products` (list, 45 active products, dumped 2026-10-17 20:30 UTC) → `GET https://subnation.ly/api/products/by-slug/<slug>` for **all 45 products** (20:31–20:33 UTC; the detail endpoint exposes `description`, `description_long`, `faq[]`, `features[]`, `seo_title`, `seo_description`, `usage_terms`, `variants` incl. `plan_label`/`duration_label`/price). Vendor facts verified via web search (20:34–20:37 UTC) and cross-checked against Lane D's concurrent `docs/engineering/R162/commercial-truth-verification.md` (same round, disjoint file). Evidence snapshot: `/tmp/r162-a-evidence/` (45 by-slug JSONs + 13 `ws-*.json` search results) — `/tmp` is ephemeral, so every load-bearing quote below is reproduced verbatim in this document.

**Scope — DB-owned copy.** Everything in this document lives in the production database, not in this repo. The repo cannot fix these directly; all proposed changes are applied by the operator through the admin panel (paths per finding, §"Application path"). The SEO importer (`scripts/src/import-seo.ts`) is **not** the path for any of these — it only joins keyword metadata onto products (slug-first, exact-name fallback); it never writes product copy.

**Baseline state of the live catalog (for context):** 45 active products (streaming 17, music 11, software 7, vpn 4, ai-tools 2, seo-tools 2, education 2); 44/45 sold out, 1 available (Lifetime Cloud Storage). All corrections below are therefore pre-restock hygiene, not live-traffic hotfixes. `seo_title` is defect-free across 45/45 (uniform template «X — اشتراك أصلي بالدينار الليبي | SubNation»), and `usage_terms` runs two uniform templates (account products / license products) with no defects — neither field appears below.

---

## Summary count table

| Dimension | Count |
| --- | --- |
| **Total findings** | **36** |
| Recovered from the R161-E census (F1–F17) | 17 (F11/F17 are the two sides of the Netflix question, as the round split them: description claim vs variant tiering) |
| **New in this census** (F18–F36) | **19** (F21 and F36 surfaced jointly with Lane D's R162-D verification) |
| P1 | 0 (nothing breaks checkout/search today; all products but one are sold out) |
| P2 | 8 — F11, F14, F16, F17, F18, F19, F20, F21 |
| P3 | 28 |
| Unambiguous mechanical fixes | 24 |
| Require owner approval / business decision | 12 — F11, F12, F14, F15, F16, F17, F19, F21, F27, F29, F33, F34 |

Primary issue type: linguistic 12 · terminology 5 · variant mismatch 5 · factual claim 8 · unit drift 1 · business decision 5.

### Finding index

| # | Product (id · slug) | Class | Sev. | Disposition |
| --- | --- | --- | --- | --- |
| F1 | Tidal (36 · `tidal`) | linguistic | P3 | mechanical |
| F2 | HMA VPN Pro (49 · `hma-vpn-pro`) | linguistic | P3 | mechanical |
| F3 | Qobuz (40 · `qobuz`) | linguistic | P3 | mechanical |
| F4 | Skillshare (54 · `skillshare`) | linguistic | P3 | mechanical |
| F5 | TuneIn Premium (42 · `tunein-premium`) | linguistic | P3 | mechanical |
| F6 | Brain.fm Pro (44 · `brain-fm-pro`) | terminology | P3 | mechanical |
| F7 | AMC+ (29 · `amc-plus`) | terminology | P3 | mechanical |
| F8 | Sling TV (30 · `sling-tv`) | variant mismatch | P3 | mechanical (default proposed) |
| F9 | Hulu (26 · `hulu`) | terminology | P3 | mechanical (default proposed) |
| F10 | cPanel (61 · `cpanel`) | variant mismatch | P3 | mechanical |
| F11 | Netflix (1 · `netflix-premium`) | factual claim | P2 | **owner** |
| F12 | Pandora Premium (38 · `pandora-premium`) | variant mismatch | P3 | **owner** (2 options) |
| F13 | Lifetime Cloud Storage (62 · `lifetime-cloud-storage`) | unit drift | P3 | mechanical |
| F14 | Ahrefs (52 · `ahrefs`) | business decision (price) | P2 | **owner** |
| F15 | Headspace (43 · `headspace`) | business decision (taxonomy) | P3 | **owner** |
| F16 | Windows 8 (58 · `windows-8`) | business decision (EOL) | P2 | **owner** |
| F17 | Netflix (1 · `netflix-premium`) | variant mismatch | P2 | **owner** |
| F18 | Brain.fm Pro (44 · `brain-fm-pro`) | variant mismatch | P2 | mechanical after 1 confirmation |
| F19 | Funimation (33 · `funimation`) | business decision + factual claim | P2 | **owner** |
| F20 | OSN+ (24 · `osn-plus`) | factual claim | P2 | mechanical |
| F21 | cPanel (61 · `cpanel`) | factual claim | P2 | **owner** |
| F22 | Prime Video (17 · `amazon-prime-video`) | linguistic | P3 | mechanical |
| F23 | Hulu (26 · `hulu`) | linguistic + stale fact | P3 | mechanical |
| F24 | IPVanish (48 · `ipvanish`) | linguistic (+claim softening) | P3 | mechanical (+light nod) |
| F25 | Netflix (1 · `netflix-premium`) | linguistic | P3 | mechanical |
| F26 | SoundCloud Go+ (37 · `soundcloud-go-plus`) | linguistic | P3 | mechanical |
| F27 | SoundCloud Go+ (37 · `soundcloud-go-plus`) | factual claim | P3 | **owner** |
| F28 | Tidal (36 · `tidal`) | terminology | P3 | mechanical |
| F29 | Hallmark Movies Now (34 · `hallmark-movies-now`) | business decision (brand) | P3 | **owner** |
| F30 | Windows 8 (58 · `windows-8`) | variant mismatch | P3 | mechanical |
| F31 | Headspace (43 · `headspace`) | linguistic | P3 | mechanical |
| F32 | Grammarly Pro (60 · `grammarly-pro`) | linguistic (+unverified count) | P3 | mechanical |
| F33 | Fox Now (32 · `fox-now`) | factual claim | P3 | **owner** |
| F34 | Ahrefs (52 · `ahrefs`) | factual claim (stale specs) | P3 | **owner verify**, then mechanical |
| F35 | Napster (39 · `napster`) | linguistic | P3 | mechanical |
| F36 | ExpressVPN (46 · `expressvpn`) | factual claim (stale number) | P3 | mechanical after 1 confirmation |

---

## Part 1 — The 17 deferred R161 findings, re-verified against the live catalog

### F1 — Tidal: «للمحبيين» misspelling

- **(a) Product:** id 36 · slug `tidal` · name «Tidal» · category music
- **(b) Field + current text (verbatim):** `description` and `seo_description` (identical copy):
  «Tidal HiFi — صوت عالي الدقة وبدون فقدان للمحبيين الحقيقيين.»
- **(c) Proposed corrected text:**
  «Tidal HiFi — صوت عالي الدقة وبدون فقدان لعشاق الصوت الحقيقيين.»
  («للمحبيين» is a hypercorrect plural construct — the standard form is «للمحبين»; we go further and adopt the register the product itself already uses in `faq[0]` («لمحبي الصوت الحقيقيين») and its sibling Qobuz uses («لعشاق الصوت الحقيقيين»), keeping the two audiophile products tonally aligned.)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/tidal` (both fields identical, quoted above). The correct form already appears in the same product's `faq[0]`.
- **(f) Customer impact + severity:** visible on the product card, PDP and Google snippet of an audiophile-flagship product; spelling error erodes trust in a store whose whole pitch is «اشتراك أصلي». **P3.**
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** trust/expectations; SEO snippet quality.
- **(i) Application path:** admin panel → المنتجات → Tidal → تحرير: fix `description` and `seo_description` (the product form owns both fields).

### F2 — HMA: «خوادم واسعة» wrong wording

- **(a) Product:** id 49 · slug `hma-vpn-pro` · name «HMA VPN Pro» · category vpn
- **(b) Field + current text (verbatim):** `description` and `seo_description`:
  «HMA VPN Pro — خوادم واسعة وأدوات خصوصية متقدمة.»
- **(c) Proposed corrected text:**
  «HMA VPN Pro — شبكة خوادم عالمية وأدوات خصوصية متقدمة.»
  (Lifts the correct phrase from the product's own `description_long`: «شبكة خوادم عالمية واسعة». «خوادم واسعة» literally reads "wide servers".)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/hma-vpn-pro` (`description_long` already carries the correct phrasing).
- **(f) Customer impact + severity:** card/snippet-level wording; **P3.**
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** expectations/SEO snippet.
- **(i) Application path:** admin panel product form → `description` + `seo_description`.
- *Follow-up note (optional, P3):* `faq[0]` says «بخوادم في أكثر من مئتي دولة وموقع» — a vague conflation of countries and locations (vendor lists ~190+ countries / 290+ locations). Optional refresh once verified on hidemyass.com.

### F3 — Qobuz: «لعشاق الفيدِليتي» incorrect transliteration

- **(a) Product:** id 40 · slug `qobuz` · name «Qobuz» · category music
- **(b) Field + current text (verbatim):** `description` and `seo_description`:
  «Qobuz — صوت استوديو بجودة Lossless لعشاق الفيدِليتي.»
- **(c) Proposed corrected text:**
  «Qobuz — صوت استوديو بجودة Lossless لعشاق الصوت الحقيقيين.»
  (The transliteration «الفيدِليتي» — with an anomalous kasra diacritic — is non-standard and meaningless to most readers. The product's own `description_long` already says «تجربة موجهة لعشاق الصوت الحقيقيين».)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/qobuz`.
- **(f) Customer impact + severity:** card/snippet of the second audiophile product; **P3.**
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** expectations/SEO snippet.
- **(i) Application path:** admin panel product form → `description` + `seo_description`.

### F4 — Skillshare: «بتعلم بالمشاريع» clipped grammar

- **(a) Product:** id 54 · slug `skillshare` · name «Skillshare» · category education
- **(b) Field + current text (verbatim):** `description` and `seo_description`:
  «Skillshare — آلاف الدورات الإبداعية والمهنية بتعلم بالمشاريع.»
- **(c) Proposed corrected text:**
  «Skillshare — آلاف الدورات الإبداعية والمهنية بأسلوب التعلم بالمشاريع.»
  (The `description_long` already carries the grammatical wrapper: «بأسلوب تعلم بالمشاريع العملية». The short form's bare verbal-noun chain «بتعلم بالمشاريع» reads as broken.)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/skillshare`.
- **(f) Customer impact + severity:** **P3**; education-category flagship card copy.
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** expectations/SEO snippet.
- **(i) Application path:** admin panel product form → `description` + `seo_description`.

### F5 — TuneIn: dangling «والمباريات مباشرة»

- **(a) Product:** id 42 · slug `tunein-premium` · name «TuneIn Premium» · category music
- **(b) Field + current text (verbatim):** `description` and `seo_description`:
  «TuneIn Premium — آلاف محطات الراديو والبودكاست والمباريات مباشرة.»
- **(c) Proposed corrected text:**
  «TuneIn Premium — آلاف محطات الراديو والبودكاست وبث مباشر للمباريات.»
  (The trailing «مباشرة» is an adverb with no verb. The `description_long` already has the correct shape: «بث مباشر للمباريات والدوريات الرياضية (حسب الباقة والإقليم)».)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/tunein-premium`.
- **(f) Customer impact + severity:** **P3**; card/snippet copy.
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** expectations/SEO snippet.
- **(i) Application path:** admin panel product form → `description` + `seo_description`.

### F6 — Brain.fm: «موسيقى عصبية علمية» wrong wording

- **(a) Product:** id 44 · slug `brain-fm-pro` · name «Brain.fm Pro» · category music
- **(b) Field + current text (verbatim):**
  - `description` + `seo_description`: «Brain.fm — موسيقى عصبية علمية للتركيز والاسترخاء والنوم.»
  - `description_long` (first clause): «Brain.fm يولّد موسيقى مؤثرات عصبية مصممة علميًا لتحفيز حالات الدماغ:»
- **(c) Proposed corrected text:**
  - `description`/`seo_description`: «Brain.fm — موسيقى وظيفية مبنية على علم الأعصاب للتركيز والاسترخاء والنوم.»
  - `description_long`: «Brain.fm يولّد موسيقى وظيفية مصممة علمياً لتوجيه حالات الدماغ:»
- **(d) Issue type:** terminology
- **(e) Evidence:** live `by-slug/brain-fm-pro`; vendor self-description (brain.fm): «functional music … using cutting edge neuroscience» — the vendor's term is *functional music*, and «موسيقى عصبية علمية» reads as "neurological scientific music".
- **(f) Customer impact + severity:** **P3**; mislabels the product's actual mechanism to a niche audience.
- **(g) Disposition:** unambiguous correction (vendor term known).
- **(h) Expected effect:** expectations (correct product framing).
- **(i) Application path:** product form → `description` + `seo_description`; enrichment panel (publish with final_text override) → `description_long`.
- *Cross-reference:* F18 — the same product's duration copy contradicts its variant.

### F7 — AMC+: untranslated "universe" (+ same-page wording nits)

- **(a) Product:** id 29 · slug `amc-plus` · name «AMC+» · category streaming
- **(b) Field + current text (verbatim):**
  - `description` + `seo_description`: «AMC+ بمسلسلات The Walking Dead universe وإنتاجات AMC وBBC America.»
  - `description_long` opens: «عالم AMC+ : مسلسلات The Walking Dead بكل فروعها،» (note the stray space before the colon in «AMC+ :»)
  - `faq[0]` (excerpt): «عالم The Walking Dead بكل مسلسلاته ومرافقه، … ومنطقة قوية لمحبي الدراما الأمريكية والرعب.»
- **(c) Proposed corrected text:**
  - `description`/`seo_description`: «AMC+ بمسلسلات عالم The Walking Dead وإنتاجات AMC وBBC America.»
  - `description_long`: «عالم AMC+: مسلسلات The Walking Dead بكل فروعها،» (close the stray space)
  - `faq[0]`: «…بكل مسلسلاته وامتداداته…» and «وجهة قوية لمحبي الدراما الأمريكية والرعب.» (replaces the non-idiomatic «مرافقه» and «منطقة قوية»)
- **(d) Issue type:** terminology (English "universe" left untranslated inside an Arabic sentence)
- **(e) Evidence:** live `by-slug/amc-plus`.
- **(f) Customer impact + severity:** **P3**; the dangling English word breaks the Arabic sentence mid-read on cards and snippets.
- **(g) Disposition:** unambiguous corrections (one edit session).
- **(h) Expected effect:** expectations/SEO snippet quality.
- **(i) Application path:** product form → `description` + `seo_description`; enrichment panel → `description_long` + `faq`.

### F8 — Sling TV: description/variants script mismatch (Orange/Blue vs أورانج/بلو)

- **(a) Product:** id 30 · slug `sling-tv` · name «Sling TV» · category streaming
- **(b) Field + current text (verbatim):**
  - `description` + `seo_description`: «Sling TV — تلفاز أمريكي مباشر (Orange/Blue/مجمع) بدون اشتراك تقليدي.»
  - `description_long`: «قنوات أمريكية مباشرة عبر الإنترنت: باقة Orange للترفيه والعائلة، باقة Blue للأخبار والقنوات الأساسية، أو الباقة المجمعه Orange + Blue بكل القنوات.» (also carries the typo «المجمعه» — ه where ة belongs)
  - `faq[0]`: «أورانج: قنوات رياضية وعائلية بجهاز بث واحد. بلو: قنوات إخبارية وترفيهية بثلاثة أجهزة متزامنة. المجمع يجمع القائمتين معاً بأفضل قيمة — أكثر من 45 قناة أمريكية مباشرة.»
  - variants: «أورانج — شهر واحد», «بلو — شهر واحد», «بلو + أورانج — شهر واحد», … (Arabic transliterations)
- **(c) Proposed corrected text:** lead with the Arabic the customer selects at checkout, keep the official Latin names once as glosses:
  - `description`/`seo_description`: «Sling TV — تلفاز أمريكي مباشر (أورانج/بلو/المجمّعة) بدون اشتراك تقليدي.»
  - `description_long`: «قنوات أمريكية مباشرة عبر الإنترنت: باقة أورانج (Sling Orange) للترفيه والعائلة، باقة بلو (Sling Blue) للأخبار والقنوات الأساسية، أو الباقة المجمّعة أورانج + بلو (Sling Orange & Blue) بكل القنوات.» — also fixes «المجمعه».
  - variants: **unchanged** (أورانج/بلو are the site dialect, defined by the FAQ; changing them would touch the R142 Arabic-search variantTerms for no benefit).
- **(d) Issue type:** variant mismatch / script inconsistency
- **(e) Evidence:** live `by-slug/sling-tv`; vendor (sling.com/service/compare-plans + channel FAQ): Sling Orange — sports & family, **1 stream**; Sling Blue — news & entertainment, **3 streams**; the FAQ's facts match the vendor exactly, and Orange == Blue pricing mirrors the vendor's identical $45.99 (verified by R162-D — the equal pricing is *not* an error). Lane D also notes «أورانج» is a telecom brand name familiar in the region — the Latin gloss in one place removes residual ambiguity.
- **(f) Customer impact + severity:** **P3**; purely cosmetic bridging — no factual error (facts verified vendor-true).
- **(g) Disposition:** mechanical with a chosen default (the Arabic-first direction above); a Latin-gloss-in-variant-labels alternative exists but changes checkout-visible labels for no accuracy gain.
- **(h) Expected effect:** selection clarity (description terms == variant labels the customer taps).
- **(i) Application path:** product form → `description` + `seo_description`; enrichment panel → `description_long`.

### F9 — Hulu: «Live TV» vs «قنوات مباشرة» terminology mismatch

- **(a) Product:** id 26 · slug `hulu` · name «Hulu» · category streaming
- **(b) Field + current text (verbatim):** `description` + `seo_description` (identical): «Hulu بمسلسلات أمريكية يوم بعد العرض + باقات مع/بدون إعلانات + خيارات Live TV.» Further Latin «Live TV» occurrences: `description_long` («الباقات مع Live TV تشمل قنوات رياضية وإخبارية وترفيهية مباشرة.»), `faq[0]` («…تضيفان قنوات مباشرة Live TV بأكثر من 75 قناة أمريكية…»), `faq[2]` question («هل تعمل باقات Live TV في ليبيا؟») and `features[2]` («باقات Live TV بالقنوات المباشرة») — while the variants the customer selects say «مع الإعلانات + قنوات مباشرة».
- **(c) Proposed corrected text:** Arabic-first with one Latin gloss: «خيارات القنوات المباشرة (Live TV)» in the short description; «الباقات مع القنوات المباشرة (Live TV) تشمل…» in `description_long`; «قنوات مباشرة (Live TV)» in `faq[0]`; «هل تعمل باقات القنوات المباشرة (Live TV) في ليبيا؟» for `faq[2]`; `features[2]` → «باقات القنوات المباشرة (Live TV)». Variants unchanged.
- **(d) Issue type:** terminology (desc↔variant script mismatch)
- **(e) Evidence:** live `by-slug/hulu`; vendor naming is «Hulu + Live TV» (hulu.com/live-tv) — the Latin gloss preserves the searchable official name.
- **(f) Customer impact + severity:** **P3**; the term the copy sells («Live TV») is not the term on the buy button («قنوات مباشرة»).
- **(g) Disposition:** mechanical with a chosen default (Arabic-first, gloss once).
- **(h) Expected effect:** selection (copy == checkout labels); SEO (keeps the «Live TV» token once).
- **(i) Application path:** product form → `description` + `seo_description`; enrichment panel → `description_long` + `faq`; `features[2]` — see the closing section's features gap note.
- *Cross-reference:* F23 (same product, same FAQ sentence — typo + stale channel count).

### F10 — cPanel: variant «خادم مخصص» vs description «Dedicated»

- **(a) Product:** id 61 · slug `cpanel` · name «cPanel» · category software
- **(b) Field + current text (verbatim):** `description` + `seo_description`: «رخصة cPanel للخوادم — VPS أو Dedicated، اشتراك أو مدى الحياة.» — while variants are «خادم مخصص — شهر واحد» etc. and `faq[0]` uses «ورخصة الخادم المخصص Dedicated للأجهزة الكاملة».
- **(c) Proposed corrected text:**
  «رخصة cPanel للخوادم — VPS أو خادم مخصص (Dedicated)، اشتراك أو مدى الحياة.»
  (Aligns the short copy with the variant label; keeps the Latin class name once as a gloss; VPS stays Latin — it is the universal technical term.)
- **(d) Issue type:** variant mismatch (script)
- **(e) Evidence:** live `by-slug/cpanel`; vendor licensing context (cpanel.net/pricing + Store License Tiers, verified R162-D): the VPS/Dedicated axis maps to cPanel's Cloud vs Metal license classes — a legitimate resale axis, though the account-tier axis (Solo/Admin/Pro/Premier) is the one that determines what a buyer gets. The identical VPS/Dedicated pricing at each duration (99.8 / 980 / 5980) is consistent-by-design per R162-D's cross-duration sweep (both variants presumably deliver the same tier) — no price action needed; the deeper copy claims are F21.
- **(f) Customer impact + severity:** **P3**; terminology bridging only.
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** selection clarity (copy == variant labels).
- **(i) Application path:** product form → `description` + `seo_description`.

### F11 — Netflix: blanket 4K claim over a tierless offer (description side)

- **(a) Product:** id 1 · slug `netflix-premium` · name «Netflix» (name carries no tier) · category streaming
- **(b) Field + current text (verbatim):**
  - `description` + `seo_description`: «اشتراك Netflix بمحتوى غير محدود بجودة 4K — باقات من شهر إلى سنة كاملة بأسعار منافسة.»
  - `description_long`: «استمتع بمكتبة Netflix الضخمة من الأفلام والمسلسلات والوثائقيات برمج عالمي، بجودة تصل إلى 4K Ultra HD وبدون إعلانات داخل المحتوى المتقدم. …»
  - `faq[0]`: «باقة Netflix Premium تدعم البث بدقة 4K Ultra HD على أربع شاشات متزامنة في نفس الوقت، مع تحميل المحتوى للمشاهدة بدون إنترنت. …»
  - variants: 4 duration-only labels (`plan_label: null`).
- **(c) Proposed corrected text — depends on what is actually delivered (owner confirms the tier):**
  - **Option A (delivered accounts are Premium):** tighten the wording to bind the claim: `description` → «اشتراك Netflix (باقة Premium) بمحتوى غير محدود بجودة تصل إلى 4K Ultra HD — باقات من شهر إلى سنة كاملة بأسعار منافسة.» `description_long` → «استمتع بمكتبة Netflix الضخمة من الأفلام والمسلسلات والوثائقيات العالمية، بجودة تصل إلى 4K Ultra HD وبدون إعلانات. …» (this also fixes F25's «برمج عالمي» and the odd «داخل المحتوى المتقدم»).
  - **Option B (delivered accounts are Standard/1080p):** replace the 4K claims with «بجودة Full HD على شاشتين» and rewrite `faq[0]` to match.
  - **Option C (both tiers stocked):** restructure into tier variants — see F17.
- **(d) Issue type:** factual claim (unbound capability claim)
- **(e) Evidence:** live `by-slug/netflix-premium`; vendor (help.netflix.com/en/node/24926 «Plans and Pricing»): Premium $26.99/mo = 4K Ultra HD + HDR, 4 devices; Standard $19.99 = 1080p, 2 devices; Standard with ads $8.99 = 1080p, 2 devices. Only Premium supports 4K, and Netflix sells no 3/6/12-month plans (the durations are SubNation constructs). R162-D verdict: the claim matches Premium exactly **but is unbound** — the tier appears only in one FAQ answer, while the product name and all variant labels are tierless; `faq[2]` discloses the account is shared/«مشترك في إدارة مركزية», so the 4K claim rides entirely on the tier of the shared accounts.
- **(f) Customer impact + severity:** flagship product; an unfulfillable quality claim is a complaint/refund dispute waiting for the restock. **P2.**
- **(g) Disposition:** **requires owner approval** (which tier is delivered?).
- **(h) Expected effect:** expectations (accurate quality claim), checkout (tier visible where the decision is made), SEO snippet honesty.
- **(i) Application path:** product form → `description` + `seo_description`; enrichment panel → `description_long` + `faq`; if Option C → variants dialog.

### F12 — Pandora: tier-dialect drift inside one variant family

- **(a) Product:** id 38 · slug `pandora-premium` · name «Pandora Premium» · category music
- **(b) Field + current text (verbatim):** variant `plan_label`s mix scripts: «Plus» (Latin), «بريميوم», «عائلي» (×4 durations each); `description_long`: «ثلاث مستويات: Plus وPremium وFamily بتفعيل فوري وضمان استبدال.»; `features[3]`: «باقات Plus وPremium وFamily».
- **(c) Proposed corrected text — two coherent options:**
  - **Option A (recommended): all-Arabic family** — variants «بلس — شهر واحد» / «بريميوم — شهر واحد» / «عائلي — شهر واحد»; `description_long` → «ثلاث مستويات: بلس وبريميوم والعائلية بتفعيل فوري وضمان استبدال.»; `features[3]` → «باقات بلس وبريميوم وعائلية». Why: the site's tier vocabulary is Arabic-first (Disney+/OSN+ use أساسي/قياسي/بريميوم), family is universally «عائلي», and — critically for search — the R142 Arabic-search variantTerms: renaming «بريميوم» → «Premium» would strip the Arabic tier token from search matching, while «بلس» only adds a token.
  - **Option B: all-Latin family** — «Plus» / «Premium» / «Family» in variants, `description_long`/`features` unchanged (they already use Latin).
- **(d) Issue type:** variant mismatch (dialect drift within one family)
- **(e) Evidence:** live `by-slug/pandora-premium`; vendor (pandora.com/upgrade + the family-plan page): Pandora Plus $5.99/mo, Pandora Premium, Pandora Premium Family $19.99/mo («Up to six accounts… All Pandora Premium Features»). R162-D verdict: honest tier mapping, no invented tiers — the defect is purely the mixed script inside one family.
- **(f) Customer impact + severity:** **P3**; the variant selector reads as three unrelated concepts.
- **(g) Disposition:** **requires owner choice** between A and B (default: A).
- **(h) Expected effect:** selection (coherent tier ladder); search (Option A preserves Arabic tier-term matching).
- **(i) Application path:** «الباقات» variants dialog → edit the 4 «Plus» variant `plan_label`s; enrichment panel → `description_long`; `features[3]` — see closing gap note.

### F13 — Unit drift: «جيجا» vs «جيجابايت»

- **(a) Product:** id 62 · slug `lifetime-cloud-storage` · name «Lifetime Cloud Storage» · category software (the only in-stock product)
- **(b) Field + current text (verbatim):** `description` + `seo_description`: «تخزين سحابي مدى الحياة — من 500 جيجا إلى غير محدود.» — while `description_long`, `faq[0]` and all three variant labels use «جيجابايت»/«تيرابايت» («500 جيجابايت», «1 تيرابايت»).
- **(c) Proposed corrected text:** «تخزين سحابي مدى الحياة — من 500 جيجابايت إلى غير محدود.»
- **(d) Issue type:** unit drift
- **(e) Evidence:** live `by-slug/lifetime-cloud-storage`; a fresh scan of all 45 products found «جيجا» (without بايت) **only** in these two fields — this is the single unit-drift site in the catalog.
- **(f) Customer impact + severity:** **P3**; the in-stock product's card says one unit, its buy buttons another.
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** expectations/selection consistency on the one purchasable product.
- **(i) Application path:** product form → `description` + `seo_description`.

### F14 — Ahrefs: قياسي-سنوي == متقدم-سنوي == 15,980 (possible mislabel)

- **(a) Product:** id 52 · slug `ahrefs` · name «Ahrefs» · category seo-tools
- **(b) Field + current text (verbatim):** variant 227 «قياسي — سنوي» price 15,980; variant 228 «متقدم — سنوي» price 15,980. Monthly ladder for contrast: لايت 1,980 / قياسي 3,980 / متقدم 5,980; لايت — سنوي 11,980.
- **(c) Proposed resolution — decision options:** (i) **mislabel (most likely):** correct متقدم — سنوي to its intended price. The family's annual pattern suggests ≈ 4× monthly → 5,980 × 4 ≈ 23,920 → **23,980** (mirroring قياسي سنوي 15,980 ≈ 4× 3,980). The business must confirm the intended margin number from the supplier sheet before applying. (ii) **deliberate promo:** if 15,980 is intentional, keep it but add one FAQ line («عرض سنوي على المتقدم») so it doesn't read as an error.
- **(d) Issue type:** business decision (price field)
- **(e) Evidence:** live `by-slug/ahrefs` variants; the product's own monthly ladder prices the two tiers apart at 3,980 < 5,980; the vendor's ladder does too (ahrefs.com/pricing: Standard $249/mo < Advanced $449/mo, annual ≈ 10× monthly per tier). R162-D's cross-duration tier-price consistency validator flags **exactly this pair and nothing else across all 45 products** (its test file `backend/src/lib/__tests__/catalog-quality.test.ts` pins the live matrix).
- **(f) Customer impact + severity:** a customer who compares variants reads the top annual tier as a copy error and hesitates at checkout; if the real intent was ~23,980, the store also loses revenue on every sale. **P2.**
- **(g) Disposition:** **requires owner approval** (money field; number must come from the business).
- **(h) Expected effect:** checkout (price trust + correct charge).
- **(i) Application path:** «الباقات» variants dialog → edit variant 228's price (the dialog drives the pricing engine; variant edits keep `products.price = MIN(active variant price)` consistent automatically).

### F15 — Headspace sits in the music category

- **(a) Product:** id 43 · slug `headspace` · name «Headspace» · category `music` · category label now «الموسيقى والصوتيات» (R161-C rename)
- **(b) Field + current text (verbatim):** `description` + `seo_description`: «Headspace — تأمل موجّه ورياضة ذهنية لنمط حياة أهدأ.» — against the category label «الموسيقى والصوتيات».
- **(c) Proposed resolution — decision options:** (i) **keep in music (recommended):** the R161-C label rename already absorbs an audio-meditation product under «صوتيات»; zero migration cost; the description is accurate and doesn't claim music. (ii) move to education («التعليم والمكتبات») — a worse fit. (iii) create a wellness category for one product — not justified.
- **(d) Issue type:** business decision (taxonomy)
- **(e) Evidence:** live `by-slug/headspace` (`category: "music"`); repo `frontend/src/lib/categories.ts:126` (label «الموسيقى والصوتيات», R161-C).
- **(f) Customer impact + severity:** **P3**; discovery/labeling question only.
- **(g) Disposition:** **requires owner decision** (default: keep, no change).
- **(h) Expected effect:** selection/discovery if changed; none if kept.
- **(i) Application path:** if moved — admin panel product form → `category` dropdown (a one-field DB change; no repo change needed).
- *Cross-reference:* F31 (same product, FAQ wording nit).

### F16 — Windows 8: EOL product still sold (business decision)

- **(a) Product:** id 58 · slug `windows-8` · name «Windows 8» · category software (currently sold out)
- **(b) Field + current text (verbatim):** `description_long`: «مفتاح ترخيص Windows 8 أصلي لكل إصدارات النظام: تسليم فوري خلال دقيقة من الدفع وتفعيل دائم على جهاز واحد. مناسب للأجهزة القديمة أو الأنظمة المخصصة.» `faq[1]`: «لأجهزة قديمة مواصفاتها لا تحتمل ويندوز 10 بسلاسة، أو لأنظمة قديمة تتطلب توافق ويندوز 8 لتشغيل برامج مخصصة — أرخص وأخف على الأجهزة القديمة وما زالت تفعل وترخص رسمياً.»
- **(c) Proposed resolution — decision options:** (i) **keep + disclose (recommended if keys still activate):** append an EOL sentence to `description_long`: «ملاحظة: انتهى الدعم الرسمي من مايكروسوفت لويندوز 8.1 في 10 يناير 2023 — النظام يعمل ويفعَّل، لكنه لا يتلقى تحديثات أمنية جديدة، والترقية المجانية لويندوز 10 لم تعد مضمونة التفعيل.» and align `faq[2]`'s «المسار الرسمي متاح» claim. (ii) **archive the product** (precedent: 14 unstockable products were archived in the R98-era catalog rebuild).
- **(d) Issue type:** business decision (EOL disclosure)
- **(e) Evidence:** live `by-slug/windows-8`; vendor: learn.microsoft.com/en-us/lifecycle/products/windows-81 — «Windows 8.1 will reach the end of support on January 10, 2023»; support.microsoft.com «Windows 8.1 support ended on January 10, 2023». R162-D adds: the free 8→10 upgrade era is over (2025-era reports of Win7/8 keys no longer reliably activating Win10), and **Windows 10 itself reached EOL 2025-10-14** — the Windows 10 Home/Pro siblings carry the same no-disclosure pattern («تفعيل فوري ودائم» — دائم is true of the key, not of OS support) and belong in the same owner decision.
- **(f) Customer impact + severity:** selling an OS with no security updates as «تفعيل دائم» without disclosure is an honesty/commercial-truth gap. **P2.**
- **(g) Disposition:** **requires owner decision.**
- **(h) Expected effect:** expectations/support load (disclosure reduces disputes); or catalog trim.
- **(i) Application path:** option (i) — enrichment panel → `description_long` + `faq`; option (ii) — admin panel product form → deactivate/archive.
- *Cross-reference:* F30 (same product's variant script drift).

### F17 — Netflix: tierless variants vs the Premium claim (variant side)

- **(a) Product:** id 1 · slug `netflix-premium` · name «Netflix» · category streaming
- **(b) Field + current text (verbatim):** 4 variants, all `plan_label: null`, duration labels only: «شهر واحد» (79.8), «3 أشهر» (199.8), «6 أشهر» (339.8), «سنة كاملة» (599.8).
- **(c) Proposed resolution — decision options:** (i) **all accounts are Premium:** no variant change is required — bind the tier in the copy instead (F11 Option A: «(باقة Premium)» in `description`, one FAQ statement). (ii) **both tiers are stocked:** restructure to tier variants like Disney+ («أساسي — شهر واحد» / «بريميوم — شهر واحد» × durations) — this also adds Arabic tier tokens to the R142 search variantTerms (a recall win for «نتفلكس بريميوم»-type queries).
- **(d) Issue type:** variant mismatch (tier information absent at the point of choice)
- **(e) Evidence:** live `by-slug/netflix-premium`; vendor plan structure (help.netflix.com, per F11); R162-D: the only place the tier is stated today is one FAQ answer.
- **(f) Customer impact + severity:** the quality claim (4K/4 screens) is decided by the variant the customer picks, yet the tier is invisible there. **P2** (paired with F11).
- **(g) Disposition:** **requires owner decision** (what is stocked?).
- **(h) Expected effect:** checkout (tier visible at selection); search (option ii adds tier terms).
- **(i) Application path:** option (ii) — «الباقات» variants dialog (add `plan_label` to the 4 variants, or create the tier×duration matrix).

---

## Part 2 — New defects found by the fresh 45-product sweep (F18–F36)

### F18 — Brain.fm: copy says «باقة شهرية», variant says «مدى الحياة»

- **(a) Product:** id 44 · slug `brain-fm-pro` · name «Brain.fm Pro» · category music
- **(b) Field + current text (verbatim):** `description_long` (last sentence): «باقة شهرية اقتصادية بضمان استبدال.» · `features[3]`: «باقة شهرية اقتصادية» — versus variant 197: `label` «مدى الحياة», price 60 LYD, and `faq[2]`: «نعم — تدفع مرة واحدة وتملك الوصول مدى الحياة بكل أنماط التركيز والاسترخاء والنوم، بدون اشتراكات شهرية أو أي رسوم لاحقة.»
- **(c) Proposed corrected text:** two sources (variant label + FAQ) vs two stale copy lines → align the copy to the checkout reality: `description_long` → «رخصة مدى الحياة بضمان استبدال.»; `features[3]` → «رخصة مدى الحياة (دفع مرة واحدة)». (If the truth is actually monthly, rename the variant instead — owner confirms which side is real.)
- **(d) Issue type:** variant mismatch (copy↔variant contradiction)
- **(e) Evidence:** live `by-slug/brain-fm-pro` (all four fields quoted above).
- **(f) Customer impact + severity:** a customer reading «باقة شهرية» buys the «مدى الحياة» button — direct expectation mismatch on duration, a dispute/support generator. **P2.**
- **(g) Disposition:** mechanical after one confirmation (is delivery lifetime? — the variant + FAQ both say yes).
- **(h) Expected effect:** expectations/checkout (duration claim == duration sold).
- **(i) Application path:** enrichment panel → `description_long`; `features[3]` — see the closing section's features write-surface gap.

### F19 — Funimation: discontinued service still sold + inaccurate 4K claim

- **(a) Product:** id 33 · slug `funimation` · name «Funimation» · category streaming
- **(b) Field + current text (verbatim):** `faq[0]`: «الأساسية تعرض الأنمي بدقة Full HD على شاشة واحدة مع إعلانات، والبريميوم ترفعها إلى 4K على أربع شاشات بدون إعلانات مع تحميل الحلقات للاستماع والمشاهدة دون اتصال — خيار عشاق الأنمي الجادين.» (also note the template bleed-through «للاستماع والمشاهدة» — a music-product phrase in an anime FAQ).
- **(c) Proposed resolution — decision options:** (i) **archive the product (recommended):** Funimation shut down on 2024-04-02; its subscriptions were replaced by Crunchyroll — a restock cannot deliver the service as described. (ii) if the operator actually sources **Crunchyroll** accounts, repurpose the product (name/slug/copy rewrite + drop the 4K claim — Funimation's top tier streamed 1080p; the «ترفعها إلى 4K على أربع شاشات» line appears copied from a Disney+/Netflix template and was never true of Funimation).
- **(d) Issue type:** business decision + factual claim
- **(e) Evidence:** live `by-slug/funimation`; vendor: multiple contemporaneous reports — «Funimation will end its service on April 2nd [2024]» (androidpolice.com), «Funimation subscriptions will be replaced by Crunchyroll ones» (cbr.com), the merger completing Sony's Crunchyroll consolidation.
- **(f) Customer impact + severity:** selling a dead service is a commercial-truth defect worse than any wording bug; the false 4K claim compounds it. **P2.**
- **(g) Disposition:** **requires owner decision.**
- **(h) Expected effect:** catalog honesty; support-load avoidance.
- **(i) Application path:** option (i) — admin panel product form → deactivate (the archive path the operator already used for 14 unstockable products); option (ii) — full product edit + variants dialog + enrichment.

### F20 — OSN+: description contradicts its own FAQ (and the vendor) on device counts

- **(a) Product:** id 24 · slug `osn-plus` · name «OSN+» · category streaming
- **(b) Field + current text (verbatim):** `description_long`: «…باقة القياسي توفر المشاهدة بجودة عالية على شاشة واحدة، بينما تتيح البريميوم جودة 4K ومشاهدة متزامنة على أكثر من جهاز.» — versus `faq[0]`: «الباقة القياسية توفر المحتوى على جهازين بدقة Full HD، بينما البريميوم ترفعها إلى 4K على أربع شاشات متزامنة.»
- **(c) Proposed corrected text:** align `description_long` to the FAQ + vendor: «…باقة القياسي توفر المشاهدة بجودة Full HD على جهازين، بينما تتيح البريميوم جودة 4K ومشاهدة متزامنة على أربع شاشات.»
- **(d) Issue type:** factual claim (internal contradiction)
- **(e) Evidence:** live `by-slug/osn-plus`; vendor (support.osnplus.com FAQs, Aug 2025): «OSN+ Premium Plan: Stream on up to 4 devices simultaneously. OSN+ Standard Plan: Stream on up to 2 devices simultaneously» — the FAQ's numbers match the vendor; the description_long's «شاشة واحدة» matches neither. (Same contradiction independently flagged by R162-D.)
- **(f) Customer impact + severity:** two different device counts on the same page; under-states Standard (or over-states, depending on which the reader trusts). **P2.**
- **(g) Disposition:** mechanical once the vendor numbers are accepted (the FAQ already carries them).
- **(h) Expected effect:** expectations (accurate, self-consistent spec sheet).
- **(i) Application path:** enrichment panel → `description_long`.

### F21 — cPanel: «حسابات غير محدودة» + «مدى الحياة»/«الرسمية» claims vs current cPanel licensing

- **(a) Product:** id 61 · slug `cpanel` · name «cPanel» · category software
- **(b) Field + current text (verbatim):** `description_long`: «رخصة cPanel الرسمية لخوادم VPS أو الخوادم المخصصة: لوحة التحكم الأشهر عالميًا لاستضافة المواقع، مع Softaculous مجانًا وحسابات غير محدودة. اختر اشتراكًا شهريًا أو سنويًا أو رخصة مدى الحياة.» · `faq[1]`: «ثلاثة أوضاع: اشتراك شهري مرن، سنوي أوفر للمشاريع القائمة، أو رخصة مدى الحياة لمرة واحدة تدفعها ولا تشتري مرة أخرى — الحسم الأكبر على المدى الطويل لمن يدير خادمه لسنوات.»
- **(c) Proposed resolution — decision options (owner states what is actually delivered):** (i) replace «حسابات غير محدودة» with the real account count/tier — e.g. «…مع Softaculous مجانًا وعدد حسابات وفق الباقة المسلَّمة» or the specific tier («Solo — حساب واحد», «Premier — حتى 100 حساب»); (ii) substantiate or reframe the lifetime + «الرسمية» framing (cPanel sells no lifetime licenses today — whatever is delivered is a resale construct the «الرسمية… مدى الحياة» wording does not convey); (iii) optional bigger change: surface the account tier (Solo/Admin/Pro/Premier) as the variant axis instead of VPS/Dedicated, since that is the axis that determines what a buyer gets.
- **(d) Issue type:** factual claim
- **(e) Evidence:** live `by-slug/cpanel`; vendor (cpanel.net/pricing + support.cpanel.net Store License Tiers, verified by R162-D): current licensing is account-tier based — Solo (1 account, $29.99/mo), Admin (5), Pro (30), Premier (100, $69.99/mo, +$0.49/account above 100); Metal (dedicated) class only exists in Solo/Premier tiers; «unlimited accounts» was the pre-2020 per-server model, explicitly replaced.
- **(f) Customer impact + severity:** two hard claims in the copy are false or unverifiable under the vendor's current model. **P2.**
- **(g) Disposition:** **requires owner input** (what license/tier is actually delivered?).
- **(h) Expected effect:** expectations (real account limits), honesty of the «رسمية/مدى الحياة» framing.
- **(i) Application path:** enrichment panel → `description_long` + `faq`; option (iii) — variants dialog + product form.

### F22 — Prime Video: «المشاهرة» typo

- **(a) Product:** id 17 · slug `amazon-prime-video` · name «Prime Video» · category streaming
- **(b) Field + current text (verbatim):** `faq[0]` (last sentence): «المشاهرة بدقة تصل إلى 4K على ثلاثة أجهزة متزامنة.»
- **(c) Proposed corrected text:** «المشاهدة بدقة تصل إلى 4K على ثلاثة أجهزة متزامنة.»
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/amazon-prime-video`.
- **(f) Customer impact + severity:** **P3**; visible typo in the PDP FAQ (also rendered in the FAQ JSON-LD).
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** trust/expectations.
- **(i) Application path:** enrichment panel → `faq`.

### F23 — Hulu: «المع إعلانات» typo + stale «75 قناة» count

- **(a) Product:** id 26 · slug `hulu` · name «Hulu» · category streaming
- **(b) Field + current text (verbatim):** `faq[0]`: «المع إعلانات وبدون إعلانات لنفس المكتبة من مسلسلات اليوم التالي للقنوات الأمريكية. الباقتان الممتدتان تضيفان قنوات مباشرة Live TV بأكثر من 75 قناة أمريكية — تلفاز شامل بدون طبق أو كيبل.»
- **(c) Proposed corrected text:** «الباقتان الأساسيتان — مع إعلانات وبدون إعلانات — لنفس المكتبة من مسلسلات اليوم التالي للقنوات الأمريكية. الباقتان الممتدتان تضيفان قنوات مباشرة (Live TV) بأكثر من 95 قناة أمريكية — تلفاز شامل بدون طبق أو كيبل.» (optionally note the included Disney+/ESPN Select bundle per the vendor's current plan page).
- **(d) Issue type:** linguistic + factual staleness
- **(e) Evidence:** live `by-slug/hulu`; vendor: hulu.com/guides/hulu-live-tv-channels + help.hulu.com — «Hulu + Live TV plans start at $89.99 per month for 100+ live channels» / «95+ live TV channels» (R162-D verified). «أكثر من 75» is stale but still literally true — refresh optional-but-recommended while editing the sentence anyway.
- **(f) Customer impact + severity:** **P3.**
- **(g) Disposition:** typo unambiguous; the 75→95+ refresh is mechanical after the one-time vendor-number confirmation.
- **(h) Expected effect:** trust/expectations.
- **(i) Application path:** enrichment panel → `faq`.

### F24 — IPVanish: «عتقاد» typo (+ «المزود الوحيد» over-claim)

- **(a) Product:** id 48 · slug `ipvanish` · name «IPVanish VPN» · category vpn
- **(b) Field + current text (verbatim):** `faq[1]`: «نعم — IPVanish من قلة المزودين الذين يمتلكون عتقاد شبكتهم بالكامل بدل استئجارها، ما يمنحهم تحكماً كاملاً بالبنية ويقلل مخاطر الوصول الخارجي لبياناتك.» · `faq[0]`: «…المزود الوحيد من هذه الفئة الذي لا يضع سقفاً للأجهزة المتزامنة.»
- **(c) Proposed corrected text:** `faq[1]` → «نعم — IPVanish من المزودين القلائل الذين يمتلكون عتاد شبكتهم بالكامل بدل استئجارها، ما يمنحهم تحكماً كاملاً بالبنية ويقلل مخاطر الوصول الخارجي لبياناتك.» · `faq[0]` → «…من المزودين القلائل في هذه الفئة الذين لا يضعون سقفاً للأجهزة المتزامنة.»
- **(d) Issue type:** linguistic (+ factual-claim softening)
- **(e) Evidence:** live `by-slug/ipvanish`. «عتقاد» is not a word (typo for «عتاد», hardware); «من قلة المزودين» should be «من المزودين القلائل». The «الوحيد» absolute is contestable — Surfshark and others also offer unlimited simultaneous devices (the unlimited-devices claim itself is vendor-true, R162-D verified).
- **(f) Customer impact + severity:** **P3.**
- **(g) Disposition:** typo fixes unambiguous; the «الوحيد» softening is a one-line honesty edit the owner can wave through.
- **(h) Expected effect:** trust/expectations.
- **(i) Application path:** enrichment panel → `faq`.

### F25 — Netflix: «برمج عالمي» garbled fragment

- **(a) Product:** id 1 · slug `netflix-premium` · name «Netflix» · category streaming
- **(b) Field + current text (verbatim):** `description_long` (first sentence): «استمتع بمكتبة Netflix الضخمة من الأفلام والمسلسلات والوثائقيات برمج عالمي، بجودة تصل إلى 4K Ultra HD وبدون إعلانات داخل المحتوى المتقدم.»
- **(c) Proposed corrected text:** folded into F11 Option A: «استمتع بمكتبة Netflix الضخمة من الأفلام والمسلسلات والوثائقيات العالمية، بجودة تصل إلى 4K Ultra HD وبدون إعلانات.» («برمج عالمي» is ungrammatical — likely «برامج عالمية» mangled; the fix lands the adjective in its natural slot and also drops the odd «داخل المحتوى المتقدم».)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/netflix-premium`.
- **(f) Customer impact + severity:** **P3** (PDP body copy).
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** expectations.
- **(i) Application path:** enrichment panel → `description_long` (same edit session as F11).

### F26 — SoundCloud: «مزلات» non-word

- **(a) Product:** id 37 · slug `soundcloud-go-plus` · name «SoundCloud Go+» · category music
- **(b) Field + current text (verbatim):** `faq[1]`: «لأنها منصة اكتشاف فريدة: ريمكسات ومزلات ومسارات لا توجد على أي منصة أخرى، وناشئو الموسيقى يرفعون أعمالهم أولاً بأول.»
- **(c) Proposed corrected text:** «…ريمكسات ومزيجات ومسارات لا توجد على أي منصة أخرى…» (most plausibly «مزيجات» — mixes; alternative: «ميكسات»).
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/soundcloud-go-plus`.
- **(f) Customer impact + severity:** **P3.**
- **(g) Disposition:** near-unambiguous (pick one of the two renderings).
- **(h) Expected effect:** trust.
- **(i) Application path:** enrichment panel → `faq`.

### F27 — SoundCloud: «عائلي» variant framed as a vendor family plan

- **(a) Product:** id 37 · slug `soundcloud-go-plus` · name «SoundCloud Go+» · category music
- **(b) Field + current text (verbatim):** `description_long`: «…باقات فردي وعائلية بتفعيل فوري وضمان استبدال.» · `faq[2]`: «نعم، الباقة العائلية على SoundCloud Go+ تتيح إدارة عدة ملفات تحت حساب واحد بسعر مخفض عن اشتراكات منفصلة — كل مستخدم بقوائمه وتوصياته الخاصة.» · variants: «عائلي — شهر واحد» etc.
- **(c) Proposed resolution — decision options:** SoundCloud sells **no family plan** (its plans page lists only Go/Go+ and a student discount), and one shared login cannot give each member «قوائمه وتوصياته الخاصة». (i) reword honestly to describe the operator arrangement — e.g. `faq[2]` → «الباقة العائلية حساب واحد مشترك بين أفراد العائلة بسعر مخفض عن اشتراكات منفصلة — يدخل إليه الجميع بتسجيل الدخول نفسه.» (owner picks the exact mechanics); (ii) drop the عائلي variants entirely (bigger commercial change).
- **(d) Issue type:** factual claim (operator arrangement described as a vendor feature)
- **(e) Evidence:** live `by-slug/soundcloud-go-plus`; vendor: soundcloud.com/company/plans (no family tier); help.soundcloud.com «Sharing access to an account» (shared accounts carry risk/limitations). Contrast: Spotify/Tidal عائلي variants ARE real vendor family plans — the defect is SoundCloud-specific.
- **(f) Customer impact + severity:** **P3** (family buyers discover shared queues/history instead of the promised per-member profiles).
- **(g) Disposition:** **requires owner framing decision.**
- **(h) Expected effect:** expectations (per-member promises removed or made true).
- **(i) Application path:** enrichment panel → `description_long` + `faq`; option (ii) — variants dialog.

### F28 — Tidal: «فلاتر Master Authenticated» vendor-term misnomer

- **(a) Product:** id 36 · slug `tidal` · name «Tidal» · category music
- **(b) Field + current text (verbatim):** `faq[0]`: «جودة الصوت هي الفارق: Tidal يبث بمعيار HiFi Lossless وفلاتر Master Authenticated بجودة استوديو تصل إلى 24-bit/192kHz — تجربة سامعة لمحبي الصوت الحقيقيين الذين يسمعون الفرق في التفاصيل والعمق.»
- **(c) Proposed corrected text:** «جودة الصوت هي الفارق: Tidal يبث بمعيار HiFi Lossless وتسجيلات معتمدة بمعيار Master Quality Authenticated (MQA) بجودة استوديو تصل إلى 24-bit/192kHz — تجربة سماع غامرة لمحبي الصوت الحقيقيين الذين يسمعون الفرق في التفاصيل والعمق.»
- **(d) Issue type:** terminology
- **(e) Evidence:** live `by-slug/tidal`; Tidal's marks are «HiFi» and «Master Quality Authenticated» (MQA) — a mastering/codec standard, not «فلاتر» (filters); «تجربة سامعة» is also non-idiomatic.
- **(f) Customer impact + severity:** **P3**; audiophile customers are exactly the audience that knows the real term.
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** trust with the target segment.
- **(i) Application path:** enrichment panel → `faq` (same session as F1's sibling fields).

### F29 — Hallmark Movies Now: retired brand name

- **(a) Product:** id 34 · slug `hallmark-movies-now` · name «Hallmark Movies Now» · category streaming
- **(b) Field + current text (verbatim):** product name + `description`: «Hallmark Movies Now — أفلام عائلية ومسلسلات هادئة بلا انقطاع.» (copy otherwise accurate)
- **(c) Proposed resolution — decision options:** (i) rename the product to «Hallmark+» and refresh copy (keep the slug `hallmark-movies-now` to avoid breaking the URL, or coordinate an alias redirect — the storefront's redirect mechanism already exists); (ii) keep the legacy name and add one gloss in `description_long`: «(الاسم الجديد للخدمة منذ سبتمبر 2024: Hallmark+)».
- **(d) Issue type:** business decision (brand freshness)
- **(e) Evidence:** live `by-slug/hallmark-movies-now`; vendor: Hallmark Movies Now rebranded as **Hallmark+**, launching 2024-09-10 at $7.99/mo (variety.com 2024-07-11; newscaststudio.com 2024-07-12).
- **(f) Customer impact + severity:** **P3**; customers searching «Hallmark+» won't map it to this product (search alias consideration), and the copy sells a brand that no longer exists.
- **(g) Disposition:** **requires owner decision.**
- **(h) Expected effect:** selection/discovery (brand-name match with what customers search).
- **(i) Application path:** product form → `name` (+ `description`); enrichment panel → `description_long`.

### F30 — Windows 8: variant script drift («احترافي» vs Latin siblings)

- **(a) Product:** id 58 · slug `windows-8` · name «Windows 8» · category software
- **(b) Field + current text (verbatim):** variants: «احترافي», «Pro N», «Enterprise», «Enterprise N» (all 59.8) · `faq[0]`: «احترافي Pro للاستخدام المتقدم وأدوات الشركات، Pro N مثل الاحترافي بدون مشغل الوسائط، Enterprise للشركات…»
- **(c) Proposed corrected text:** variants → «Pro», «Pro N», «Enterprise», «Enterprise N» (Windows edition names are universally known in Latin; the lone Arabic «احترافي» is the family outlier); `faq[0]` → «Pro للاستخدام المتقدم وأدوات الشركات، Pro N مثل Pro بدون مشغل الوسائط، Enterprise للشركات بمزايا الإدارة المركزية، وEnterprise N نسخة الشركات بدون مشغل الوسائط — النسخ N موجهة للسوق الأوروبي.»
- **(d) Issue type:** variant mismatch (script drift within one family)
- **(e) Evidence:** live `by-slug/windows-8`.
- **(f) Customer impact + severity:** **P3.**
- **(g) Disposition:** unambiguous correction (same class as F10/F12).
- **(h) Expected effect:** selection clarity; search variantTerms (Latin «Pro» token matches the Latin-brand search arm).
- **(i) Application path:** «الباقات» variants dialog → variant `plan_label`; enrichment panel → `faq`. Bundle with the F16 decision (same product).

### F31 — Headspace: «تمارين تنفيس» wording

- **(a) Product:** id 43 · slug `headspace` · name «Headspace» · category music
- **(b) Field + current text (verbatim):** `faq[0]`: «مئات جلسات التأمل الموجه لكل مستوى، تمارين تنفيس لحظية للأوقات الصعبة، تمارين استرخاء ونوم بأصوات هادئة، وبرامج متخصصة للقلق والتركيز والأكل الواعي — رفيق يومي لصحة نفسية أفضل.»
- **(c) Proposed corrected text:** «…تمارين تنفّس لحظية للأوقات الصعبة…» («تنفيس» = venting; breathing = «تنفّس».)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/headspace`.
- **(f) Customer impact + severity:** **P3.**
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** trust.
- **(i) Application path:** enrichment panel → `faq`.

### F32 — Grammarly: broken accusative chain + invented count

- **(a) Product:** id 60 · slug `grammarly-pro` · name «Grammarly Pro» · category software
- **(b) Field + current text (verbatim):** `faq[0]`: «المجاني يصحح الأساسيات فقط. Pro يضيف إعادة صياغة الجمل كاملة، تصحيح نصف مئة قاعدة متقدمة وضوحاً وأسلوباً، كاشفاً نبرة الكتابة، فحص الانتحال، ومولداً بالذكاء الاصطناعي — ترقية حقيقية للمحترفين.»
- **(c) Proposed corrected text:** «المجاني يصحح الأساسيات فقط. Pro يضيف إعادة صياغة الجمل كاملة، تصحيحات متقدمة للوضوح والأسلوب، كشف نبرة الكتابة، فحص الانتحال، ومساعداً يعمل بالذكاء الاصطناعي — ترقية حقيقية للمحترفين.» (fixes the mixed accusative chain — masdar items coordinated with «كاشفاً/ومولداً» — and drops the unverifiable «نصف مئة قاعدة» count.)
- **(d) Issue type:** linguistic (+ factual claim, the invented count)
- **(e) Evidence:** live `by-slug/grammarly-pro`.
- **(f) Customer impact + severity:** **P3.**
- **(g) Disposition:** unambiguous correction (rewritten sentence).
- **(h) Expected effect:** trust.
- **(i) Application path:** enrichment panel → `faq`.

### F33 — Fox Now: paid ad-free tier claim needs substantiation

- **(a) Product:** id 32 · slug `fox-now` · name «Fox Now» · category streaming
- **(b) Field + current text (verbatim):** `faq[1]`: «النسخة المجانية تعرض حلقات محدودة مع إعلانات كثيرة، أما اشتراك Fox Now المميز فيفتح المكتبة كاملة بدون إعلانات مزعجة وبدقة أعلى — تجربة مشاهدة نظيفة وممتعة.»
- **(c) Proposed resolution — decision options:** Fox Now is a free app (ads; full episodes unlocked with a US TV-provider login); Fox's paid streaming service is **Fox Nation** — no public Fox Now paid ad-free tier exists. (i) if the operator delivers TV-provider-unlocked credentials → reword to describe exactly that («حساب موصول بمزود تلفزيوني أمريكي يفتح الحلقات كاملة داخل تطبيق Fox Now»); (ii) if it is actually Fox Nation → rename/rewrite; (iii) if neither → consider archiving.
- **(d) Issue type:** factual claim
- **(e) Evidence:** live `by-slug/fox-now`; vendor structure (fox.com free app + foxnation.com as the paid sibling — general vendor knowledge; the owner's sourcing determines which is delivered).
- **(f) Customer impact + severity:** **P3** (P2 if the product restocks with the current copy).
- **(g) Disposition:** **requires owner confirmation of what is delivered.**
- **(h) Expected effect:** expectations (deliverable claim).
- **(i) Application path:** enrichment panel → `faq` (+ `description` via product form if reframed).

### F34 — Ahrefs: FAQ tier limits are stale vs current plans

- **(a) Product:** id 52 · slug `ahrefs` · name «Ahrefs» · category seo-tools
- **(b) Field + current text (verbatim):** `faq[0]`: «لايت لمشروع واحد: فحص كلمات محدود وتتبع مئة كلمة مفتاحية. قياسي لخمسة مشاريع: حدود أعلى وتتبع 750 كلمة. متقدم للوكالات: 25 مشروعاً وتتبع ألفي كلمة مع بيانات تاريخية أوسع — اختر حجم العمل الذي تديره.»
- **(c) Proposed corrected text:** «لايت لخمسة مشاريع: فحص كلمات محدود وتتبع 750 كلمة مفتاحية. قياسي لعشرين مشروعاً وتتبع ألفي كلمة. متقدم للوكالات: 50 مشروعاً وتتبع خمسة آلاف كلمة مع بيانات تاريخية أوسع — اختر حجم العمل الذي تديره.» — apply after a fresh confirmation on help.ahrefs.com (vendor numbers move; verified 2026-10-17 by R162-D: Lite = 5 projects / 750 tracked keywords; Standard = 20 / 2,000; Advanced = 50 / 5,000).
- **(d) Issue type:** factual claim (stale specs)
- **(e) Evidence:** live `by-slug/ahrefs`; vendor: ahrefs.com/pricing + help.ahrefs.com plan comparison (R162-D verified — the site's current numbers match no current official tier; notably its «قياسي» numbers equal today's **Lite** limits). Contrast: the Semrush product's FAQ tier limits are vendor-correct — this staleness is per-product, not systemic.
- **(f) Customer impact + severity:** **P3**; spec-sheet accuracy for a professional tool buyer.
- **(g) Disposition:** **owner verifies** the current numbers once, then mechanical.
- **(h) Expected effect:** expectations.
- **(i) Application path:** enrichment panel → `faq`.

### F35 — Napster: «وصولاً مباشراً» coordination error

- **(a) Product:** id 39 · slug `napster` · name «Napster» · category music
- **(b) Field + current text (verbatim):** `faq[0]`: «مكتبة تضم أكثر من مئة مليون أغنية بجودة عالية، مع واجهة نظيفة وتوصيات ذكية وصولاً مباشراً لأحدث الإصدارات. الباقة العائلية تخدم حتى ستة أفراد بملفات مستقلة كاملة المزايا.»
- **(c) Proposed corrected text:** «…مع واجهة نظيفة وتوصيات ذكية ووصول مباشر إلى أحدث الإصدارات.» (an accusative circumstantial «وصولاً» cannot coordinate with the genitive noun chain after «مع»; swap to a coordinated genitive noun.)
- **(d) Issue type:** linguistic
- **(e) Evidence:** live `by-slug/napster`.
- **(f) Customer impact + severity:** **P3.**
- **(g) Disposition:** unambiguous correction.
- **(h) Expected effect:** trust.
- **(i) Application path:** enrichment panel → `faq`.

### F36 — ExpressVPN: stale server-country count (105 → 113)

- **(a) Product:** id 46 · slug `expressvpn` · name «ExpressVPN» · category vpn
- **(b) Field + current text (verbatim):** «105 دولة» appears in five places: `description` + `seo_description` (identical: «ExpressVPN — من أشهر وأسرع خدمات VPN عالميًا بخوادم في 105 دولة.»), `description_long` («…خوادم في 105 دولة مع تشفير AES-256…»), `faq[1]` («…خوادم في 105 دولة (أوسع انتشار في السوق)…»), `features[0]` («خوادم في 105 دولة»).
- **(c) Proposed corrected text:** replace 105 → 113 in all five fields after a fresh confirmation on expressvpn.com.
- **(d) Issue type:** factual claim (stale number)
- **(e) Evidence:** live `by-slug/expressvpn`; vendor: expressvpn.com now lists **113 countries** (support article updated Aug 2026 — verified by R162-D's commercial-truth pass).
- **(f) Customer impact + severity:** **P3**; spec staleness on a leading VPN product.
- **(g) Disposition:** mechanical after the one-time vendor-number confirmation.
- **(h) Expected effect:** expectations/SEO freshness.
- **(i) Application path:** product form → `description` + `seo_description`; enrichment panel → `description_long` + `faq`; `features[0]` — see the features gap note below.

---

## Minor notes (below the finding bar — noted for the record, no row needed)

- **Apple TV+**: short `description` uses «دولبي أتموس» while `description_long`/`features` use «Dolby Atmos» — harmonize with a one-time gloss («دولبي أتموس (Dolby Atmos)») if desired.
- **Hulu `faq[2]`**: «وتنصح بسرعة إنترنت جيدة» → «وننصح بسرعة إنترنت جيدة» (register: the site speaks as «نحن»).
- **HMA `faq[0]`**: «أكثر من مئتي دولة وموقع» — vague country/location conflation (vendor: ~190+ countries, 290+ locations); optional refresh.
- **DirecTV Stream `faq[0]`**: channel counts «أكثر من 75/105/140/150» — vendor's current top tier lists 185+; the claims remain literally true; optional refresh while editing.
- **seo-tools duration dialect**: variants use «شهري/سنوي» while every other category uses «شهر واحد/سنة كاملة» (R162-D sweep observation) — cosmetic site-wide consistency opportunity.
- **Site-wide tier glossary**: أساسي/بريميوم (Disney+, Funimation), قياسي/بريميوم (OSN+), مع/بدون إعلانات + ألتيميت (HBO Max, Hulu), لايت/قياسي/متقدم (Ahrefs), احترافي/جورو/أعمال (Semrush), Plus/بريميوم/عائلي (Pandora — the one incoherent family, F12). Heterogeneous across products but vendor tier names differ too; only Pandora's is internally broken.

---

## Closing — owner approval workflow

### The three admin surfaces that own this content (verified in-repo)

1. **Product edit form** (`/admin/products` → تحرير): `name`, `description` (short), `image_url`, `price`, `cost_price`, `category`, `usage_terms`, `seo_title`, `seo_description`, `is_active`. → covers F1–F5, F7 (short), F8 (short), F9 (short), F10, F11 (short, per option), F13, F25's short sibling, F29 (name), F36 (short).
2. **«الباقات» variants dialog** (per product; backed by `GET/POST /products/:id/variants` + `PATCH/DELETE …/:variantId`): variant `plan_label`, `duration_label`, price. → covers F12 (Option A/B), F14 (price), F17 (Option ii), F30. Note: variant prices flow through the pricing engine (price derives from cost where supplied; explicit `price_lyd` accepted 0.01–1,000,000), and `products.price = MIN(active variant price)` is re-synced automatically after every variant mutation.
3. **Enrichment panel** (`/admin/products/enrichment` → publish with `final_text` override, which lands verbatim in the DB): `description`, `description_long`, `faq` (FAQ must be valid `{question, answer}[]` JSON; 16,000-char cap per field). → covers all `description_long`/`faq` items: F6, F7, F8, F9, F11, F18, F19–F28, F30–F35, F36.

**The importer is NOT the path for any of these.** `scripts/src/import-seo.ts` joins SEO keyword metadata onto products (slug-first, exact-name fallback); it never writes product copy.

**Known gap (reported, not fixable in this round):** `features[]` has **no admin write surface today** — the product PATCH body and the enrichment publish flow both omit it. Two findings touch features (F12 `features[3]`, F18 `features[3]`, F9 `features[2]`, F36 `features[0]`). Until a small admin lane exists for it, those four bullets are operator DB tooling or a follow-up lane; the primary fields (description/description_long/faq/variants) all have clean paths above.

### Mechanical corrections vs business decisions — explicitly separated

**Mechanical (spelling/wording/terminology — 24 findings: F1–F10, F13, F18 (after one lifetime confirmation), F20, F22–F26, F28, F30–F32, F35, F36 (after one number confirmation)).** These are unambiguous Arabic copy fixes against live-quoted evidence. Suggested workflow: the operator opens this document beside the admin panel, applies the «(c) Proposed corrected text» verbatim per finding, in one sitting per product (the per-finding «(i)» lists the exact fields). None of them change price, availability, or product structure — zero commercial risk. The three numbered confirmations inside this group (Brain.fm duration, Hulu 75→95+, ExpressVPN 105→113) are one-glance vendor checks, not judgment calls.

**Business decisions (12 findings: F11, F12, F14, F15, F16, F17, F19, F21, F27, F29, F33, F34).** These cannot be resolved by wording alone; each needs an owner answer first:

| # | Question the owner must answer | Then |
| --- | --- | --- |
| F11/F17 | What Netflix tier is actually delivered (Premium 4K/4-screens, or Standard 1080p/2)? Both stocked? | Apply Option A/B wording, or restructure variants |
| F12 | Pandora tier dialect: all-Arabic (بلس/بريميوم/عائلي — recommended) or all-Latin? | Rename 4 variant labels |
| F14 | Ahrefs متقدم—سنوي price: mislabel (suggested 23,980) or deliberate promo? | Edit variant 228 price / add FAQ note |
| F15 | Headspace: keep in «الموسيقى والصوتيات» (recommended) or move? | No change, or `category` field |
| F16 | Windows 8 (and the Windows 10 siblings): keep with EOL disclosure or archive? | Enrichment edit, or deactivate |
| F19 | Funimation: archive (recommended — service dead since 2024-04-02) or repurpose as Crunchyroll? | Deactivate, or full rewrite |
| F21 | cPanel: what account tier/license is actually delivered? | Reword «حسابات غير محدودة» + «مدى الحياة/الرسمية» |
| F27 | SoundCloud «عائلي»: describe the shared-account reality honestly, or drop the variants? | FAQ reword, or variants removal |
| F29 | Hallmark: rename to Hallmark+ (slug kept) or gloss the old name? | Name edit + gloss |
| F33 | Fox Now: what is actually delivered (TV-provider unlock? Fox Nation? nothing)? | Reword, rename, or archive |
| F34 | Ahrefs FAQ specs: accept the vendor-current numbers (already verified) or re-check at apply time? | FAQ edit |

### Suggested approval flow

1. Operator reviews this document once, marking the 12 business decisions with one-line answers.
2. Mechanical fixes are applied product-by-product through the three admin surfaces above (each finding's «(i)» field is the click-path).
3. Decisions are applied in the same sittings (e.g., Netflix's F11+F17 land together; Sling's F8 fields in one edit; Windows 8's F16+F30 together).
4. After application, re-pull `GET /api/products/by-slug/<slug>` per touched product and diff against this document's «(b) current text» column — the same verification method this census used.
5. Restock-order dependent items (F16 Windows 8, F19 Funimation, F33 Fox Now) should be resolved **before** any restock order that would reactivate them — selling an undisclosed-EOL OS or a discontinued service is the one class in this census that converts directly into customer disputes.
