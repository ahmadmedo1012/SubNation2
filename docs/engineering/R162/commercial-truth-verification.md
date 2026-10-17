# R162 — Commercial-Truth Verification (Lane D)

**Task ID:** R162-D · **Mode:** read-only production probes (GET only) + new-file validator · **Probes taken:** 2026-10-17 20:30–20:35 UTC · **Evidence dir:** `/tmp/r162-d-evidence/` (products.json + by-slug/×45 + census.txt + ws-*.json vendor searches)

**Scope:** cross-check of ACTUAL active products/variants against product descriptions, FAQs, usage terms, and vendor-official facts. Feeds Lane A's census table (`catalog-content-review.md`, not touched by this lane). Every live quote below is verbatim from `GET https://subnation.ly/api/products/by-slug/<slug>`.

**The recurring distinction (made explicit per question):**
- **Provider capability** = what the vendor's official plans can do.
- **SubNation's specific offer** = what account/license SubNation actually delivers for the price shown.
A claim can be true of the provider's top tier and still be misleading for SubNation's offer if the tier delivered is not (or cannot be verified as) that tier. Catalog copy must bind capability claims to the tier actually sold.

---

## Per-question verdicts

### a. Netflix 4K — blanket claim over tierless variants

**Live data** (`by-slug/netflix-premium.json`, product name «Netflix»):
- description: «اشتراك Netflix بمحتوى غير محدود **بجودة 4K** — باقات من شهر إلى سنة كاملة…»
- description_long: «…بجودة تصل إلى 4K Ultra HD وبدون إعلانات داخل المحتوى المتقدم…»
- FAQ #1: «**باقة Netflix Premium تدعم البث بدقة 4K Ultra HD على أربع شاشات متزامنة**…»
- variants (4): `plan_label: null` × durations شهر واحد/3 أشهر/6 أشهر/سنة كاملة — **no plan tier anywhere in the variant menu**.

**Vendor-official** (help.netflix.com/en/node/24926 «Plans and Pricing», fetched 2026-10-17): Netflix sells Standard with ads ($8.99/mo, 1080p, 2 devices), Standard ($19.99/mo, 1080p, 2 devices), Premium ($26.99/mo, **4K Ultra HD + HDR, 4 supported devices**). Only Premium supports 4K; the help page also states «We do not offer annual, multi-month, or lifetime membership plans» — SubNation's 3/6/12-month variants are SubNation resale constructs, not Netflix plans.

**Verdict:** NOT a factual error against the vendor's plan structure — the claim matches Premium exactly (4K + 4 screens), and the product slug + FAQ pin the offer to Premium. **But it is an unbound capability claim over a tierless offer**: the customer-facing name is «Netflix» (no tier), variants carry only durations, so the only place the tier is stated is one FAQ answer. If any stocked account is Standard, «بجودة 4K» becomes false for that purchase. **Classification: DB copy change (operator)** — encode the tier in the variant `plan_label` (e.g. «بريميوم — شهر واحد») or the product name, and confirm the delivered plan is Premium. Not fixable in-repo.

### b. Sling Orange/Blue — Arabic transliterations vs official plan names

**Live data** (`by-slug/sling-tv.json`): variants «أورانج», «بلو», «بلو + أورانج» × شهر واحد/3/6/سنة. Description uses Latin: «(Orange/Blue/مجمع)». FAQ #1: «أورانج: قنوات رياضية وعائلية بجهاز بث واحد. بلو: قنوات إخبارية وترفيهية بثلاثة أجهزة متزامنة. المجمع يجمع القائمتين معاً…». Prices: أورانج == بلو at every duration; بلو+أورانج strictly higher.

**Vendor-official** (sling.com/service/compare-plans): Sling Orange — «Sports and family», 30+ channels, **1 stream**, $45.99/mo; Sling Blue — «News and entertainment», 40+ channels, **3 streams**, $45.99/mo; Sling Orange & Blue combined bundle starting $60.99.

