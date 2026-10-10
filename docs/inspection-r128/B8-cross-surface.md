# R128 — B8: Cross-Surface Brand & Design Consistency (voice + design language)

**Agent:** R128-B8 · **Lane:** the SAME message/brand rendered across DIFFERENT customer-touching surfaces — storefront web, PWA install, WhatsApp OTP, Telegram bot, no-JS shell + error pages, og/share cards, API error JSON, (admin secondary) · **Repo:** main @ `7d469d5` (tree clean) · **Mode:** READ-ONLY (only this report + one worklog entry). Live GET probes of https://subnation.ly as WhatsApp/Telegram/plain agents (guest, GET-only).

**Read first (not re-reported):** R127-B14 (Arabic copy/data — terminology canon, its open ledger), R126-A8 (copy sweep + canon table), R128-A1 (tokens — owns color/ramp), R128-A4 (typography), R128-A6 (icons/imagery — OWNS the brand-ASSET suite: favicon blank tile, PWA maskable banner-crop, stale opengraph.jpg content, subnation-logo divergence; this report references but never re-grades those assets), R128-A2 (storefront visual), R128-A3 (admin visual), R128-B3 (security). A8-F1/F2/F3/F4 + B14-1/B14-13 fixes **re-verified HELD** at HEAD (see §7).

**Method:** full read of the four message-template engines (`backend/src/telegram.ts` 637L, `routes/telegram-webhook.ts` 284L, `services/whatsapp-otp.service.ts` send path, `routes/wallet.ts` approval card) + the three-tier og pipeline (`frontend/index.html` static baseline → `app.ts` shell rewrite :950-1534 + share card :1604-1696 → `MetaTags.tsx` runtime) + storefront moment-of-truth surfaces (checkout/order-detail/TopupWaitingModal/use-socket/WhatsAppPhoneSignIn/not-found/ErrorBoundary/onboarding/referrals); scripted emoji census FE vs BE; live probes: `/product/netflix-premium` + `/product/semrush-classic` as WhatsApp UA + TelegramBot UA + plain UA, `/` + `/category/vpn` + `/orders` as WhatsApp UA, `/api/products/by-slug` DTO.

---

## 1. Surface inventory (10 surfaces, all reached)

| # | Surface | What exists | Status |
|---|---|---|---|
| 1 | Storefront web | Arabic RTL SPA, Readex Pro, formal-polite MSA (يرجى/حاول) | covered via key moments (§6) |
| 2 | PWA install | `manifest.json` (hand-written single source) + splash `AppSplashScreen` (Logo + «جارٍ التحميل») | identity audit §4 |
| 3 | WhatsApp outbound | **ONE** production message: the OTP (`whatsapp-otp.service.ts:544`); plus an operator warm-up self-ping («قناة SubNation جاهزة ✓», openwa.service.ts:251). No marketing/order/WA-support messages exist — WA is auth-channel only | §6.4 |
| 4 | Telegram bot | 9 notify helpers (telegram.ts) + bespoke approval card (wallet.ts:637-649) + webhook outcomes (telegram-webhook.ts:175-227) + `/start` id reply (:91) | §3, §6.3, D2 |
| 5 | Email | **None — by design.** No mailer dependency exists (backend/package.json: no nodemailer/sendgrid/resend/postmark/SES); credentials are delivered in-app only (order-detail «بيانات الحساب»). `delivered_email` is the *product account's* login, not a customer email channel. Recorded so future rounds don't hunt for a phantom surface | n/a |
| 6 | no-JS shell + 404/500 | `#static-offline` (index.html:143-173) + `not-found.tsx` + `ErrorBoundary.tsx` | §4 |
| 7 | og/share cards | 4 formulas (static baseline / shell rewrite / unfurler card / runtime MetaTags) | §5, D1 |
| 8 | favicon/PWA icons | **A6-owned** (fragmented suite) — referenced, not re-graded | — |
| 9 | Admin console | secondary here; money cells + status canon verified strong by A3; terminology spot-checks only | §7 |
| 10 | API error JSON | `createErrorResponse` Arabic-first; FE code-map (errors.ts:16-85) | §3 |

