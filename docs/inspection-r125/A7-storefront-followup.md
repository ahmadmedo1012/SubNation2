# R125-A7 — Storefront follow-up + new-depth audit

- **Repo:** `/home/z/my-project/repos/SubNation2` @ `09857fc` (main, clean tree; only this report + one worklog entry created)
- **Scope:** all 19 storefront pages (`home, category, product, cart, checkout, wallet, orders, order-detail, loyalty, referrals, support, flash-sales, login, register, profile, terms, status, onboarding, not-found`) + `ProductCard.tsx`, `FlashSaleBanner.tsx`, `TopupWaitingModal.tsx`, `Navbar/MobileNav/Footer`, `FetchErrorCard`/`LoadMoreButton`/`CopyButton`, `lib/cart.tsx`, `App.tsx` warm-up wiring, `index.css` token families. ~16k lines read; admin pages excluded (A1–A6).
- **Method:** read `skills/impeccable-repo/skill/reference/audit.md` + `craft-floor.md`, then predecessors `docs/inspection-r124/A1-storefront-ux.md` + `A3-visual-design.md`. Static analysis only; every contrast number below **computed** (WCAG relative luminance, alpha-composited over the actual surface — same method as A3, independently re-run); no builds/tests/probes/commits.

**Verdict up front:** the money journey end-to-end is the strongest surface in the repo — every edge in the state machine has an Arabic recovery path and a replay-safe idempotency contract (verified per-edge below). All 9 R124 fix targets on my set HELD. 1×P2 + 12×P3: the deferred FlashSaleBanner light-wash token is now a measured AA fail, and the tail is copy/consistency/debt carried from R124-A1's deferred ledger plus a handful of new small finds.

---

## A. Verified HELD (R124 fixes, re-checked at HEAD with evidence)

