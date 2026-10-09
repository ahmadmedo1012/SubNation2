# R127 — B14: Arabic Copy + Catalog Data Quality

**Agent:** R127-B14 · **Scope:** R126-A8 held-open residue · post-split admin modules' copy (R126-L9 FE settings ×4 + BE auth-settings ×4) · copilot UI + R126-L6 sticky bar + wallet/topup flow · catalog data quality (live read-only DB) · error-message sweep · legal pages · **HEAD:** `f53a886` (= live production tree) · **Mode:** READ-ONLY (only this report + one worklog entry)

**Method.** Byte-precise Python sweeps (codepoint-level — visual Arabic inspection unreliable, per A8's methodology): ellipsis U+2026 vs `0x2e` census, Arabic-Indic digit scanner (comments excluded), politeness census (يرجى/الرجاء/تفضّل), orthographic scanners (تعذّر/تعذر, مزود/مزوّد, ٪/%), retry-verb and generic-fallback frequency matrices, terminology censuses (رمز/كود, المصادقة الثنائية/التحقق بخطوتين, قيد المراجعة/قيد الانتظار, الخادم/السيرفر). Live DB: **read-only SELECT-only** via the pooler URL from `scripts/restore_env_vars.json` (7 probe scripts, aggregates + 10-product sample, zero writes, zero PII — no user tables queried; nothing personal to mask beyond the sample set, which is product rows only).

**Baseline re-confirmed:** A8's verified non-defects (تعمل، الحفاظ على، صفحة المنتج، الحساب مع الغير، أُضيفت) re-checked — not re-reported. All R126 fixes verified **held** at HEAD: telegram network map (`telegram.ts:167-178`), «طريقة الدخول» (`:182/:246`), «تم اعتماد طلب الشحن» (`topup.service.ts:610`), wallet.ts:385 «رمز التحويل» (comment documents the rename), bulk-toast `getErrorMessage` reroutes (L3), security-advisory rewrite, errors.ts server-message priority (L2), login HTTP-prefix removal.

---

## 1. R126-A8 held-open ledger — status at f53a886

| Item | Site | Status |
|---|---|---|
| F5 | `wallet.tsx:719` «يساعد هذا المرجع فريق المراجعة…» | **STILL OPEN** (byte-identical; field label at :701 says «رمز التحويل») |
| F9 | `promotions.tsx:387` «عند تجمع الكوبونات» | **STILL OPEN** (shadda-less تجمع) |
| F10 | `support.tsx:62` «ثم اضغط شراء» | **STILL OPEN** (button is «اشترِ الآن», product.tsx) |
| F11 | `support.tsx:72` «بمجرد الجاهزية» | **STILL OPEN** |
| F12 | `support.tsx:108` «نقاط ولاء» | **STILL OPEN** (admin/pricing say «نقاط الولاء») |
| F13 | `TopupWaitingModal.tsx:324` «وإيداعه في محفظتك» | **STILL OPEN** (sole إيداع repo-wide) |
| F15 | `support.tsx:82` «إشعارات بالقبول أو الرفض» | **STILL OPEN** (mixes موافقة :80 + قبول :82) |
| F18 | retry-verb style rule | **STILL OPEN — and worsened:** the 3-way split (44/36/30 FE) is now **4-way** — «حاول مجدداً» ×17 (B14-12); no guideline doc, no CI rule |
| F19 | count-plural routing | **PARTIALLY FIXED:** topups queue counter adopted `formatCount` (topups.tsx:107, :1212-1221 — R126-L3); the two A8-flagged lines remain (dashboard.tsx:737, topups.tsx:1035) **+ 2 new sites** (B14-5) |
| F3 FE sibling | `use-socket.ts:109` toast «تم شحن المحفظة» | **STILL OPEN** — L8a fixed the BE notification title; the FE toast for the same event still differs from the modal («تم اعتماد طلب الشحن», TopupWaitingModal.tsx:324) |
| L8a residual | «مرجع الدفع» family | **STILL OPEN** — `topup.service.ts:66,69,108,182,302,561` + `wallet.ts:289` (7 user-visible strings vs the «رمز التحويل» canon) |
| L8a residual | `wallet.ts:314` «(المسموح: ليبيانا، مدار)» | **STILL OPEN** — message lists 2 of the 4-value allowlist (`sadad`/`lypay` also pass, wallet.ts:49) |
| L8a residual | «لوحة الأدمن» Arabizi | **STILL OPEN** — `whatsapp-watch.ts:129,130,276` + `checkout.service.ts:674` (canon: «لوحة الإدارة» — layout.tsx NAV + elsewhere) |
| A1 (excluded-owned) | topups.tsx مرجع/رقم التحويل | **IMPROVED:** :255 now «رمز التحويل» ✓; :891 «مرجع التحويل:» + :1259 «بحث برقم التحويل…» remain — A1-owned, pointer only |

Net: A8's 20 findings — 11 closed and held, 9 open (all P3-class), zero regressions.

## 2. Post-split admin modules (R126-L9) — copy audit

Read in full: `provider-card.tsx` (324L), `two-factor-setup.tsx` (333L), `account-tab.tsx` (441L), the 696L settings shell, and BE `routes/auth-settings.ts`, `services/auth-settings-store.ts`, `services/telegram-auth-flow.ts`, `lib/telegram-callback.ts`.

**Clean:** password-honesty copy (A3-1 fix held — «سيتم إنهاء جميع الجلسات… وستحتاج إلى تسجيل الدخول مجدداً»), 2FA rotate disclosure («إعادة الإعداد تُصدر مفتاحاً جديداً وتُعطّل الحماية مؤقتاً…»), ROLE_LABELS Arabic mapping, «تعذّر تحميل بيانات الحساب. حاول إعادة تسجيل الدخول.» (spelling + actionable), `ar-LY-u-nu-latn` date pinning, Western digits throughout, no ؟/، Latin intrusions, BE modules' Arabic (تسجيل الدخول عبر…، مزود غير موجود) consistent and code-map covered. The L9 split was a byte-move — **no copy regressions from the split itself**, but it surfaced pre-existing drift now visible side-by-side (ellipsis B14-2, fallback split B14-11, dead error span B14-14).

## 3. Copilot + sticky bar + wallet/topup

**Clean:** sticky-bar CTA family («سجّل دخولك للشراء» compact / «تسجيل الدخول للشراء» desktop, honest «أضف للسلة — سجّل الدخول عند إتمام الطلب», «بدائل»/«تصفّح بدائل في نفس الفئة» pair — all consistent); wallet page terminology discipline is exemplary (رمز family comments, one-verb-pair submit «إرسال طلب الشحن» on both method flows, formatCount plural routing everywhere, «قيد المراجعة» canon with documented rationale); copilot error strings fully code-map covered and actionable. Defects found: B14-4 (countdown unit), B14-5 (رسالة count), B14-2 (ellipsis), B14-13 (bare غير مصرح).

## 4. Catalog data quality — live DB (read-only, aggregates + sample)

**Aggregates (45 active products, `is_archived=false`):** descriptions 45/45 Arabic, none empty, all 30–120 chars; usage_terms 45/45; FAQ 45/45; seo_title/seo_description 45/45; **base price = min active variant price — 0 mismatches in 45/45** (invariant holds); image URLs 45/45 `/products/<name>.webp`; 0 duplicate names; category counts (streaming 17, music 11, software 7, vpn 4, ai-tools 2, seo-tools 2, education 2) exactly match `categories.ts`'s verified-2026-09-21 comment; price range 59.80–1,980 LYD, avg 204.27; variants 263 (0 inactive), display via `formatCurrency` → «د.ل» everywhere.

**Names:** 45/45 Latin-only — the global-brand convention (Netflix, Spotify…) consistent with A8's "brand-only Latin" verified principle; descriptions/usage_terms/FAQ Arabic. **Not** a defect; recorded as the convention.

**Sample (10, spread across all 7 categories):** Netflix (79.80, 4 variants: شهر واحد 79.80 / 3 أشهر 199.80 / 6 أشهر 339.80 / سنة كاملة 599.80) · Prime Video · Showtime · Funimation · Pandora Premium · Headspace · IPVanish VPN · Semrush Classic (1,380) · Windows 10 Pro (139.80) · Windows 8 (59.80). Descriptions are real marketing copy, e.g. Netflix: «اشتراك Netflix بمحتوى غير محدود بجودة 4K — باقات من شهر إلى سنة كاملة بأسعار منافسة.» — no placeholders anywhere in the sample or the aggregate.

**Defects:** B14-C1 (name↔slug tier mismatch ×10), B14-C2 (windows-8 plan-axis language mixing), B14-C3 (Headspace in music). **Known, not re-reported:** 1/45 products in stock (4 unsold codes, 1 on lifetime-cloud-storage) — B4/B8/A9 operator stocking-backlog pointer.

## 5. Error-message sweep

`errors.ts` code-map re-read end-to-end: L2's server-message priority + 96-F7 script guard remain genuinely well-engineered; tone consistent (يرجى/حاول imperative-polite); fallbacks Arabic-first. Findings: actionability is uneven in the map itself — `PHONE_ALREADY_REGISTERED` «رقم الهاتف مسجل مسبقاً» gives no next step (should say «سجّل دخولك بدلاً من التسجيل») while its register-page sibling codes do; `OUT_OF_STOCK` has a next step but near-twin `PRODUCT_UNAVAILABLE` «المنتج غير متاح حالياً» doesn't; `INVALID_DATA`/`INVALID_AMOUNT` bare. Generic-fallback duplication drift is real (B14-11): the same update-failure concept renders «فشل التحديث» on admins/account-tab vs «تعذّر التحديث» on layout/promotions; the same operation-failure concept has 3 phrasings («فشلت العملية» ×9 admin, «فشل تنفيذ العملية» ×2 — coupons.tsx mixes both in one file, «تعذّر إتمام العملية — حاول مرة أخرى» ×4 storefront — the only actionable one). Orthographic: تعذر shadda-less ×2 BE (B14-9).

## 6. Legal pages (terms.tsx, both tabs)

**Clean — verdict appropriate.** Legal register (مسؤول عن/يُمنع/نحتفظ بالحق/يُرجى) properly distinct from marketing register; freshness stamps truth-stamped «آخر تحديث: أكتوبر 2026» on both tabs (R125-I7 held); currency canon «بالدينار الليبي (د.ل)»; payment methods mirror the wallet page's canonical labels («تحويل رصيد الهاتف (ليبيانا/مدار) أو تحويل مصرفي (LyPay)» — R120-B5 held); product mentions (Netflix/Spotify/Windows) all live in the catalog; delivery promise «فورياً أو خلال 24 ساعة» legally bounds the ops claim (30 دقيقة, support.tsx) without contradicting it; privacy §4 states the real passwordless guarantees. Micro-nit (not filed): terms §3 «نحتفظ بالحق في» vs §7 «نحتفظ بحق» — same-page verb-phrase variation.

---

## 7. Findings

| # | Sev/Conf | file:line | Current (exact) | Fix directive |
|---|---|---|---|---|
| B14-1 | **P2**/5 | `register.tsx:116` vs `:137`; `topup.service.ts:544,598`; `settings.tsx:665` | Same-screen drift: :116 «تم تطبيق رمز الإحالة:» vs :137 «عند أول شحن معتمد عبر كود إحالة تحصل أنت وصديقك على مكافآت»; BE user notification :598 «أُضيفت مكافأة كود الإحالة إلى محفظتك…» (+:544 admin desc); settings fact :665 «كود مؤقت — يُستخدم مرة واحدة» | Canon **رمز** (R111-F2/R116-S2 already unified the FE money surfaces — wallet.tsx:597-599 documents «رمز» family). 4 one-word edits: كود إحالة→رمز الإحالة (register:137), كود الإحالة→رمز الإحالة (topup.service:544,598), كود مؤقت→رمز مؤقت (settings:665) |
| B14-2 | P3/5 | `provider-card.tsx:295` vs `account-tab.tsx:338`; `CopilotPanel.tsx:1105` vs `:1227`; `support.tsx:768` vs `settings.tsx:495` | Same label, two ellipses: «جارٍ الحفظ...» (3×`0x2e`) on the provider card vs «جارٍ الحفظ…» (`0x2026`) on the account tab — same settings page post-split; CopilotPanel input placeholder :1105 ASCII vs its own loaders :1227/1497/1513/1525 U+2026; «جارٍ الإرسال...» support:768 vs «جارٍ الإرسال…» settings:495 | Site convention is U+2026 (86 vs 18 sites after Arabic). Normalize the 18 ASCII stragglers (or at minimum the 3 same-label pairs above); add the pair to the F18-style copy guideline |
| B14-3 | P3/4 | `security-advisories.ts:71-72`; `requireAdmin.ts:79` | «فعّل التحقق بخطوتين من صفحة الأمان…» — but the settings/security page names the feature «المصادقة الثنائية (2FA)» (settings.tsx:628, two-factor-setup.tsx). 13 vs 3 sites | Pick one (المصادقة الثنائية is the in-app canon); the advisory's cross-reference «من صفحة الأمان» currently lands on a differently-named feature |
| B14-4 | P3/5 | `CopilotPanel.tsx:1513` | `` `الانتظار ${Math.ceil(remainingMs / 1000)}…` `` → renders «الانتظار 30…» — no unit on the money-adjacent double-confirm cooldown; BE twin says «مدة الانتظار 3 ثوانٍ» (previews.ts:363) | `الانتظار ${n} ثانية…` (or ثانية/ثانيتين via the existing plural forms) |
| B14-5 | P3/5 | `settings.tsx:298`; `CopilotPanel.tsx:983` (+ held: `dashboard.tsx:737`, `topups.tsx:1035`) | `` `${enabledCount} طريقة مفعّلة إضافةً إلى…` `` — n=1 reads «1 طريقة مفعّلة», n=2 «2 طريقة مفعّلة» (should be طريقة واحدة/طريقتان); `{c.turns.length} رسالة` — same class | Reuse the existing `formatCount` plural router (utils.ts — already used 3× in wallet.tsx and topups.tsx:1212). Same family as B2's ledger tail («formatCount stragglers») |
| B14-6 | P3/4 | `enrichment/prompts.ts:60,79,80` | Prompt body mixes numerals: «(٢-٤ فقرات)», «بين ٣ و ٦ أسئلة», «٣٠ و ٢٥٠ حرفاً» (Arabic-Indic) vs «بين 400 و 1500 حرف» (Western) — and **no instruction constrains the LLM's output numerals** | Add one prompt line: «استخدم الأرقام الغربية (0-9) في كل المخرجات» + normalize the prompt literals. LLM copy that ships ٠-٩ would violate the site-wide Western-digit canon (utils.ts:64-100 CLDR pins) |
| B14-7 | P3/5 | `settings.tsx:567` | «أعد تشغيل السيرفر» — sole «سيرفر» in the app; 11 files say «الخادم» (errors.ts:60, system, risk, enrichment…) | «أعد تشغيل الخادم» |
| B14-8 | P3/5 | `admin/login.tsx:192` | «الرجاء إدخال رمز التحقق من تطبيق Authenticator» — the repo's only «الرجاء» vs 31 «يرجى» sites | «يرجى إدخال رمز التحقق…» — register consistency on the security-critical surface |
| B14-9 | P3/5 | `orders.ts:242`; `diagnostics.ts:313`; `security.tsx:41,139`, `copilot/ask.ts:150`, `auth-settings.ts:593` | «تعذر إتمام الشراء…» + «تعذر تنفيذ عملية جلسة واتساب» (shadda-less تعذر ×2 BE vs 149 تعذّر); orthographic split مزوّد (5, with shadda) vs مزود (23) | تعذر→تعذّر ×2 (R120-B4 canon); pick one مزود spelling (no-shadda is the 23-site majority) |
| B14-10 | P3/5 | `pricing.tsx:783` | «السعر = التكلفة × (1 + الهامش٪) × سعر الصرف» — the repo's only ٪; same file uses Latin % ×5, promotions «الحد الأقصى 95%» | «(1 + الهامش %)» |
| B14-11 | P3/5 | `admins.tsx:579,587`, `account-tab.tsx:119,128` vs `layout.tsx:1373,1382`, `promotions.tsx:246,257`; `coupons.tsx:255,276` vs `:313` | Same update-failure fallback worded two ways: «فشل التحديث» (admins + account-tab) vs «تعذّر التحديث» (layout + promotions); same-file operation fallback mix: coupons «فشلت العملية» ×2 then «فشل تنفيذ العملية» | Codify per F18's guideline: one canonical per concept — suggest «تعذّر <العملية> — حاول مرة أخرى» (the storefront's actionable form) for admin fallbacks too; same-file consistency is the cheap first pass |
| B14-12 | P3/5 | repo-wide (17 sites: auth-settings.ts:354,401; telegram-auth-flow.ts ×4; socket.ts; app.ts ×2; use-socket.ts; auth-whatsapp.ts ×3; loyalty.ts; telegram-webhook.ts; firebase-auth.service.ts; TelegramLoginButton.tsx) | «حدث خطأ، حاول مجدداً» / «انتهت صلاحية الجلسة، حاول مجدداً» — a **4th** retry-verb variant beyond F18's three-way split (أعد المحاولة 44 / حاول مرة أخرى 36 / إعادة المحاولة 30 FE) | Fold into the F18 policy rule (docs guideline, no string churn — the auth family is internally consistent) |
| B14-13 | P3/3 | `copilot/settings.ts:50,116`; `lib/copilot/rate-limit.ts:122` | bare «غير مصرح» + FORBIDDEN/UNAUTHORIZED — under L2's server-message-priority these now outrank the code-map's actionable «غير مصرح — سجّل دخولك مرة أخرى وحاول» / «لا تملك صلاحية الوصول…» | Either align the inline strings to the map's wording or omit `message` so the map wins (admin-only exposure; low urgency) |
| B14-14 | P3/4 | `provider-card.tsx:112,318` | `{error && <span…>{error}</span>}` — `error` is only ever cleared (`setError("")` :122), never set; the card's inline error line is dead UI (failures surface only via toast) | Wire `save()`'s catch to `setError(message)` (restores the designed affordance) or delete the dead span |
| B14-C1 | P3/4 | DB products | 10/45 slugs carry tier/family info the name lacks: Netflix→`netflix-premium`, Prime Video→`amazon-prime-video`, **Disney+→`disney-standard`** (name/slug tier contradiction), Apple TV+→`apple-tv`; 35/45 names carry the tier inline («Spotify Premium», «Windows 10 Pro») | Naming-convention decision: put the tier in the name (matches the 35-site majority) or keep names brand-only — today the URL says «premium» while the card says «Netflix», and Disney+ vs disney-standard actively disagree |
| B14-C2 | P3/5 | DB product_variants (windows-8) | Plan-axis labels mix languages in one pill row: «احترافي» alongside «Pro N», «Enterprise», «Enterprise N» — the picker renders mixed-script chips | Rename احترافي→Professional (match the axis) or translate all four |
| B14-C3 | P3/4 | DB products (Headspace, id 43) | Meditation/wellness app categorized under `music` («موسيقى») — the other 10 music products are audio services | Operator decision: recategorize (education/wellness) or accept — flagging the sanity check |