## 2. Message-type × surface matrix (actual copy, exact)

| Event | Surface | Copy (exact) |
|---|---|---|
| **OTP arrival** | WhatsApp msg (whatsapp-otp.service.ts:544) | `SubNation — رمز التحقق` ⏎ ⏎ `123456` ⏎ ⏎ `صالح لمدة 5 دقائق.` `لا تشارك هذا الرمز مع أحد.` |
| | Web OTP UI (WhatsAppPhoneSignIn.tsx:663-688) | «ينتهي خلال 5:00» / «انتهت صلاحية الرمز — استخدم «إعادة الإرسال» للحصول على رمز جديد» / «لم يصلك الرمز؟ إعادة الإرسال (30 ث)» |
| | TTL | `OTP_TTL_SEC = 5 * 60` (lib/whatsapp-otp.ts:33) — message ↔ countdown ↔ TTL all agree |
| **New topup (pending)** | TG approval card (wallet.ts:638-648) | `💰 طلب شحن جديد #<id>` / `• الهاتف:` / `• المبلغ: <storedAmount> د.ل` (raw Number → «500») / `• الطريقة: mobile_transfer (libyana)` (raw enums) / `• المرجع:` + ✅ موافقة / ❌ رفض buttons |
| | TG notify card (telegram.ts:180-188) | `💰 طلب شحن جديد` / `المستخدم:` / `طريقة الدخول:` / `المبلغ: <toFixed(2)> د.ل` / `الشبكة: ليبيانا` (mapped) / `معرّف الطلب: #<id>` / `الوقت:` / `⏳ بانتظار الموافقة` |
| **Topup approved** | Bell notification (topup.service.ts:612-618) | «تم اعتماد طلب الشحن (500.00 د.ل)» / «تمت إضافة الرصيد إلى محفظتك بنجاح» |
| | Socket toast (use-socket.ts:117-121) | «تم اعتماد طلب الشحن» / «500.00 د.ل أُضيفت إلى رصيدك» (formatCurrency) |
| | Waiting modal (TopupWaitingModal.tsx:169,324) | title «تمت إضافة الرصيد» / body «تم اعتماد طلب الشحن وإضافته إلى محفظتك.» |
| | TG operator (telegram.ts:208) | `✅ شحن موافق عليه` |
| | TG webhook outcome (telegram-webhook.ts:175,227) | «✅ الحالة: تمت الموافقة بواسطة @x» / toast «✅ تمت الموافقة وإضافة الرصيد» |
| | Admin API response (topup.service.ts:627) | «تمت الموافقة على طلب الشحن وإضافة الرصيد» |
| **Topup rejected** | Bell (:673-679) | «تم رفض طلب الشحن (X د.ل)» / «تواصل مع الدعم إذا كنت ترى أن هذا خطأ» |
| | Modal (title :171) | «تم رفض الطلب» |
| | TG (telegram.ts:221) | `❌ شحن مرفوض` |
| **Topup waiting** | Modal (:268-287) | «نتحقق الآن من إتمام التحويل. عادةً خلال دقائق، وبحد أقصى 30 دقيقة خلال ساعات العمل.» / «قيد المراجعة من الإدارة» |
| **Purchase success** | Checkout toast (checkout.tsx:1085-1094) | «تم إتمام الطلب» / «تم إنشاء طلب بنجاح» (formatCount) → navigate `/orders/:code` |
| | Credentials card (order-detail.tsx:448-449) | «بيانات الحساب» / «انسخ بياناتك بأمان» + CopyField البريد الإلكتروني/كلمة المرور |
| | TG operator (telegram.ts:244-249) | `🛒 طلب جديد` / `المستخدم:` / `المنتج:` / `المبلغ:` / `الرمز: <code>` + «📋 فتح الطلب» |
| **Order status change** | Bell (admin/orders.ts:82-106) | «طلبك SNDB… مكتمل» (labels mirror statusLabel by comment) |
| | Socket toast (use-socket.ts:88-94) | «تم تحديث حالة طلبك SNDB…» / «الحالة الجديدة: مكتمل» (statusLabel) |
| **Support reply** | Bell (admin/tickets.ts:245-252) | «رد جديد على تذكرتك» + message[:100] + deep link `/support?ticket=<id>` |
| **Referral share (web→WhatsApp)** | referrals.tsx:159 | «انضم إلى SubNation — متجر الاشتراكات الرقمية بالدينار الليبي 🎬 ⏎ استخدم رمز الإحالة: <code> ⏎ <link>» |
| **Welcome bonus** | Bell (topup.service.ts:599-605) | «وصلتك مكافأة الترحيب 5.00 د.ل» / «أُضيفت مكافأة رمز الإحالة إلى محفظتك مع أول شحن معتمد» |
| | Register banner (register.tsx:116-131) | «تم تطبيق رمز الإحالة:» / «عند أول شحن معتمد عبر رمز الإحالة تحصل أنت وصديقك على مكافآت» |
| **Errors** | API map (errors.ts FE:16-85) | «رمز التحقق غير صحيح أو منتهي الصلاحية» · «حدث خطأ في الخادم. حاول مرة أخرى» · «رقم الهاتف غير صالح. يجب أن يبدأ بـ 091 أو 092 أو 093 أو 094» |
| | 404 page | «الصفحة غير موجودة» / «يبدو أن هذه الصفحة لا وجود لها أو ربما تم نقلها.» |
| | 500 boundary | «حدث خطأ غير متوقع» / «نعتذر، حدث خطأ في هذه الصفحة.» |