**Verdict:** factually accurate — the FAQ's Orange/Blue distinction (1 stream sports vs 3 streams news) matches Sling's official positioning, and pricing Orange == Blue mirrors the vendor's own identical $45.99. The Arabic transliterations are adequately bridged: the FAQ defines أورانج/بلو explicitly and the description carries the Latin names. Minor clarity note (P3): one dialect mixes scripts (Latin in description, Arabic in variants); a Latin gloss «أورانج (Orange)» in the variant labels would remove residual ambiguity (e.g., «أورانج» is also a Libyan-familiar telecom brand). **Classification: optional DB copy change (cosmetic); no factual error.**

### c. Hulu Live TV — SVOD vs Hulu + Live TV

**Live data** (`by-slug/hulu.json`): variants are the full four-tier matrix: «مع الإعلانات»، «بدون إعلانات»، «مع الإعلانات + قنوات مباشرة»، «بدون إعلانات + قنوات مباشرة» × 4 durations (16 variants). description_long: «أربع مستويات: مع إعلانات، بدون إعلانات، مع إعلارات + قنوات مباشرة، وبدون إعلارات + قنوات مباشرة». FAQ #1: «الباقتان الممتدتان تضيفان قنوات مباشرة Live TV بأكثر من 75 قناة أمريكية».

**Vendor-official** (help.hulu.com/article/hulu-how-much-does-hulu-cost + hulu.com/live-tv, searched 2026-10-17): Hulu (With Ads), Hulu (No Ads) («Hulu Premium» $21.49/mo), Hulu + Live TV (With Ads) $99.99/mo, Hulu + Live TV (No Ads) ~$109.99/mo — the same four-plan structure; Hulu + Live TV plans include «95+ live TV channels» plus Disney+ and ESPN Select.

**Verdict:** NOT conflated — SubNation sells both SVOD and Live TV as distinctly-labeled variants, and the description/FAQ enumerate the exact four official plan shapes. One stale number: FAQ says «أكثر من 75 قناة أمريكية» while the official help center says 95+ channels (and Live TV plans now bundle Disney+/ESPN Select, unmentioned). **Classification: DB copy change (update 75 → 95+ and optionally note the bundle).**

### d. cPanel — «خادم مخصص» variant vs cPanel's actual licensing

**Live data** (`by-slug/cpanel.json`): variants «VPS» and «خادم مخصص» (Dedicated) × شهر واحد/سنة كاملة/مدى الحياة, priced **identically** at each duration (99.8 / 980 / 5980). description: «رخصة cPanel **الرسمية** لخوادم VPS أو الخوادم المخصصة… مع Softaculous مجانًا و**حسابات غير محدودة**». FAQ #3: WHM included.

**Vendor-official** (cpanel.net/pricing + support.cpanel.net Store License Tiers, searched 2026-10-17): current licensing is **account-tier based** — Solo (1 account, $29.99/mo), Admin (5), Pro (30), Premier (100, $69.99/mo, +$0.49/account above 100) — with Cloud vs Metal (dedicated) license classes; Metal licenses are available **only in Solo and Premier tiers**. cPanel stopped selling lifetime/owned licenses years ago (official store is subscription-only); «unlimited accounts» was the pre-2020 per-server licensing, explicitly replaced («that is no longer the case» — cPanel licensing change announcements).

**Verdict:** the variant axis itself (VPS vs خادم مخصص) is not pure legacy — it maps to cPanel's Cloud vs Metal license classes — but it is a **secondary** distinction in cPanel's model, while the axis that determines what a buyer actually gets (the account tier: Solo/Admin/Pro/Premier) is absent from the product entirely. Two claims in the live copy are false or unverifiable against the vendor's current model:
1. «**حسابات غير محدودة**» — false: every current tier is capped (1/5/30/100).
2. «**رخصة مدى الحياة** لمرة واحدة تدفعها ولا تشتري مرة أخرى» — cPanel officially sells no lifetime licenses today; whatever SubNation delivers (legacy owned-license resale or third-party arrangement) is a resale construct the «الرسمية» framing does not convey.
The identical VPS/Dedicated pricing is internally consistent (passes the R162 validator) and mirrors the fact that both variants presumably deliver the same tier. **Classification: DB copy change (operator)** — replace «حسابات غير محدودة» with the actual account tier offered; substantiate or reframe the «lifetime» + «الرسمية» claims; ideally surface the account tier as the variant axis. Operator confirmation required on what is actually delivered.