**Counts: P0 0 · P1 0 · P2 1 (B14-1) · P3 16** (B14-2…B14-14 = 13 copy P3s + B14-C1/C2/C3 = 3 catalog P3s).

## 8. Known-items pointer table (not re-reported)

| Known item | Owner/round |
|---|---|
| Stocking backlog: 1/45 available, 50 unread no_stock alerts | B4/B8/A9 ops re-flag, R124 ops#1 |
| A1's topups.tsx:891 «مرجع التحويل:» + :1259 search placeholder | R126-A1 (canon table covers) |
| formatCount stragglers family (dashboard:737, topups:1035) | R126-A8 F19 + B2 ledger tail |
| Retry-verb style rule (F18, now 4 variants) | R126-A8 F18 policy |
| Copilot countdown/cooldown wiring, copilot draft SSE contract | B6/B1 lanes |
| «مرجع الدفع» BE family + wallet.ts:314 + «لوحة الأدمن» | L8a's own deferred list (§1 above — tracked there) |
| B3-K1 mobile title clipping 16/45 cards | R127-B3 |
| Zombie 403-poll close, dead exports from L9 splits | B2 verified/held |

## 9. Verdict + fix batches

**SHIP-WORTHY.** The Arabic baseline remains high and every R126 fix held byte-for-byte; the split modules introduced zero copy regressions. The catalog is the strongest data surface audited this round — 100% description/usage-terms/FAQ/SEO coverage, real marketing copy, and a 45/45 price=min-variant invariant. The residue is small-batch drift: one P2 (رمز/كود — 4 one-word edits, one on the registration conversion path), one latent data-pipeline gap (enrichment numerals), and 15 P3 polish items.

- **Batch 1 (mechanical, ~10 strings, grep-safe):** B14-1, B14-4, B14-7, B14-8, B14-9 (تعذر×2), B14-10, B14-12 (doc rule), B14-14 (dead span), + the 9 still-open A8 items (F5/F9-F13/F15 are all one-line literal edits already specified in the R126 report).
- **Batch 2 (judgment):** B14-3 (2FA term choice), B14-11 (fallback canon), B14-13 (copilot 403 wording), B14-C1 (naming convention), B14-C3 (Headspace).
- **Batch 3 (data/pipeline):** B14-6 (enrichment prompt numeral constraint — one prompt line, prevents future ٠-٩ in shipped copy), B14-C2 (windows-8 variant labels), B14-5 (formatCount ×2 new + ×2 held).
