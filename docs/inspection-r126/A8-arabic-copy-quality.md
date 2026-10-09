# R126 — A8: Arabic Copy & Terminology Quality Sweep

**Agent:** R126-A8 · **Scope:** every user-visible Arabic surface (storefront, admin console, backend messages, Telegram/WhatsApp templates) · **HEAD:** `186b131` · **Mode:** READ-ONLY (no source modifications)

**Method.** Byte-precise Python sweeps (word-boundary regex, codepoint checks — visual Arabic inspection is unreliable, so every flagged string was re-verified via `sed -n`/codepoint dumps), terminology frequency matrix (frontend+backend, tests excluded), JSX-prop English-leak scanner, `createErrorResponse` first-arg Arabic-coverage extraction, plus one guest-level GET to `https://subnation.ly` (title/meta are Arabic-first, brand-only Latin — clean; only dev HTML comments carry English, non-UI).

**Coverage highlights (swept, found clean):** hamza-on-wasl verbs (`إست*`, `أن*ت`), taa-marbouta endings (`كلمه/رساله/صفحه`), `برجاء/حتي/الذى/الى/شئ/مسئول/إيميل/باسورد` (0 hits each), Arabic-Indic digit policy (Western digits enforced via CLDR overrides in `utils.ts:64-100`, input normalization in `WhatsAppPhoneSignIn.tsx:61-91` + `wallet.tsx:252-260` — consistent), `كوبون` vs `قسيمة` (102 vs **0** — already canonical), `كلمة المرور` (fully consistent), `الكتالوج` (consistent), plural-form routing in `NotificationBell`/`loyalty`/`products` (correct one/two/few/many), WhatsApp OTP template (`whatsapp-otp.service.ts:543` — channel-appropriate, concise), backend error-message Arabic coverage (only 6 non-Arabic `createErrorResponse` first-args repo-wide, 4 of them machine-endpoint beacons). The codebase's Arabic baseline is **high**; what remains is drift + template defects below.

---

## 1. Findings table