### e. Pandora tier dialect — mapping to official tiers

**Live data** (`by-slug/pandora-premium.json`): variants «**Plus**» (Latin), «**بريميوم**», «**عائلي**» × 4 durations (12 variants). description_long: «ثلاث مستويات: Plus وPremium وFamily». FAQ #1: «Plus: راديو ذكي بدون إعلانات… Premium: يضيف البحث الحر… العائلية: حتى ستة حسابات Premium بسعر واحد».

**Vendor-official** (pandora.com/upgrade + pandora.com/upgrade/premium/family-plan): Pandora Plus $5.99/mo (ad-free personalized stations), Pandora Premium $11.99/mo (on-demand), Pandora Premium Family $19.99/mo («Up to six accounts… All Pandora Premium Features»).

**Verdict:** **honest mapping, no invented tiers** — Plus→Pandora Plus, بريميوم→Pandora Premium, عائلي→Pandora Premium Family; the FAQ's family description («حتى ستة حسابات») matches the official «up to six accounts». (The R161-E census phrase «ألتيميت/أساسي/احترافي» belongs to other products — HBO Max ألتيميت, Disney+/Funimation أساسي, Semrush/Windows احترافي — not to Pandora.) The only defect is script inconsistency inside one variant family: Latin «Plus» beside Arabic «بريميوم»/«عائلي», while the description lists all three in Latin. **Classification: DB copy change (cosmetic normalization — e.g. «بلس» or Latin for all three).**

### f. Windows 8 — EOL, still sold

**Live data** (`by-slug/windows-8.json`): product sold (sold-out), 4 variants: «احترافي» (Pro), «Pro N», «Enterprise», «Enterprise N», all 59.8. FAQ #2: «لماذا أشتري Windows 8 في 2026؟ … وما زالت تفعل وترخص رسمياً». FAQ #3: «نعم — **المسار الرسمي متاح**» (upgrade 8→10).

