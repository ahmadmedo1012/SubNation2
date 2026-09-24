# R111-F2 — Arabic Copy Quality Survey (RTL storefront)

> Agent: R111-F2 (read-only Arabic copy auditor, native-Arabic UX writer). Base `217de91`.
> Method: grep-first counts across `frontend/src`, targeted reads of flagged spots only.
> Scope deliberately excludes already-reported sibling findings (B5-2 backend WhatsApp copy,
> D2 SEO descriptions, F4 perf). No source changes made.

---

## 1. Terminology survey (grep counts + verdicts)

### 1.1 Checkout CTA — **MIXED (3 verbs + a 4th entry label)** — see finding N1
| Variant | Count | Where |
|---|---|---|
| إتمام الطلب | 13 | checkout.tsx:462 (title), :1123 (h1), :1441 (error «تعذّر إتمام الطلب»), cart.tsx:42 (meta), categories.ts ×6, + tests |
| تأكيد الطلب | 8 | checkout.tsx:1488/:1490 (button), :1494 (terms consent line), + tests |
| إكمال الطلب | 1 | checkout.tsx:1190 «اشحن المحفظة ثم عُد لإكمال الطلب» |
| متابعة الشراء | 1 | cart.tsx:321 (cart → checkout entry CTA) |

The money journey uses **إتمام (page) → تأكيد (button) → إكمال (helper) → متابعة (entry)**. The h1 says «إتمام الطلب» while the button under it says «تأكيد الطلب»; the cart button that leads to that page says «متابعة الشراء» — and sits right above a ghost button «متابعة التسوق» (cart.tsx:336), a near-duplicate label pair on one screen.

### 1.2 Delivered credentials — **UNIFIED ✓**
- كلمة المرور: 31/33 occurrences — uniform across delivered-credential surfaces (order-detail.tsx:391, product.tsx:829, admin/orders.tsx:1088/:1199, show/hide aria-labels order-detail.tsx:78, product.tsx:249).
- بيانات الدخول: ×2, both as the *login-failure* message (errors.ts:24 «بيانات الدخول غير صحيحة») — a different concept (login data, not the delivered password). Acceptable.
- الرقم السري: **0** — dead, never resurfaced.

### 1.3 Topup — **UNIFIED ✓ (one harmless variant)**
- شحن المحفظة / طلبات الشحن / طلب الشحن: canonical everywhere (wallet.tsx:991/:1312, use-socket.ts:107/:115, TopupWaitingModal.tsx:223, admin/topups, admin/dashboard, layout nav).
- شحن الرصيد: ×1 — wallet.tsx:835 subtitle «شحن الرصيد وعرض السجل» under the h2 «شحن المحفظة» (same screen, two labels). Minor.
- إيداع: ×1 as a verb (TopupWaitingModal.tsx:278 «وإيداعه في محفظتك») — describing the credit, not a competing noun. Fine.
- رصيد vs محفظة: correctly distinguished senses everywhere (رصيد = balance, محفظة = wallet; compound «رصيد المحفظة» errors.ts:46 is correct). **No mixing problem.**

### 1.4 Refund — **MIXED (3 roots)** — see finding N2
| Root | Count | Where |
|---|---|---|
| استرداد | 5 | support.tsx:68/:328, terms.tsx:207, order-detail.tsx:439 «تم الاسترداد» |
| استرجاع | 3 | utils.ts:131 `statusLabel.refunded = "مسترجع"`, admin/orders.tsx:265 «تأكيد استرجاع…», :334 «تم استرجاع…» |
| إرجاع | 1 | admin/orders.tsx:265 «سيتم إرجاع المبالغ للمستخدمين» — three roots in ONE sentence pair |

### 1.5 Points — **mostly consistent, definite/indefinite drift (N7)**
- نقاط الولاء ×1 (admin/users.tsx:823) vs نقاط ولاء ×4 (support.tsx:95, register.tsx:117, admin/referrals.tsx:230, admin/pricing.tsx:707) vs loyalty-internal «النقاط»/«نقاطي» (loyalty.tsx:323/:479/:555). Loyalty page is internally consistent; cross-surface drift only.