| # | R124 fix | Evidence at 09857fc | Verdict |
|---|---|---|---|
| 1 | Wallet topup receipt field after the USSD step (A1 P2) | `wallet.tsx:1503-1528` — `PaymentReferenceField` renders directly under `TransferCodePanel` (step 3), with the R124-I1 rationale comment; flow reads transfer → receipt → phone → submit | **HELD** |
| 2 | 44px tap floor (9 money/recovery controls) | checkout topup link `min-h-11 -my-2` (`checkout.tsx:1208-1218`), ProductCard mobile CTA + touch fallback + tablet quick-add (`ProductCard.tsx:578,590,647`), referrals share (`referrals.tsx:359-366`), profile logout (`profile.tsx:582`), orders retry/CTAs (`orders.tsx:384,403,429-444`), loyalty convert link (`loyalty.tsx:646`), wallet presets/saved-phones (`wallet.tsx:1449,1564`), not-found chips (`not-found.tsx:89`) | **HELD** (residual sites → B-2, B-4, B-5) |
| 3 | Contrast batch: category badges light | `index.css:285-298` — education 42 90% **28%**, music **29%**, seo-tools 39%, vpn 33%, ai-tools 45%; my independent compute on the /10 tint over white: **4.96–8.34:1** (was 2.50–4.48) | **HELD** (re-measured) |
| 4 | …footer/navbar alphas, ::selection/caret | `Footer.tsx:54` full `text-muted-foreground` (no /80); `index.css:853-860` `::selection` + `caret-color: hsl(var(--primary-text))` | **HELD** |
| 5 | …status-purple dark 4.09→claimed 4.80:1 | `index.css:168` raised to `262 83% 70%` with the measurement documented. Caveat: my formula computes **4.24:1** on the /12 badge tint over `--card` (4.35 on the bell's /10) vs the in-code 4.80 — likely a surface assumption delta. The only storefront consumer is the bell's *icon* chip (`NotificationBell.tsx:78-79`, WCAG 1.4.11 non-text floor 3:1 → passes regardless); the text consumers are admin (`risk.tsx`, A6's scope) | **HELD with measurement caveat** (worth one browser eyedropper confirmation) |
| 6 | aria-pressed batch | wallet network/presets/saved-phones (`wallet.tsx:1409-1413,1445-1448,1560-1563`), terms tabs (`terms.tsx:256`), variant pills (`product.tsx:2150,2184`) | **HELD** |
| 7 | SEO product-404 (noindex + self canonical) | `product.tsx:807` `robots: "noindex,follow"` + self canonical in the `!product` early return (:856-870 comment chain) | **HELD** |
| 8 | Category titles ≤60ch | `lib/categories.ts:57` (ai-tools 63→ trimmed); pinned by `d1e9b7a` spa-shell parity tests | **HELD** |
| 9 | Flash-sales description + gradient/glow removals + ProductCard min-w-0 | `flash-sales.tsx:233`; `index.css:752` (both `.text-gradient*` deleted), `:805` (`.cta-glow` deleted), onboarding/auth heroes solid `text-primary-text` (`onboarding.tsx:129-131`, `home.tsx:495`); `ProductCard.tsx:458-466` `min-w-0` | **HELD** |

**Bonus R124-A1 fixes that also HELD** (not in my re-verify list but confirmed): F3 pending terminology unified «قيد المراجعة» (`wallet.tsx:237-246`); F5 visible product breadcrumb (`product.tsx:1093-1120`); F6 category separator rotate-180 removed (`category.tsx:254-257`); F7 topup-rejection → working `/support` link + return path preserved (`TopupWaitingModal.tsx:404-427`); F13 register terms consent line (`register.tsx:188-200`); guest add-to-cart on the product page (`product.tsx:1761-1769`).

## Known-open / deferred items — dispositions

1. **R124 deferred: FlashSaleBanner light-wash contrast token — OPEN, now measured as an AA fail (→ B-1).** The R124 partial fix (full-opacity `text-primary-text`, comment at `FlashSaleBanner.tsx:198-201`) measured the label against the **page background** (4.81:1 light) — but the label sits on the banner's own `from-primary/15`→`/25` gradient wash. Computed on the actual wash, light theme: «عرض محدود» (11px bold) = **3.78:1** non-urgent, **3.19:1** urgent; the «— خصم N%» span mid-wash = **3.84–4.24:1**. Dark passes (5.03+). The missing piece is exactly the deferred light-wash-aware ink.
2. **R123 deferred: FlashSaleBanner lazy-mount 44px push (~0.03-0.05 CLS) — OPEN, bounded, keep deferred.** The reservation placeholder (`FlashSaleBanner.tsx:87-89,158-168`) only arms when localStorage carries an unexpired seen-sale end — first visit while a sale runs still takes the push. The alternatives all move the CLS somewhere worse (always-reserve pushes *up* on the common no-sale visit). Honest SPA compromise; no code change recommended without SSR/edge state.
3. **R124-R1 P3-1: contract suite no longer pins description/usage_terms on the LIST endpoint — confirmed current state, accepted trade-off stands.** `backend/src/routes/products.ts:461,479-486`: `description` + `variant_count` ride BOTH projections (P1-1 closed); `usage_terms` + variant tree are full-view-only. `backend/src/__tests__/openapi-response-contracts.test.ts:170-175` exercises only the default full view (`GET /api/products`, no `?fields=list`), so the projected shape stays unpinned — the generated schema comment now documents this truthfully (`shared/api-zod` `ProductListItem` docstring, "R124 review P1-1"). Optional hardening: one contract case with `?fields=list`.
4. **R124-A1 deferred ledger — five items still open, sized in B** (B-7 StepDot, B-8 delivery window, B-9 topup verbs, B-10 support refresh, B-11 cart stock cap). A1's own report had no separate "deferred" tail section; its unfixed P3s are this ledger.

## Money journey END-TO-END (new depth — state machine walked, all edges verified)

Every edge has an understandable Arabic recovery path; **no dead ends found**:

| Edge | Handling | Evidence |
|---|---|---|
| Variant gone mid-checkout | mount re-quote drops the line with a named notice («X لم يعد متاحاً للشراء — أُزيل من الطلب») | `checkout.tsx:588-677` (VARIANT_NOT_FOUND → `quote.status === "unavailable"` drop :643-646) |
| Variant gone pre-buy (product page) | live re-quote aborts before key mint, refreshes data, voids coupon, toast explains | `product.tsx:497-530` (`livePrice == null` → abort) |
| Price changed | checkout: `reconcileLine` + one subtle notice «تم تحديث الأسعار…»; product: abort + «تغيّر السعر منذ فتحت الصفحة…» | `checkout.tsx:648-665`; `product.tsx:513-529`; cent-exact compare `toCents` (:188-190) |
| Re-quote fetch fails | fail-open both paths (snapshot stands; server is charge authority) | `checkout.tsx:578-579,670-673`; `product.tsx:531-534` |
| Wallet insufficient | banner with exact shortfall + `/wallet?return=/checkout` 44px link; product page shows balance/shortfall pair + شحن المحفظة | `checkout.tsx:1197-1221`; `product.tsx:1873-1921`; balance-unknown never hard-blocks (`checkout.tsx:696-707`) |
| Topup pending cap (3) | visible chip (count/3), oldest-pending age, ONE SLA line, submit blocked with reason | `wallet.tsx:61,946-949,1225-1261` |
| Coupon invalid / expired / min-order / mid-loop death | per-line pre-flight with the failing line named; mid-loop death auto-clears the field + explains full-price retry | `checkout.tsx:715-758,839-883,1010-1025` |
| Network fail at pay click | unit keys survive; retry replays; cart-sync deliberately skipped so retry can't double-buy | `checkout.tsx:962-969,1027-1047`; `product.tsx:602-618`; `loyalty.tsx:300-329`; `wallet.tsx` same key family |
| Idempotent retry (tab death, double-tap, IN_FLIGHT 409) | durable per-intent keys with TTL + fingerprint; 409 IDEMPOTENCY_IN_FLIGHT keeps the key everywhere | `product.tsx:116-227`; `checkout.tsx:96-107,941-990`; `loyalty.tsx:64-114` |
| Support escape hatch | failed-order card, decrypt-failure card, and topup rejection all carry working `/support` links (the first two with `?ref=` prefill that auto-opens the ticket form) | `order-detail.tsx:498-506,580-593`; `support.tsx:332-345`; `TopupWaitingModal.tsx:404-419` |

**Cart page (deep audit — first pass):** quantity stepper 44px with X-at-1 routed to undo (`cart.tsx:94-104,309-348`), per-line `N × unit = total` row (:294-301), variant chip (:264-268), sale/strike/discount trio (:272-286), wallet-balance chip that never fabricates a number (:360-369), destructive clear behind confirm + local-first (:106-131), undo toasts with quantity (:82-92). Prices are add-time snapshots by design — checkout's re-quote is the honesty layer. Coupon UX deliberately lives at checkout/product only (fine). saveData/large-list: cart is local and bounded; stagger capped at 4. Residuals: stock-blind quantity (B-11), fallback glyph contrast (B-6).

**Loyalty + referrals:** points math fully API-derived (`points_per_lyd`, `points_per_referral`, tier thresholds — `loyalty.tsx:262-294`), conversion gates client-checked with persistent inline why-invalid (:373-387), durable conversion idempotency, shared cache with referrals (pinned by `loyalty-referrals-shared-cache.test.tsx`), share button with `navigator.share` + clipboard fallback + honest failure copy (`referrals.tsx:157-174`), CopyButton on code/link/rows, empty states distinct from errors on both pages. No findings.

**profile/onboarding/status/terms completeness:** profile identity/quick-links/linked-accounts all live and consistent (R124 text-primary-text sweep held, `profile.tsx:326`); onboarding copy scrubs verified (gaming/PS-Plus gone, `onboarding.tsx:151-158`), gradient/glow removals held; status page honest aggregate (never-green unknown), title set; terms content honest (passwordless reality, no dead category promises). Findings: B-3, B-5, B-13.

**Perception performance:** warm-up is **document-delegated** (`App.tsx:420-457` pointerenter-capture + focusin) — it covers **every** in-app `<a>`: footer links, category chips, product cards, navbar, orders rows all warm equally; saveData sessions opt out; admin never warmed; the 5-family set is pinned by `route-chunk-warmup.test.ts` (widening/narrowing guarded). Only programmatic `navigate()` calls (e.g. product → wallet CTA) bypass it — minor, deliberate family scope. Images: `loading="lazy" decoding="async"` on every list image; LCP candidates prioritized (ProductCard `fetchPriority` index-aware `ProductCard.tsx:408-417`, product hero `fetchPriority="high"` `product.tsx:1181`); aspect ratios reserved (aspect-[4/3]/aspect-square) → no image CLS. Fonts: Readex Pro self-hosted per-subset, `font-display: swap` baked in (index.css:15-23). `cv-card` content-visibility on below-fold cards (`home.tsx:1236`, index.css:1114). No new perf findings on the storefront.

---

## B. Findings

### B-1. [P2] FlashSaleBanner light-theme text-on-wash fails AA — the deferred "light-wash contrast token," now measured
**Location:** `FlashSaleBanner.tsx:202` («عرض محدود», `text-2xs` = 11px bold, `text-primary-text` on the `from-primary/15`→`via-primary/14` gradient), `:221-224` («— خصم N%», same token mid-wash), `index.css:175-176` (wash gradients).
**Why:** computed on the banner's own wash over the light background (220 20% 96%): label **3.78:1** non-urgent / **3.19:1** urgent (h ≤1h); discount span **3.84–4.24:1** — all under 4.5:1 for 11-12px bold functional copy on the money-adjacent promo strip. The in-code comment (:198-201) measures against the page background (4.81:1) — true for the banner's transparent end, false where the copy actually sits. Dark theme passes (5.03+). The title beside it passes because it rides `text-foreground/90` (8.73:1 on the same wash).
**Fix:** light theme needs a wash-aware ink: either a `--banner-ink` token (primary-text in dark, foreground-tier in light) applied to both spans, or drop the light wash to ≤/8 and re-measure (still marginal — the token is the honest fix). Re-measure both themes after. **Effort: S.**

### B-2. [P3] `hover:text-primary` residuals — 4 storefront text sites the R124 sweep left
**Location:** `product.tsx:2163` (variant plan pill, 14px bold), `orders.tsx:466` (empty-state CTA, 12px bold — starts at primary-text 6.05:1 and *drops* to 3.76 on hover), `referrals.tsx:524` (loyalty CTA, 14px), `category.tsx:231` (back-to-catalog link).
**Why:** raw `text-primary` is ~3.76:1 on the dark card — sub-AA as the hover state of small text; the R124-I4 (A3 #8) sweep fixed order-detail:85, product:271, NotificationBell:517, home:1136 but stopped there. (Icon-only hovers — support:881, profile:412, orders:584 — pass the 3:1 non-text floor and are fine.)
**Fix:** `hover:text-primary-text` at the 4 sites (one commit, 4 class swaps). **Effort: S.**

### B-3. [P3] Terms breadcrumb separator still points backwards — contradicts the R124-unified idiom
**Location:** `terms.tsx:237` — `<ChevronLeft className="w-3 h-3 rotate-180 opacity-50" />`, with a comment claiming the "unified icon-direction decision."
**Why:** R124 (A1-F6) fixed category.tsx's separator and the new product breadcrumb documents the rule — "the separator denotes traversal FORWARD (parent → current), so in RTL it points LEFT" (`product.tsx:1102-1107`, unrotated). Terms is now the lone backwards exception on the storefront.
**Fix:** delete `rotate-180` at :237 (keep `opacity-50`); the comment at :236 goes with it. **Effort: S** (pure deletion).

### B-4. [P3] Error taxonomy: a 7th undocumented drifted site + the hand-rolled storefront error cards ship sub-44px retries — FetchErrorCard convergence now feasible
**Location:** `category.tsx:313-323` (hand-rolled outage card — **not** in FetchErrorCard's own drift ledger at `fetch-error-card.tsx:20-24`, which lists home/product/order-detail/admin×3); `home.tsx:1182-1196`; `product.tsx:832-854`; `order-detail.tsx:224-240`. All four render native `<button className="… px-5 py-2 …">` retries ≈37px — under the 44px floor the R124 tap batch enforced on the FetchErrorCard families (compact retry got `min-h-11`, fetch-error-card.tsx:82-87).
**Why:** the recovery path on 4 of the storefront's highest-traffic pages rides controls the R124 batch couldn't reach *because* the pages never adopted the shared card — the drift and the tap-floor miss are the same defect. Convergence is now cheap: `FetchErrorCard` grew `className`/`titleClassName`/`retryClassName` props after the extraction, which is exactly what home's grid error and category's card need; product/order-detail keep their two-button rows (retry + escape hatch) but can at least take `min-h-11` on both buttons.
**Fix:** adopt `FetchErrorCard` (size="page", `retryClassName` for the outline idiom) on home + category; add `min-h-11` to the bespoke buttons on product/order-detail; add category.tsx:313 to the component's drift ledger either way. **Effort: S per site, M total.**

### B-5. [P3] Status page: 32px refresh control + an unexplained 30s re-render tick
**Location:** `status.tsx:160-168` (icon-only `p-2` RefreshCw ≈32px) and `:71-76` (`setInterval` 30s bumping a `tick` that is consumed by nothing but a `void tick` silencer).
**Why:** the refresh button is the page's only interactive control and sits under the in-house 44px floor (passes WCAG 2.5.8's 24px, fails the repo's own bar); the 30s tick re-renders the page twice a minute in a left-open tab to keep a minute-granularity «آخر تحديث» label fresh — 2× the needed cadence with no comment explaining it.
**Fix:** `min-h-11 min-w-11` (negative-margin idiom not needed — banner-less page) + either a one-line comment pinning the tick's purpose (label freshness) or drop it to 60s. **Effort: S.**

### B-6. [P3] Cart no-image fallback: first-letter glyph at 1.66:1 with zero category cue
**Location:** `cart.tsx:246-248` — `text-primary/50` initial on the `bg-muted/60` thumb tile.
**Why:** A3 #15 flagged this class (ProductCard deliberately replaced exactly this fallback with `CATEGORY_ICON`, documenting that a bare letter "carried no category cue"); R124 fixed the support-page emoji half of #15 but not the cart/product fallbacks. The tile is the line's only visual identity inside a link; at 50% alpha the letter measures 1.66:1.
**Fix:** minimal — `text-foreground/40` (≈7:1) keeps the letter honest. Full — add `category` to `LocalCartItem` at add-time (both add sites have it on the DTO) and reuse the exported `CATEGORY_ICON` idiom, which also sets up B-11. **Effort: S (minimal) / M (icon idiom).**

### B-7. [P3] Wallet step indicators still permanently "active" (R124-A1 F2, deferred — unchanged)
**Location:** `wallet.tsx:1393,1431-1436,1505,1536,1661,1697,1830` — every `<StepDot … active />` hardcodes active; the inactive branch exists (`:288-317`) but is dead code.
**Why:** the numbered steps are decoration; on a 5-step money-in form the user gets no where-am-I signal. Onboarding's twin dots ARE derived (`onboarding.tsx:108-117`), so the honest pattern is in-house.
**Fix (ponytail):** delete the `active` prop + the inactive branch and present the dots as a flat numbered legend, or derive: step 2 active until amount valid, etc. **Effort: S.**

### B-8. [P3] Delivery-window promise still drifts (R124-A1 F10, deferred — unchanged)
**Location:** `order-detail.tsx:515` «عادةً خلال 5 إلى 15 دقيقة. ستصلك إشعار» vs `home.tsx:1271` + `onboarding.tsx:141` «فور تأكيد الدفع، وخلال 24 ساعة كحد أقصى» vs `support.tsx:72` «فوري في أغلب الحالات».
**Why:** three different typical-windows for one SLA; the 5–15 min figure appears nowhere else, and «ستصلك إشعار» presumes a pending-path notification a completed order never sends.
**Fix:** one copy change on order-detail: «طلبك قيد الإعداد — التسليم فوري عادةً، وبحد أقصى 24 ساعة. سنُشعرك عند الجاهزية.» **Effort: S.**

### B-9. [P3] Topup submit verbs still split across tabs (R124-A1 F11, deferred — unchanged)
**Location:** mobile CTA «إرسال طلب الشحن»/step «أرسل الطلب» (`wallet.tsx:1661,1686`) vs lypay CTA «تأكيد طلب الشحن»/step «تأكيد الإرسال» (`:1830,1855`).
**Why:** same action (submit a topup for admin review), two verb pairs — the drift class the R111-F2 N1 pass eliminated for checkout.
**Fix:** pick «إرسال طلب الشحن» for both CTAs + step labels (deletes the lypay variants). **Effort: S.**

### B-10. [P3] Open support ticket thread still never refreshes (R124-A1 F12, deferred — unchanged)
**Location:** `support.tsx:218-248` — `openTicket` fetches once per open; no `refetchInterval`, no socket (grep confirms zero `useSocket` in the file), and the ticket list fetches on mount only (:250-255).
**Why:** an admin reply while the user stares at the thread changes nothing until they back out and reopen; the NotificationBell toast cues it, but the visible conversation stays stale — the escape-hatch page is the one money-adjacent surface without any freshness story.
**Fix:** 15–30s `refetchInterval` while `selectedTicket && status !== "closed"` (the orders/topup polling idiom), reusing `openTicket(selectedTicket.id)`. **Effort: M.**

### B-11. [P3] Cart quantity still ignores stock; over-quantity discovered mid-charge (R124-A1 F9, deferred — unchanged)
**Location:** `lib/cart.tsx:261-277` — `updateQuantity` clamps [1, 99] with no stock knowledge; `LocalCartItem` (:11-24) carries no stock/category fields.
**Why:** checkout's re-quote fixes prices and drops dead lines but never caps a live line's quantity to stock — the excess units fail one-by-one inside the charge loop and surface as the partial banner after the user authorized money. Honest, but the user learns the limit at the worst moment.
**Fix:** snapshot `stock_count` (+ `category`, which also feeds B-6's icon) onto the line at both add sites (`ProductCard.tsx`, `product.tsx:687-708` — both have the DTO), cap the stepper in `cart.tsx`, show «متبقٍ N فقط» (ProductCard already owns the vocabulary). **Effort: M.**

### B-12. [P3] craft-floor REFUSE residue — the R124 sweep's unfinished half (R124-A3 #10/#11/#12/#13/#14, deferred — unchanged)
**Location:** side stripes >1px: hero stripes `home.tsx:478,659`, `category.tsx:269`; heading stripes `category.tsx:297,349`, `terms.tsx:26`, `support.tsx:896`; card stripes `wallet.tsx:478,1893`, `orders.ts:148`. Over-round `rounded-3xl` ×7: `login.tsx:135`, `register.tsx:99`, `onboarding.tsx:119`, `home.tsx:654,1182,1198`. Ghost card (border under shadow-2xl): the same auth/hero cards. REFUSE templates: TrustCard 3-up closing home (`home.tsx:1266-1285`), guest hero big-number chips (`:847-890`), eyebrow/tagline above the guest h1 (`:676-685`) + «مرحباً بك مجدداً» above the authed h2 (`:483-485`).
**Why:** the R124 REFUSE commit cleared the loud instances (gradient text, cta-glow, toast stripe, emoji icons) — this is the quieter debt A3 flagged at P3 that didn't make the round. No user-facing breakage; coherence cost only.
**Fix:** one batched commit per motif family: stripes → 1px or fold into border tint; `rounded-3xl` → `rounded-2xl` ×7; auth cards → pick one elevation; trust band → inline strip; hero chips → single line or drop; eyebrows → delete the spans. All deletions or downgrades. **Effort: M total.**

### B-13. [P3] Terms page freshness + long-form measure
**Location:** `terms.tsx:115-117` and `:175-177` — «آخر تحديث: مايو 2026» on both tabs, while the content was demonstrably edited after (PS-Plus removal R123-E4b, passwordless rewrite, LyPay label R120-B5 — all October-2026 rounds); `:229` — content column `max-w-2xl` (672px) minus card padding ≈ 608px at 14px ≈ **~90 Arabic chars/line** (craft-floor: 65–75ch).
**Why:** a legal page whose "last updated" stamp contradicts its own git history erodes exactly the trust the stamp exists to build; over-measure long-form Arabic fatigues the one page users read under stress (refund disputes).
**Fix:** bump the stamp to the true last-revision month (أكتوبر 2026) or derive it; cap the content column at `max-w-[65ch]`-ish (the card keeps its width, the prose narrows). **Effort: S.**

---

## C. Priority counts

**P0: 0 · P1: 0 · P2: 1 · P3: 12 — 13 findings.** (5 of the P3s are carried R124-A1 deferred items re-verified and sized: B-7, B-8, B-9, B-10, B-11; 2 more are carried A3 deferred visual debt: B-12, and B-6's class.) All fixes ≤ S except three M (B-4, B-10, B-11, B-12 — four M).

## D. Suggested fix order (ponytail — deletion beats addition)

1. **The S-effort copy/deletion commit** (one PR, zero risk): B-3 (delete `rotate-180`), B-2 (4 class swaps), B-8 (one sentence), B-9 (verb unification = deleting the lypay variants), B-7 via the honest-collapse route (delete the dead `active` prop + inactive branch), B-13 stamp, B-5's `min-h-11`. ~15 net-negative LOC.
2. **B-1 FlashSaleBanner light ink** (the only P2; one token/class decision + re-measure both themes).
3. **B-4 FetchErrorCard convergence on home+category** — deletes ~30 hand-rolled LOC per site and brings the last four storefront retries to 44px; add category to the component's drift ledger.
4. **B-6 minimal contrast fix** (one class); fold the CATEGORY_ICON version into B-11.
5. **B-11 cart stock snapshot + cap** (M — closes the last money-journey edge that surfaces at charge time, and feeds B-6's icon).
6. **B-10 support ticket refresh** (M — the escape hatch's freshness).
7. **B-12 REFUSE residue batch** (M — visual debt; ship whenever a design pass runs).