**Vendor-official** (learn.microsoft.com/en-us/lifecycle/products/windows-81 + support.microsoft.com «Windows 8.1 support ended on January 10, 2023»): **EOL verified — January 10, 2023** (Windows 8.1; Windows 8 RTM ended even earlier). No security/bug updates since. The upgrade-path claim is stale: the official free-upgrade era ended years ago and even 2025-era guidance reports Win7/8 keys no longer reliably activating Win10 (zdnet, Jan 2025: «Upgrades still work, but activation probably won't»); Windows 10 itself reached end of support October 14, 2025 (support.microsoft.com).

**Verdict:** the copy makes **no EOL/security disclosure** while asserting «ترخص رسمياً» and an available official upgrade path. **Classification: business decision (owner) — delist vs keep with EOL disclosure**; this lane deliberately does NOT decide. Sibling finding for the same decision class: Windows 10 Home/Pro products likewise carry no EOL disclosure (Win10 support ended 2025-10-14) while claiming «تفعيل فوري ودائم» — «دائم» is true of the license key, not of OS support.

### g. Ahrefs — same-price two tiers + stale FAQ limits

**Live data** (`by-slug/ahrefs.json`): variants لايت/قياسي/متقدم × شهري/سنوي. Monthly: 1,980 / 3,980 / 5,980. Annual: لايت 11,980, **قياسي 15,980, متقدم 15,980** — the same price for two tiers the product itself prices apart monthly. FAQ #1: «لايت لمشروع واحد: … تتبع **مئة** كلمة مفتاحية. قياسي **لخمسة مشاريع**: … تتبع **750** كلمة. متقدم … **25 مشروعاً وتتبع ألفي كلمة**». description_long: «ثلاث باقات (لايت/قياسي/متقدم)».

**Vendor-official** (ahrefs.com/pricing + help.ahrefs.com «What's the difference between all Ahrefs subscription plans», fetched 2026-10-17): Lite $129/mo, Standard $249/mo, Advanced $449/mo (Enterprise $1,499). Current limits per help.ahrefs.com: **Lite = 5 projects / 750 Rank Tracker keywords; Standard = 20 projects / 2,000; Advanced = 50 projects / 5,000**. SubNation's FAQ numbers (1 project/100 kw, 5 projects/750 kw, 25 projects/2,000 kw) match no current official tier — they appear to be a stale plan generation (notably SubNation's «قياسي» numbers equal today's official **Lite** limits).

**Verdict:** the tier-name mapping is honest (لايت→Lite, قياسي→Standard, متقدم→Advanced; selling 3 of Ahrefs' 5 current plans is a legitimate subset). Two defects:
1. **قياسي-سنوي == متقدم-سنوي == 15,980 is almost certainly a price mislabel** — the product's own monthly ladder (3,980 < 5,980) and the vendor's ladder ($249 < $449, annual ≈ 10×monthly at each tier) both order them apart at every duration. This is the objective, purely-numeric error class the R162 validator pins (see below). **Classification: DB price fix (operator), number confirmed by the business** — pricing is a business decision; the internal inconsistency is the objective defect.
2. **The FAQ tier limits are stale vs current official specs.** **Classification: DB copy change.**

---

## General cross-check (all 45 active products)

Automated objective sweep over all 45 by-slug dumps (`/tmp/r162-d-evidence/census.txt`):

| Check | Result |
| --- | --- |
| `price_from` == min(variant prices) | **45/45 pass** — and structurally guaranteed: the detail DTO **computes** price/price_from from the variant pool at read time (`displayBaseFromVariants`, R130 cheapest-buyable rule) — it cannot drift. |
| Duplicate variant (plan, duration) labels within a product | **0 occurrences** — and structurally impossible: `uniq_product_variants_plan_duration` (NULLS NOT DISTINCT, V1-M17). |
| Same-price different tiers (naive) | Fires on ahrefs (real), cpanel (consistent-by-design), sling (vendor-official equal pricing — **not** an error) → superseded by the cross-duration consistency rule; on the refined rule only **ahrefs** fires across 45/45. |
| Product `is_available` vs variant availability | Consistent — the single available product (Lifetime Cloud Storage) has available variants; the 44 sold-out products are uniformly drained with no contradictory availability copy in descriptions. |
| Empty description / description_long / faq on active products | **0/45** — every active product has all three populated. |
| Variant durations vs description claims | Consistent where stated (Netflix «من شهر إلى سنة» ↔ 1/3/6/12; cPanel «شهري أو سنويًا أو مدى الحياة» ↔ the three duration labels; Sling/DirecTV/Hulu tier+durations match their descriptions' tier enumerations). Duration-label dialect drift only: seo-tools use «شهري/سنوي» vs everywhere else «شهر واحد/سنة كاملة». |
| Tier-price hierarchy within each duration | Strictly ordered everywhere except the Ahrefs annual pair (above) and the by-design equal pairs (Sling Orange/Blue, cPanel VPS/Dedicated). |

Additional truth notes surfaced by the sweep (DB copy class, for Lane A's table):
- **OSN+ internal contradiction:** description_long says «القياسي … على شاشة واحدة» (1 screen) while its own FAQ says «القياسية توفر المحتوى على جهازين» (2 devices) — one of the two is wrong; the FAQ's (2 devices) matches OSN+'s official Standard.
- **ExpressVPN «خوادم في 105 دول» is stale:** expressvpn.com now says **113 countries** (support article updated Aug 2026). IPVanish «أجهزة غير محدودة» ✓ and CyberGhost «أكثر من 11 ألف خادم» ✓ match vendor-official claims.
- **Semrush FAQ tier limits are vendor-correct** (احترافي 5 projects/500 kw, جورو 15/1,500, أعمال 40/5,000 — exactly semrush.com's current Pro/Guru/Business limits), which shows the Ahrefs FAQ staleness is a per-product data defect, not a systemic pattern.

---

## Validator decision

Evaluated candidates per the mission's bar (genuinely repeatable + objective, no language heuristics):

| # | Candidate class | Decision | Evidence |
| --- | --- | --- | --- |
| i | Same-price-different-tiers, **refined to cross-duration tier-price consistency** | **IMPLEMENTED** | The naive form (two tiers, same duration, same price) false-positives on Sling Orange/Blue — vendor-official equal pricing — so it was refined to: *a strict price ordering between two plan labels at one shared duration must hold (same direction, still strict) at every other shared duration*. Against the live catalog this flags **exactly the Ahrefs pair and nothing else in 45/45 products** — the empirical no-false-positive proof. |
| ii | Variant-name uniqueness within a product | **Declined** | Structurally impossible: the DB's `uniq_product_variants_plan_duration` unique index (NULLS NOT DISTINCT, V1-M17) is the race-proof guard; a test would pin the database, not the catalog. |
| iii | `price_from` == min(variant prices) | **Declined** | Computed by construction in `buildProductDetailDto` (`displayBaseFromVariants`, R130) — the served price is derived from the variant pool at read time and cannot drift; also verified 45/45 live. |
| iv | Empty description/faq on active products | **Declined** | Zero live occurrences across 45/45; it is a DB-content completeness lint with no observed error class — a route test cannot see production data (and hermetic tests shouldn't). |

**Implementation (new files only, per the round's ownership rules):**
- `backend/src/lib/catalog-quality.ts` — pure, dependency-free `findTierPriceAnomalies(variants)` + types (`equalized` / `inverted` findings). Rationale for the rule + its deliberate limits documented in-line (single-duration products are out of scope; sale prices ignored since flash discounts are uniform per product and preserve ordering; not yet wired into a route — wiring it into the admin variants route is a coordinator decision for a later round, as existing files were off-limits this round).
- `backend/src/lib/__tests__/catalog-quality.test.ts` — 8 vitest cases: the live-verbatim Ahrefs matrix (expects exactly one `equalized` finding), live Sling/cPanel matrices (the no-false-positive contract), Disney+ strict ordering, tierless Netflix shape, durationless storage-tier shape, a synthetic `inverted` case, and the anchor/equalize mechanics.

**Verification:** `pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/catalog-quality.test.ts` → **8/8 passed**; `pnpm --filter @workspace/api-server run typecheck` → clean. End-to-end sanity probe (tsx harness in /tmp, not committed): the function over all 45 live by-slug dumps returns exactly `[ahrefs: قياسي/متقدم @ سنوي, 15980]` — one anomaly in the whole catalog.

**Deliberately NOT done:** no modification of any existing repo file (the equal-price guard could later live in the admin variants route — that's a behavior change for the coordinator/owner to order); no CI wiring; no language/terminology validator (script-mixing and transliteration issues are DB copy, correctly out of code's reach).

---

## Findings summary — who owns what

| Finding | Class | Owner |
| --- | --- | --- |
| Netflix blanket 4K over tierless variants (bind claim to tier) | DB copy change | Operator (confirm delivered plan = Premium) |
| Netflix «بجودة 4K» — not a factual error if Premium is delivered | Truth verdict | — (no action if confirmed) |
| Sling naming/scripts — accurate; optional Latin gloss | DB copy change (cosmetic) | Operator |
| Hulu «75+ قناة» vs official 95+ | DB copy change | Operator |
| cPanel «حسابات غير محدودة» (false under current licensing) | DB copy change | Operator |
| cPanel «مدى الحياة» + «الرسمية» (no official lifetime licenses; account tier undisclosed) | Operator substantiation | Operator |
| Pandora script normalization | DB copy change (cosmetic) | Operator |
| Windows 8 EOL disclosure vs delist | **Business decision** | Owner |
| Windows 10 EOL disclosure (sibling) | **Business decision** | Owner |
| Ahrefs قياسي-سنوي == متقدم-سنوي 15,980 | DB price fix (business confirms number) | Owner + operator |
| Ahrefs FAQ tier limits stale | DB copy change | Operator |
| OSN+ desc_long vs FAQ screen-count contradiction | DB copy change | Operator |
| ExpressVPN 105 → 113 countries | DB copy change | Operator |
| Tier-price-matrix consistency validator | Implemented (test-only) | Coordinator may wire into admin route later |