| # | file:line | Current (exact) | Proposed | Sev |
|---|-----------|-----------------|----------|-----|
| F1 | `backend/src/telegram.ts:160` + `backend/src/routes/wallet.ts:693` | `const netLabel = input.network === "madar" ? "مدار" : "ليبيانا";` — fed `network: method === "lypay" ? "LyPay" : (network ?? "")`, so a **LyPay** (or `sadad`/empty) topup alert renders **«الشبكة: ليبيانا»** | map the full `PAYMENT_NETWORK_ALLOWLIST` (`libyana→ليبيانا`, `madar→مدار`, `lypay→LyPay (تحويل مصرفي)`, `sadad→سداد`) or omit the line for lypay | **P1** (false info in a money-approval alert → admin may reject a legit transfer on "network mismatch") |
| F2 | `backend/src/telegram.ts:164` and `:228` | `` `الحساب: <b>${providerLabel(input.provider)}</b>` `` (providerLabel returns the user's **auth** provider — Google/تيليجرام/هاتف) | `طريقة الدخول: <b>…</b>` — matches `telegram.ts:141` which labels the *same function* «طريقة التسجيل:» in the new-user alert | **P2** («الحساب: Google» next to «المستخدم: 09xx» in a topup alert reads like the payment account) |
| F3 | `backend/src/services/topup.service.ts:610` | `` `تم قبول شحن ${…} د.ل` `` (user notification title) | `تم اعتماد طلب الشحن (${…} د.ل)` — same event is «تم اعتماد طلب الشحن…» in `TopupWaitingModal.tsx:324`, «تم شحن المحفظة» in `use-socket.ts:109`, «قبول» here: three verbs for one outcome | **P2** |
| F4 | `backend/src/routes/wallet.ts:385` | `"مرجع التحويل (رقم العملية من إيصال التحويل) مطلوب لطلبات شحن المحفظة"` (400 shown on the **storefront** wallet form) | `"رمز التحويل (رقم العملية من إيصال التحويل) مطلوب لطلبات شحن المحفظة"` — the field the user just left is labeled «رمز التحويل» (`wallet.tsx:680`); related to but distinct from A1's admin-screen drift | **P2** |
| F5 | `frontend/src/pages/wallet.tsx:698` | `"يساعد هذا المرجع فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين."` (helper text under the «رمز التحويل» label) | `"يساعد رمز التحويل فريق المراجعة في التحقق من تحويلك ومنع احتسابه مرتين."` — same-screen mid-flow drift | **P2** |
| F6 | `frontend/src/pages/admin/products.tsx:929,976` and `admin/topups.tsx:979,1077` | `` body && (body.error \|\| body.code) ? getErrorMessage(body) : `HTTP ${r.status}` `` → renders into the bulk toast as `#ID: HTTP 502` | route the fallback through `getErrorMessage(null)`/generic: `تعذّرت العملية (HTTP ${r.status})` — the codebase's own good pattern (`admin-session.ts:239`, `orders.tsx:831`) | **P2** (bare English fallback bypasses the `errors.ts` leak guard by construction) |
| F7 | `frontend/src/pages/admin/products.tsx:934,980` and `admin/topups.tsx:987,1084` | `e instanceof Error ? e.message : "خطأ غير معروف"` (catch branch; network failure ⇒ `Failed to fetch` in the Arabic toast) | `getErrorMessage(e)` — the guard at `errors.ts:186-214` already speaks Arabic for exactly this shape | **P2** |
| F8 | `backend/src/jobs/security-advisories.ts:72` | `"حساب أدمن بصلاحيات كاملة يعمل دون TOTP. فعّل التحقق بخطوتين من صفحة الأمان لتقييد الوصول بكلمة المرور وحدها."` | `"حساب مدير بصلاحيات كاملة يعمل دون تحقق بخطوتين. فعّله من صفحة الأمان حتى لا يبقى الوصول معتمداً على كلمة المرور وحدها."` — «أدمن» is Arabizi; "لتقييد الوصول بكلمة المرور وحدها" is logically **reversed** (TOTP exists so access is *not* password-only) | **P2** |
| F9 | `frontend/src/pages/admin/promotions.tsx:387` | `"…يحمي من بيع المنتج مجاناً عند تجمع الكوبونات."` | `…عند تجمّع الكوبونات.` (shadda) | P3 |
| F10 | `frontend/src/pages/support.tsx:62` | `"…تأكد من رصيد المحفظة، ثم اضغط شراء."` | `ثم اضغط «اشترِ الآن».` — the actual button is «اشترِ الآن» (`product.tsx:1949`), not «شراء» | P3 |
| F11 | `frontend/src/pages/support.tsx:72` | `"…وتصلك بيانات الاشتراك بمجرد الجاهزية."` | `…فور جهوزيته.` («الجاهزية» is non-standard here) | P3 |
| F12 | `frontend/src/pages/support.tsx:108` | `"…تحصل أنت على نقاط ولاء قابلة للتحويل لرصيد…"` | `نقاط الولاء` — the admin console + pricing console say «نقاط الولاء» (`pricing.tsx:1258`, `users.tsx:571,1215`); the loyalty page says «النقاط» | P3 |
| F13 | `frontend/src/components/TopupWaitingModal.tsx:324` | `"تم اعتماد طلب الشحن وإيداعه في محفظتك."` | `"تم اعتماد طلب الشحن وإضافته إلى محفظتك."` — «إيداع» is the sole occurrence repo-wide; backend notifications say «تمت إضافة الرصيد…» | P3 |
| F14 | `backend/src/services/topup.service.ts:358` | `` `مرجع دفع مكرر (DUPLICATE_PAYMENT_REFERENCE): يوجد طلب شحن معتمد مطابق…` `` | `رمز تحويل مكرر: يوجد طلب شحن معتمد مطابق… (الطلبات: ${siblingIds})` — drop the raw enum from the admin toast; «مرجع دفع» also drifts from the «رمز التحويل» family | P3 (admin-facing, otherwise actionable) |
| F15 | `frontend/src/pages/support.tsx:80-82` | `"كم تستغرق الموافقة على شحن المحفظة؟" … "وتصلك إشعارات بالقبول أو الرفض."` | unify to اعتماد: `…وتصلك إشعارات بالاعتماد أو الرفض.` (same answer mixes موافقة + قبول) | P3 |
| F16 | `backend/src/middlewares/instrumentation-isolation.ts:70` | `createErrorResponse("Internal server error", ErrorCode.INTERNAL_ERROR)` | `"حدث خطأ في الخادم. حاول مرة أخرى"` (mirror `errors.ts:60`); FE guard masks it today, but this is the defense-in-depth hole on a 500 path | P3 |
| F17 | `backend/src/routes/admin/copilot/draft.ts:61` | `"intent_text required (1–4000 chars)"` | `"نص الأمر مطلوب (من 1 إلى 4000 حرف)"` — FE guard collapses it to the generic Arabic today, losing the actionable range hint | P3 |
| F18 | repo-wide (57/50/28 sites) | retry wording three-way split: `أعد المحاولة` (inline) · `حاول مرة أخرى` (softer inline) · `إعادة المحاولة` (button label, e.g. `fetch-error-card.tsx:145`) | codify the (already mostly role-correct) split: buttons = «إعادة المحاولة», inline instructions = «أعد المحاولة», error-copy fallbacks = «حاول مرة أخرى» — no string changes needed, just a style rule | P3 |
| F19 | `frontend/src/pages/admin/dashboard.tsx:732`, `admin/topups.tsx:1013` | `` `${stats!.pending_topups} طلب شحن بانتظار المراجعة` `` / `` `${successCount}/${ids.length} طلب تمت معالجته` `` | reuse the existing `formatCount` plural router (`products.tsx:1014`) so n=1/2 read «طلب شحن واحد»/«طلبا شحن» | P3 |
| F20 | `backend/src/routes/orders.ts:289` | `"تم استخدام الكوبون من قبل عميل آخر في نفس الوقت…"` | `…من قبل مستخدم آخر…` — «عميل» is 1 of only 2 user-visible uses vs 121 for «مستخدم» | P3 |

**Excluded per mandate:** A3's `login.tsx:94-96` HTTP-prefix + `errors.ts:154-156` code-map priority bug; A1's «رمز/مرجع/رقم التحويل» drift on the admin topups screen (`topups.tsx:255/875/1229` — confirmed still present, canon table below covers the resolution); A3's settings password-copy honesty; R125 fixes.

**Verified non-defects** (looked wrong, byte-checked correct — recording to save future rounds time): «الحفاظ على» (`terms.tsx:73` — classical masdar, valid), «يعمل» (correct yaʿmal), «صفحة المنتج»/«اختر المنتج» (correct منتج spelling, codepoints `0x645 0x646 0x62a 0x62c`), «الحساب مع الغير» (`categories.ts:93` — reads as "sharing account data with others", correct), `${amount} أُضيفت إلى رصيدك` (`use-socket.ts:112` — non-human plural → feminine verb, correct), «الحساب:» typo suspicion in telegram.ts (spelling correct; the defect is semantic, F2).

## 2. Terminology canon table

| Concept | Variants observed (count) | **Canon** | Action |
|---|---|---|---|
| Wallet topup | شحن (96) · إيداع (1, F13) · تعبئة (0) | **شحن** — «شحن المحفظة» / «طلب الشحن» | kill lone «إيداعه» (F13); already dominant |
| Coupon | كوبون (102) · قسيمة (0 in code) | **كوبون** | ✓ done |
| User | مستخدم (121) · عميل (4, 2 user-visible) | **مستخدم** | F20 |
| Transfer reference | رمز التحويل (FE labels, 5) · مرجع التحويل/مرجع الدفع (BE, 10+) · رقم التحويل (search placeholder, 1) | **رمز التحويل** on all money surfaces (the R116-S2 unification); «رقم إيصال التحويل» stays for the receipt placeholder | F4, F5, F14 + A1's admin screen |
| Password | كلمة المرور (uniform) | **كلمة المرور** | ✓ done |
| Loyalty points | نقاط الولاء (admin, 3) · نقاط ولاء (F12) · النقاط (loyalty page) | **النقاط** storefront · **نقاط الولاء** admin | F12 |
| Topup approval verb | موافقة (admin, 32) · اعتماد (storefront outcome, 23) · قبول (4) | **اعتماد** for user-facing outcomes · **موافقة** for admin actions · retire قبول | F3, F15 |
| Checkout CTA | إتمام الطلب (14, in-app) · إتمام الشراء (5, SEO) · إتمام الدفع (3, SEO) | **إتمام الطلب** in-app; SEO marketing variants tolerated | none blocking |
| Support | الدعم (50) · الدعم الفني (7, SEO/marketing only) | **الدعم** in-app | ✓ already role-split |
| Catalog | الكتالوج (uniform) | **الكتالوج** | ✓ done |
| Numerals | Western digits enforced (`utils.ts:64-100`); Arabic-Indic normalized on input | **Western digits** for prices/dates/counts | ✓ done |
| Currency | «X د.ل» via `formatCurrency` everywhere | **X د.ل** | ✓ done |
| Dates | `ar-LY` + `Africa/Tripoli` (e.g. `telegram.ts:610`) | keep | ✓ done |

## 3. Fix batch plan

**Batch 1 — mechanical (no judgment, ~10 files, grep-safe literals):** F5, F6, F7 (reroute through existing `getErrorMessage`/Arabic-first fallback — pattern already exists at `admin-session.ts:239`), F9, F12, F13, F16, F17, F20. All are single-string edits or one-expression reroutes; no test-contract churn expected beyond literal assertions (a handful of admin tests assert toast strings — update in same commit).

**Batch 2 — judgment (small, needs product eye):** F1 (4-value network map vs omit-line decision), F2 (label choice «طريقة الدخول»), F3+F15 (approval-verb canon rename across notification title + FAQ), F4 (mirror «رمز التحويل» in the storefront 400 — note the wallet.tsx:656 comment references the current wording and must be updated), F8 (rewrite advisory sentence — logic inversion needs re-reading), F10/F11 (support FAQ polish), F14 (de-code the admin error).

**Batch 3 — policy (docs/guideline, zero-risk):** F18 retry-verb style rule; F19 reuse `formatCount` for dashboard/bulk stat lines. Add a copy-lint rule idea: fail CI if a toast `title/description` literal contains `HTTP \d` without Arabic-script prefix (would have caught F6 at birth).

## 4. Verdict

**SHIP-WORTHY — conditional on one 3-line hotfix (F1).** The revenue path (storefront guest → product → wallet → checkout) is copy-clean: zero English leaks reach it (the `errors.ts` script guard is genuinely well-engineered), terminology is 90%+ canonical, numerals policy is enforced, and backend error coverage in Arabic is near-total. The single P1 is an admin Telegram alert that mislabels LyPay topups as «ليبيانا» in a money-approval context — a wrong-information defect an operator could act on, so it should ride the next patch (it does not block the storefront).