### 1.6 رمز التحقق — **STILL UNIFIED ✓**
26 occurrences (errors.ts:20, WhatsAppPhoneSignIn.tsx ×3, admin/login.tsx ×3, admin/settings.tsx ×2 + tests); zero «كود التحقق» in shipped copy — the only hit is the regression-pinning comment whatsapp-phone-sign-in.test.tsx:214. The r96-A6 unification held.

---

## 2. Numerals & bidi

- **[P2] C1 — not-found.tsx:30**: `<span className="text-4xl …">٤٠٤</span>` renders **Arabic-Indic ٤٠٤** on the 404 page — the only shipped Arabic-Indic string in `frontend/src` (every other ٠-٩ hit is conversion code, a test, or a comment). Violates the site-wide Latin-digits policy (utils.ts:61-70 pins `-u-nu-latn`; wallet.tsx:233 / WhatsAppPhoneSignIn.tsx:77 *convert* Arabic-Indic input to Latin). Proposed: «404».
- home.tsx:547 «مايكروسوفت ٣٦٥» is inside a JSX comment — rendered text (line 555) uses «365». Not a violation. admin/dashboard.tsx:86-95 chips already Latin («7 أيام», «14 يوماً» — correct Arabic plural too).
- **د.ل placement**: single canonical `formatCurrency` → «1,234.50 د.ل» (utils.ts:22-25); manual instances (support.tsx:95 «5 د.ل», admin/pricing.tsx:707) follow the same order. Consistent.
- **RLM (U+200F): 0 usages** — the bidi strategy is `dir="ltr"` span isolation, not RLM marks. Given the coverage below that is a valid, consistent policy.
- **dir="ltr" coverage — good, no critical storefront gap found**: order codes (orders.tsx:357), coupon codes (orders.tsx:370), credentials (order-detail.tsx:65, product.tsx:236), transfer code (wallet.tsx:407 + hint correctly RTL-outside per 96-F6), phones (WhatsAppPhoneSignIn.tsx:500, profile.tsx:279, wallet.tsx:1144+), admin prices/codes (ProductVariantsDialog, pricing, system). ~60 sites total.
- r96-A6 **letter-spacing fix held**: index.css:1079-1084 neutralizes all `tracking-*` utilities globally; surviving usages are Latin/digit/mono only (OTP inputs, codes, Logo, ٤٠٤ itself).

## 3. Error copy

**Strong overall.** Central exhaustive map `lib/errors.ts` (Record<ErrorCode,string>), calm + actionable phrasing (UNAUTHORIZED «سجّل دخولك مرة أخرى وحاول», FORBIDDEN names pages not «المورد»), and the 96-F7 technical-leak guard (Arabic-script regex) keeps English codes/`HTTP 404`/middleware strings out of Arabic toasts. Page-level banners follow «تعذّر تحميل X — حدث خطأ في الاتصال، تحقّق من شبكتك ثم أعد المحاولة» consistently (home.tsx:912, product.tsx:715, loyalty.tsx:304, support.tsx:722, referrals.tsx:275, wallet.tsx:1525, order-detail.tsx:206).

Weak spots:
- **[P3] Q1**: vague fallback «فشلت العملية» ×4 (support.tsx:267/:297, loyalty.tsx:210/:223) — below the bar the rest of the app sets.
- **[P4] Q2**: duplicate failure copy for one action: «فشل النسخ» (referrals.tsx:93) vs «تعذّر النسخ» (CopyButton.tsx:62, CopilotPanel.tsx:1271).
- **[P3] C6** (admin): CopilotHistoryView.tsx:62 «فحص فشل» — inverted word order; should be «فشل الفحص».

## 4. Buttons / microcopy