## 3. Brand-voice consistency

- **Tone:** uniform formal-polite MSA everywhere (يرجى/حاول/تواصل مع الدعم); no casual/Libyan dialect anywhere, including Telegram. Telegram operator cards are MORE telegraphic (field lists) — appropriate register split (operator vs customer), same vocabulary.
- **Terminology canon propagation (R127 رمز التحويل unification → did WA/TG get it?):** user-facing WA/TG surfaces had nothing to unify (no user-facing transfer-reference strings), BUT the **TG approval card still says «المرجع:»** (wallet.ts:648) — the last operator-visible non-canon label beside topup.service.ts's fixed «رمز التحويل» errors (:66-113) and the admin queue's fixed :255. A1-owned residue (topups.tsx:891/1259) unchanged. Canon is ~95% propagated; the approval card is the straggler (folded into D2).
- **Numbers/currency:** «X د.ل» label + Western digits everywhere ✓ — but grouping diverges (D3): web `formatCurrency` = en-US grouping («1,380.00 د.ل», utils.ts:29-34) vs every backend surface raw `toFixed(2)` («1380.00 د.ل»): telegram.ts:528-530 `formatLyd`, topup.service.ts:615/676 notification titles, app.ts:1085 share-card price. Live-verified: WhatsApp card for semrush-classic reads «السعر 1380.00 د.ل» while the page shows «1,380.00 د.ل»; and the approval toast (grouped) vs bell title (ungrouped) on the SAME screen for ≥1,000 amounts.
- **Emoji policy — channel-adaptive, deliberate:** storefront ≈ emoji-free (lucide icons; only text-glyph «رصيد كافٍ ✓» product.tsx:1959); Telegram rich emoji headers (💰✅❌🆕🛒🎟️⏰⚠️🚨🔧⏳ℹ️👋 — 13 message types); WhatsApp OTP deliberately bare (code-isolation comment :528-543). The web→WhatsApp referral share message correctly adopts the WA idiom (🎬, referrals.tsx:159). This is a coherent implicit policy — worth writing down (unification win #5).
- **Greeting/sign-off:** no greetings on transactional surfaces; exactly two «مرحباً» moments: onboarding hero («مرحباً بك في SubNation») + the bot /start reply («مرحباً! 👋» — operator setup). Consistent.

## 4. Visual language beyond the app

- **WhatsApp OTP layout (§6.4):** plain text (OpenWA sendText), blank-line isolation around the 6-digit code → single-gesture copy on Android/iOS (documented :538-543); RTL-safe except the LTR-led header (D9, P4).
- **Telegram card structure:** HTML parse_mode + `escapeHtml` on all user input; `<b>` for values, `<code>` for phones/ids/references (copyable in TG), `inline_keyboard` deep links to /admin/*, `timestampLine` ar-LY + Africa/Tripoli (Western digits, ICU ar-LY default = latn ✓). Structurally excellent — except the duplicate card (D2).
- **PWA manifest identity:** name «SubNation — سوق الاشتراكات الرقمية» = index.html title VERBATIM; description = static meta description VERBATIM; short_name/apple-title «SubNation»; theme_color #dc1840 = dark `--primary` ✓ (A1 cross-validated); lang ar/dir rtl; Arabic shortcut + screenshot labels. Only nits: background_color `#0a0a0a` vs app base `--surface-base` #0a0c10 (D5, P4 — splash tint 2 units off-token) and shortcut home name «المتجر» vs app nav «الرئيسية» (D7).
- **no-JS shell:** NOT a white stub — honest neutral Arabic RTL («يتطلب الموقع تشغيل JavaScript», index.html:173), system-ui, `color-scheme: light dark`, 2.5s delayed reveal, role=status, main.tsx removes it synchronously on healthy boot. Deliberately brand-less and CSS-chunk-independent (defensible engineering); a brand-tinted retry link would elevate it (P4 polish, next actions).
- **404 / 500:** both fully branded (token chrome, primary CTAs, quick links; 404 Compass + «404», 500 AlertTriangle), same register, noindex/noindex semantics correct. A2 already graded the 404 exemplary.
- **Share-card text formulas (per entity):** product = `${name} — SubNation` + `${description(150)} — السعر ${price} د.ل`; category = curated metaTitle («اشتراكات VPN في ليبيا — ExpressVPN | SubNation»); home = «سوق الاشتراكات الرقمية في ليبيا | SubNation» (B12-F1 fix live-verified as WhatsApp UA); auth/unknown = generic baseline + noindex + stripped canonical (live-verified /orders → «SubNation — سوق الاشتراكات الرقمية», robots noindex — zero data leak). The formula is consistent PER TIER but not ACROSS tiers for products (D1).

## 5. WhatsApp-first unfurl audit (end-to-end, live)

- **Triage architecture:** WhatsApp/Telegram unfurlers → DB-backed OG card (app.ts:1604-1696, allowlist :1844-1848); indexers → SPA shell + JSON-LD; humans → SPA. Live-verified: WhatsApp UA and TelegramBot UA both receive the card; plain UA receives the rewritten shell. Correct and channel-aware.
- **Product URL as WhatsApp (netflix-premium):** og:title «Netflix — SubNation», og:description «اشتراك Netflix بمحتوى غير محدود بجودة 4K — باقات من شهر إلى سنة كاملة بأسعار منافسة. — السعر 79.80 د.ل», og:image absolute `https://subnation.ly/products/netflix.webp` (450×450 square — ideal for WA's square thumb), og:url canonical slug, og:site_name «SubNation», no dimension lies (stripped). **The card works** — but shows a DIFFERENT title than every other surface (plain-UA shell + runtime page both render the operator's seo_title «Netflix — اشتراك أصلي بالدينار الليبي | SubNation»; live-verified both) → D1. seo_title/seo_description (45/45 coverage per B14 §4) are invisible to the #1 share channel.
- **Arabic rendering:** titles/descriptions are Arabic and render correctly; the runtime `MetaTags.clamp` cuts at word boundaries (:86-98) but the share card's `buildShareDescription` uses raw `slice(0,150)` + `slice(0,179)` (app.ts:1080-1087) — today latent only (all 45 descriptions ≤120 chars per B14), becomes a mid-word shard if descriptions ever exceed 150 (P4 latent).
- **Domain display:** clean `subnation.ly` in og:url/og:image/canonical; apex-consistent.
- **Telegram unfurls:** same card (TelegramBot in allowlist) — Telegram renders the square art with title+desc ✓.
- **Aspect/quality:** product art square (WA-friendly); home/category unfurls ride the generic opengraph.jpg (1280×720) — the IMAGE's stale CONTENT is A6's finding; formula note: only product shares get per-entity art (categories have none) — acceptable, recorded.

## 6. Moment-of-truth copy audit (5 moments)

1. **OTP arrival** — WA msg (§2) ↔ web countdown ↔ 300s TTL: one voice, one number, one expiry verb (صالح/ينتهي/انتهت). **Excellent.**
2. **Credentials delivered** — checkout toast «تم إتمام الطلب» → order-detail «بيانات الحساب / انسخ بياناتك بأمان» + copy fields + usage-terms callout; decrypt-failure degrades honestly to support. **Excellent** (A4-F1 bidi aside — known).
3. **Topup approved** — اعتماد verb now UNIFIED across all four user surfaces (bell/toast/modal/auto-path; A8-F3 FE residue CLOSED since R127 — verified use-socket.ts:117 + modal:324 إيداع→إضافة) while موافقة stays admin-side (TG cards, webhook, admin API). **The canon table's verb split is now fully live.**
4. **Order issue / support reply** — «رد جديد على تذكرتك» + preview + auto-open deep link. **Good.**
5. **First-visit hero** — «سوق الاشتراكات الرقمية / في ليبيا» + onboarding «مرحباً بك في SubNation … بالدينار الليبي، تسليم فوري، ودعم محلي» — mirrors manifest description + home SEO verbatim in spirit. **Strong.**

## 7. Verified-OK (and prior-fix holds re-verified at HEAD)

1. **A8-F1 fix held:** `PAYMENT_NETWORK_LABELS` full 4-value Arabic map (telegram.ts:167-172); unknown networks omit the line (:175-178).
2. **A8-F2 held:** «طريقة الدخول» on topup/new-user cards (:141,:182,:246).
3. **A8-F3/B14 residue CLOSED at HEAD:** use-socket.ts:117 toast now «تم اعتماد طلب الشحن» + formatCurrency; TopupWaitingModal:324 «وإضافته» (إيداع gone).
4. **B14-1 held:** register.tsx:116/131 + topup.service.ts:603 all «رمز الإحالة».
5. **A8-F5/B14 family:** checkout.service.ts:674 «لوحة الإدارة» (Arabizi gone).
6. One-voice SLA: modal 30-min copy ↔ support FAQ 30 دقيقة ↔ terms 24h legal bound (hierarchy, not contradiction).
7. Order-status cross-surface: BE notification labels mirror FE `statusLabel` (admin/orders.ts:82-90; refunded uses sentence-grammar «تم استرداده» vs badge «مُسترد» — context-correct, but the mirror is comment-contract only, not test-pinned like the shell parity tests — nudge in next actions).
8. Money label «د.ل» + 2 decimals on all web surfaces; LYD in machine contexts (LD, manifest).
9. Brand-name discipline: Latin «SubNation» everywhere user-visible; Arabic «سَب نيشن» only as SEO alternateName (seo-builders.ts:28,212); product transliterations (نتفلكس…) only in SEO copy.
10. PWA identity block (§4) + splash Logo; unfurler/indexer/human triage correct live; auth-family unfurls leak nothing.
11. Email-less by design (documented in §1 so it stops being searched).
12. API error JSON: Arabic-first, code-tagged, action-oriented; the 96-F7 script guard holds (R127-B14 §5 baseline).

## 8. Divergence register

| # | Sev | Concept | Surfaces / exact | file:line |
|---|---|---|---|---|
| D1 | **P3** | Product og-card formula ×4 for one URL | WhatsApp/TG card: `${name} — SubNation` + desc+« — السعر X د.ل» (seo fields IGNORED) vs shell (plain UA/indexers): seo_title preferred vs runtime (JS): seo_title \|\| `${name} — ${formatCurrency(price)}` | app.ts:1674-1678 vs :1499-1504 vs product.tsx:742-749 |
| D2 | **P3** | Duplicate TG card per pending topup + intra-pair drift | approval card (`• الهاتف:` raw enums `mobile_transfer (libyana)`, raw amount «500 د.ل», «المرجع:», bespoke fetch bypassing telegram.ts dispatch/metrics/retry) AND notifyNewTopup («المستخدم:», «الشبكة: ليبيانا», formatLyd «500.00 د.ل», «⏳ بانتظار الموافقة») both fire for every manual topup | wallet.ts:621-674 + :694-700 vs telegram.ts:174-193,528 |
| D3 | **P3** | Money grouping canon breaks off-web (and on one on-web pair) | formatCurrency «1,380.00 د.ل» vs toFixed(2) «1380.00 د.ل» in TG formatLyd, bell titles (topup.service.ts:615,676), WA-card price (app.ts:1085) — toast vs bell diverge on-screen for ≥1,000 د.ل | utils.ts:29-34 vs telegram.ts:528-530 |
| D4 | P4 | Pending-state wording ×3 | web topups «قيد المراجعة» (documented, wallet.tsx:257-266) vs generic statusLabel «قيد الانتظار» vs TG «بانتظار الموافقة» | utils.ts:170, telegram.ts:188 |
| D5 | P4 | PWA splash tint off-token | manifest background_color `#0a0a0a` vs `--surface-base` #0a0c10 (hsl 220 22% 5%) | manifest.json:10 vs index.css:135 |
| D6 | P4 | Brand-tail separator split | «\| SubNation» (seo_titles, shell home/category meta, 404) vs «— SubNation» (WA card, product fallback, static baseline, terms/support titles) | app.ts:1674 vs SHELL_* maps |
| D7 | P4 | Home naming | manifest shortcut «المتجر» (= «المتجر» 404 quick link) vs app nav «الرئيسية» | manifest.json:59 vs MobileNav.tsx:9 |
| D8 | P4 | TOPUP-limit error duplicated FE+BE with drift | FE «…حتى تُعتمد» vs BE «…حتى يتم اعتمادها» | wallet.tsx:1099 vs wallet.ts:600 |
| D9 | P4 | WA-OTP header bidi | Latin-led first line sets LTR base direction for an Arabic-market message («SubNation — رمز التحقق»); code line itself is bidi-safe | whatsapp-otp.service.ts:544 |
| D10 | P4 | Share-card raw slice | `slice(0,150)`/`slice(0,179)` can split words (runtime clamp is word-boundary) — latent (all descriptions ≤120 today) | app.ts:1080-1087 |

**Counts: P0 0 · P1 0 · P2 0 · P3 3 · P4 7.**

## 9. Top-5 unification wins (ordered by leverage)

1. **One share-card builder:** route the app.ts:1670-1686 card through the R122 formula (prefer seo_title/seo_description, keep the price suffix) — the operator's curated Arabic finally reaches WhatsApp, and one URL = one card story everywhere.
2. **Kill the duplicate TG approval card:** move the ✅/❌ inline keyboard INTO `notifyNewTopup` (telegram.ts already has the button plumbing) and delete wallet.ts's bespoke fetch — simultaneously fixes the raw-enum leak, the unrounded amount, the «المرجع» label, the bypassed metrics/retry pipeline, and the double message.
3. **Backend `formatLyd` with en-US grouping** (mirror web formatCurrency): route telegram.ts:528, topup.service.ts:615/676, app.ts:1085 through it — one function ends D3.
4. **Terminology tail:** «المرجع:» → «رمز التحويل» (wallet.ts:648, rides win #2) + the A1-owned topups.tsx:891/1259 stragglers — closes the R116-S2 unification at 100%.
5. **Codify the implicit policies** in the copy guideline (F18 doc): emoji-density-by-channel, brand-tail separator (pick one), pending-vocabulary split, BE-notification↔statusLabel parity test (mirror the spa-shell parity tests), manifest background_color → #0a0c10, shortcut «الرئيسية», and the word-boundary clamp for buildShareDescription.

**Verdict: SHIP-WORTHY.** The brand voice is remarkably disciplined for a multi-surface system — one tone, one numeral system, one verb canon (now fully live), a channel-aware emoji policy, and a genuinely excellent WhatsApp-unfurl architecture. The residue is three P3 consistency gaps concentrated exactly where two surfaces were built by different eras of the codebase (share card pre-R122, approval card pre-telegram.ts-pipeline) — all three are single-file fixes that fold into ~2 commits.