- CTAs are verb-first and Arabic; aria-labels are complete and descriptive (45+ surveyed: «زيادة الكمية», «حذف المنتج», «نفد المخزون — غير متاح للشراء حالياً» product.tsx:1458 is exemplary).
- Placeholders all Arabic except intentional LTR examples («09XXXXXXXX», «SUMMER20», «0.00», «https://...») — correct pattern.
- **[P4] N5**: ellipsis style split — «...» (support.tsx:539/:640/:658, wallet.tsx:1130, admin/users.tsx:509, admin/referrals.tsx:377) vs «…» (home.tsx:715, admin/products.tsx:738/:749/:808, admin/promotions.tsx:315, checkout.tsx:1478).
- **[P4] N6**: cart.tsx:327 «سجل دخول للشراء» — missing shadda vs the app-standard «سجّل» (login.tsx:133, register, errors.ts:28).

## 5. Brand spans (lang="en")

- WhatsApp: consistently wrapped `<span lang="en">` ×7 in WhatsAppPhoneSignIn.tsx (+ home.tsx:550/:573 for SubNation/labels). 
- **[P3] N4**: WhatsAppPhoneSignIn.tsx:484-485 «…أو استخدم Google / Telegram الآن» — Google and Telegram **unwrapped in the same sentence** where WhatsApp is wrapped 2 words earlier. Also AuthProviders.tsx:142 «خدمة Firebase Google غير مفعلة حالياً» unwrapped. (aria-label cases like TelegramLoginButton.tsx:167 can't nest spans — acceptable, noted only.)

## 6. Plurals (Arabic 0/1/2/3-10/11+ rules)

**Infrastructure is exemplary**: `formatCount` (utils.ts:49, Intl.PluralRules("ar")) + full test coverage; 20+ call-sites done right (NotificationBell.tsx:622 «إشعاران», Navbar cart, checkout.tsx:1422 partial-order banner, wallet.tsx:937/:1487, orders.tsx:193, admin lists, dashboard.tsx:92 «14 يوماً» — correct many-form).

Frozen-singular leaks (count + hardcoded noun):
- **[P2] C2** loyalty.tsx:507 — «{100 - data.points} نقطة إضافية»: the tier-remainder is *any* number; remainder 3–10 yields «5 نقطة» (wrong; should be «نقاط»). User-facing on the loyalty screen.
- **[P3] C3** admin/orders.tsx:323/:334/:337 — «تم تحديث ${updated} من ${requestedCount} طلب», «تم استرجاع ${updated} طلب», «تخطي ${skipped} طلب» — frozen «طلب» after 3-10 counts (should be «طلبات»); «تخطي» also reads as jargon (prefer «تم تجاوز»).
- **[P3] C4** admin/topups.tsx:781/:788 — «تمت الموافقة على ${approvedCount} طلب» same bug.
- **[P3] C5** admin/users.tsx:1074 — «{user.loyalty_points} نقطة» — latent (real balances are 100-multiples today, so «نقطة» happens to be right; any 3-10 balance breaks it).
- Correct-by-luck: referrals.tsx:404/:510, loyalty.tsx:414/:484 (rates are 50/100 → «نقطة» is the right form).

---

## Findings ledger

| # | Category | Sev | File:line | Current | Proposed |
|---|---|---|---|---|---|
| N1 | consistency | **P2** | checkout.tsx:1488-1494 vs :462/:1123/:1441, cart.tsx:321 | تأكيد الطلب (button) / إتمام الطلب (title+error) / إكمال (helper) / متابعة الشراء (entry) | Pick one verb family (suggest إتمام الطلب button + title; cart entry «إتمام الطلب») |
| N2 | consistency | **P2** | utils.ts:131, admin/orders.tsx:265/:334 vs order-detail.tsx:439, support.tsx:68 | مسترجع / استرجاع / إرجاء vs استرداد | Unify on استرداد: badge «مُسترد», bulk confirm «سيتم استرداد المبالغ…» |
| C2 | correctness | **P2** | loyalty.tsx:507 | {100 - data.points} نقطة إضافية | formatCount(rem, {few:"نقاط", many:"نقطة", other:"نقطة"}) |
| C1 | correctness | **P2** | not-found.tsx:30 | ٤٠٤ | 404 |
| C3 | correctness | P3 | admin/orders.tsx:323/:334/:337 | …${n} طلب / تخطي ${n} طلب | formatCount + «تم تجاوز» |
| C4 | correctness | P3 | admin/topups.tsx:781/:788 | …${n} طلب | formatCount |
| C5 | correctness | P3 | admin/users.tsx:1074 | {loyalty_points} نقطة | formatCount |
| C6 | correctness | P3 | CopilotHistoryView.tsx:62 | فحص فشل | فشل الفحص |
| N3 | consistency | P3 | wallet.tsx:392/:414/:425 | كود التحويل / الكود | رمز التحويل / الرمز (match رمز الكوبون، رمز التحقق family) |
| N4 | consistency | P3 | WhatsAppPhoneSignIn.tsx:484-485, AuthProviders.tsx:142 | bare Google / Telegram | `<span lang="en">Google</span>` / Telegram |
| Q1 | quality | P3 | support.tsx:267/:297, loyalty.tsx:210/:223 | فشلت العملية | «تعذّر إتمام العملية — حاول مرة أخرى» |
| N7 | consistency | P3 | admin/users.tsx:823 vs support.tsx:95, register.tsx:117 | نقاط الولاء vs نقاط ولاء | Pick «نقاط الولاء» (definite) cross-surface |
| Q2 | quality | P4 | referrals.tsx:93 | فشل النسخ | تعذّر النسخ (match CopyButton) |
| N5 | consistency | P4 | support.tsx:539, wallet.tsx:1130, admin/users.tsx:509 vs home.tsx:715, admin/products.tsx:738 | … vs … | one ellipsis char («…») |
| N6 | quality | P4 | cart.tsx:327 | سجل دخول للشراء | سجّل دخولك للشراء |

**Totals: 0 P0/P1 · 4 P2 · 8 P3 · 3 P4** (plus wallet.tsx:835 «شحن الرصيد» subtitle, info-level).

## Top 10 worst user-facing strings

1. `not-found.tsx:30` — **«٤٠٤»** → «404» (policy violation, giant on the 404 screen)
2. `loyalty.tsx:507` — «**5 نقطة** إضافية للوصول للمستوى» (when remainder is 3-10) → «5 نقاط إضافية»
3. `checkout.tsx:1190` — «اشحن المحفظة ثم عُد **لإكمال** الطلب» → «لإتمام الطلب» (or unified CTA verb per N1)
4. `cart.tsx:321` — «**متابعة الشراء**» → «إتمام الطلب» (destination page's own name; also kills the look-alike pair with «متابعة التسوق» at :336)
5. `admin/orders.tsx:265` — «سيتم **إرجاع** المبالغ للمستخدمين» → «سيتم استرداد المبالغ للمستخدمين»
6. `utils.ts:131` — badge «**مسترجع**» → «مُسترد» (order-detail already says «تم الاسترداد»)
7. `wallet.tsx:392` — «**كود** التحويل» → «رمز التحويل» (رمز family: رمز الكوبون، رمز التحقق)
8. `WhatsAppPhoneSignIn.tsx:484` — «…أو استخدم Google / Telegram الآن» → wrap both in `<span lang="en">` like WhatsApp 6 words earlier
9. `support.tsx:267` — «**فشلت العملية**» → «تعذّر إتمام العملية — حاول مرة أخرى»
10. `cart.tsx:327` — «**سجل** دخول للشراء» → «سجّل دخولك للشراء»

## Verified-good (do not re-audit)

رمز التحقق unification (26 hits, test-pinned) · Latin-digits pipeline (`-u-nu-latn` pins, Arabic-Indic input conversion) · r96-A6 letter-spacing neutralizer · كلمة المرور uniform + الرقم السري extinct · شحن المحفظة canonical · dir="ltr" isolation (~60 sites, incl. all credentials/codes/phones) · formatCount plural engine + 20 correct call-sites · errors.ts central map with technical-leak guard · calm+actionable page banners · complete Arabic aria-label coverage.
