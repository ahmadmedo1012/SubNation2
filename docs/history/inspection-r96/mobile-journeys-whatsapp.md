> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r96/mobile-journeys-whatsapp.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R96-A4 — Mobile User-Journey Audit + WhatsApp OTP Deep-Dive

Agent: R96-A4 (diagnostic specialist, RESEARCH ONLY — no source modified)
Date: 2026-09-08 | Repo: /home/z/my-project/repos/SubNation2
Scope: storefront journeys on a phone (discover→buy, auth, wallet/topup, support/terms/status/404, error coverage) + WhatsApp OTP flow deep-dive including the live "Waiting for this message" production bug.

Severity legend: **P0** = money-loss / blocked journey / broken auth · **P1** = significant friction or unreliable UX · **P2** = polish/reliability gap · **P3** = minor.

Counts: **1 P0 · 6 P1 · 5 P2 · 4 P3** (16 findings).

---

## §1 — WHATSAPP "WAITING FOR THIS MESSAGE" — ROOT-CAUSE ANALYSIS + FIX DESIGN [P0]

### 1.1 The production symptom

After the operator linked the `subnation-otp` session (pair code or QR via the OpenWA dashboard), OTP requests **succeed server-side** (`POST /api/auth/whatsapp/start` returns 200, an OTP row is inserted) but the receiving phone renders **"Waiting for this message. This may take a while."** instead of the code. This is WhatsApp's placeholder for a message whose ciphertext the receiving device cannot decrypt yet (or ever).

### 1.2 Root-cause hypothesis (verified in code — the race is present)

The classic multi-device encryption/sync race: a companion device sending too soon after linking, before **sender-key upload / prekey propagation / app-state (CHAT) sync** completes. Our code has **no settle gate of any kind** between "session reports ready" and "first OTP dispatch":

1. **`ensureSession()` treats OpenWA lifecycle `ready` as immediately sendable.**
   `backend/src/services/openwa.service.ts:295-324` — `if (session.status !== "ready") … return { ok:false, reason:"session_not_ready" }`; otherwise it caches the id for 30 s (`READY_CACHE_TTL_MS`, line 136) and the caller proceeds straight to preflight + send. In whatsapp-web.js (the engine OpenWA wraps), `ready` fires at authenticated+socket-connected — **before** the companion device's sender-keys/prekeys have propagated to WhatsApp servers and to peers' device lists. Messages sent in that window are encrypted under keys the receiver cannot resolve → "Waiting for this message".

2. **The 30 s caches _amplify_ the race.** `readinessCache` (`getWhatsAppGatewayReadiness`, openwa.service.ts:504-547) flips to `ready` the moment the session pairs, and `/api/auth/providers` (`backend/src/routes/auth-settings.ts:277-285`) immediately stops showing the r95 "قيد الربط مؤقتاً" hint — so the very first user after linking is actively invited to request an OTP **within seconds of pairing**.

3. **A 200 from the gateway is trusted as "delivered".** `sendWhatsAppMessage` (openwa.service.ts:447-482) is single-shot, no retry, and `startOtp` (`backend/src/services/whatsapp-otp.service.ts:159-178`) inserts the OTP row the moment the gateway returns 2xx. `send-text` returning 200 only means "accepted by the gateway's engine", not "decryptable on the handset".

4. **The user's natural recovery path stays inside the broken window.** Resend cooldown is 60 s (`OTP_RESEND_COOLDOWN_SEC`, lib/whatsapp-otp.ts:39) and the hourly cap is 5 (`OTP_HOURLY_LIMIT`, line 42) — so up to 5 resends all land within the first ~5 minutes after linking, i.e. while propagation may still be incomplete, after which the phone is rate-limited for the rest of the hour with every emitted code unreadable.

5. **The UI's only resend affordance is hidden behind a destructive reset** (see §4.1, P1) — on the code step the user's single escape is "تغيير الرقم", which wipes the phone number and returns to the pristine button. The exact scenario this bug creates (code step, nothing arrives) has the worst possible recovery path.

6. **Verified absence of any mitigation**: `rg -i "settle|warm.?up|self.?check|ready.?since|chat.?sync"` across `backend/src` → zero matches in the WhatsApp path (only worker-heartbeat / Redis-settle unrelated hits). No `readySince` tracking, no warm-up message, no post-link self-check, no retry/backoff anywhere.

7. **Aggravator — gateway cold starts.** The OpenWA service runs on Render free tier: first request after idle takes ~30-60 s (documented in `docs/WHATSAPP_OPERATIONS.md` + round-95 notes) while our gateway fetch timeout is `REQUEST_TIMEOUT_MS = 8_000` (openwa.service.ts:155). A cold-starting gateway makes `ensureSession` fail → `delivery_failed` → 502 "تعذّر إرسال الرمز عبر WhatsApp" — a _second_ way the first OTP after idle fails, with no retry.

### 1.3 Fix design (P0) — code-level

The gateway service is a separate repo, so the fix is designed to land **fully inside SubNation** with two optional one-line asks for the gateway.

**A. Post-link settle gate — `backend/src/services/openwa.service.ts`**

- New module state: `sessionReadySince: Map<string, number>` + Redis mirror `openwa:ready-since:{sessionId}` (SETNX, TTL 7 d) so multiple backend instances share the observation. Populate on every `findSession()` result: if `status === "ready"` and no prior record → record `Date.now()`.
- New constant `POST_LINK_SETTLE_MS` (env `WHATSAPP_OTP_SETTLE_MS`, default **45 000**, clamp 0–300 000).
- In `ensureSession()`, after the `ready` check: `const settled = now - readySince >= POST_LINK_SETTLE_MS`. If not settled → new typed failure `{ ok:false, reason:"session_settling", readyInMs }` (add to the `SendResult` union, openwa.service.ts:109-124).
- **Bounded wait instead of hard reject (better UX)**: for the first OTP after linking, `sendWhatsAppMessage` may `await` the remaining settle window (cap 45 s) before dispatching — one spinner with honest copy beats a 503 round-trip. Design supports both; recommend wait-then-send for `start`, reject only if the wait exceeds the cap.

**B. Warm-up self-check (encryption bootstrap on a harmless chat) — new `startWhatsAppWarmupLoop()` in openwa.service.ts, wired from `server.ts` next to the other schedulers**

- When a session is first observed `ready`: after the settle window elapses, send a benign message to the **operator's own linked number** (env `WHATSAPP_OTP_OPERATOR_E164`; skip silently when unset): text `«قناة SubNation جاهزة ✓ (رسالة تهيئة)»`. This forces LID resolution on a self-chat, sender-key distribution, and app-state sync **before any OTP flows** — exactly the "heartbeat self-check message before marking dispatch-ready" requirement.
- Track `dispatchReady: Map<sessionId, boolean>`; only warmup-ok sessions pass `ensureSession`.
- Repeat every **6 h** (keeps session keys fresh and the free-tier gateway warm, complementing its own 4-min self-ping).

**C. Honest route + provider states — `backend/src/routes/auth-whatsapp.ts`, `whatsapp-otp.service.ts`, `auth-settings.ts`**

- Map `session_settling` → HTTP 503, `details.reason: "whatsapp_settling"`, `retry_after_sec: ceil(readyInMs/1000)` + `Retry-After` header, Arabic copy: «قناة WhatsApp ربطت للتو — تُهيَّأ الآن وتصبح جاهزة خلال أقل من دقيقة» (mirrors the r95 `whatsapp_not_paired` mapping at auth-whatsapp.ts:74-94).
- `getWhatsAppGatewayReadiness()` gains `settling: boolean` + `readyInSec`; `ready: true` only when `status==="ready" && settled && warmup-ok`. `/api/auth/providers` `whatsapp_status` can then say `"settling"` so the login hint (WhatsAppPhoneSignIn.tsx:246-251) tells the truth during the window.

**D. Send-path resilience — `sendWhatsAppMessage` (openwa.service.ts:447-482)**

- Retry `POST …/messages/send-text` up to **3 attempts** with backoff **1.5 s → 4 s** (total bounded < 15 s), only for network errors / 5xx / timeout — never 4xx. Re-run `ensureSession()` between attempts (the ready cache is already invalidated on failure, line 460).
- This also absorbs the free-tier cold start when combined with the warm-up loop (B).

**E. Frontend honesty — `frontend/src/components/WhatsAppPhoneSignIn.tsx` + `hooks/use-public-auth-providers.ts`**

- Handle `whatsapp_settling` (503 + `retry_after_sec`): show «تُهيَّأ القناة بعد الربط — سنرسل الرمز تلقائياً خلال <N> ثانية», auto-retry `sendCode()` after `retry_after_sec` (max 2 auto-retries, then manual).
- Add the resend affordance on the code step (§4.1) and surface the OTP TTL from the already-returned `expires_at` (auth-whatsapp.ts:118) as a 5:00 countdown — currently ignored by the client.

**F. Gateway asks (out-of-repo, optional but ideal)**

- `SessionResponseDto` += `readyAt` (ISO timestamp) — lets SubNation compute the true settle window across its own restarts instead of first-observation time.
- Longer term: expose an engine-level `chats.set`/app-state-sync-complete signal (e.g. a `synced` lifecycle status) — the ideal gate is full app-state sync, not a timer.

**Why 45 s default**: pair-code linking typically completes key propagation in 10-30 s; QR (device-list rebuild) can take longer. 45 s covers both while staying under the 60 s resend cooldown, so a user who hits the window early is served by the bounded-wait (A) rather than a rejection.

---

## §2 — Discover → Buy journey (home → category → product → cart → checkout → order-detail)

Walked: `home.tsx`, `category.tsx`, `product.tsx`, `cart.tsx` + `lib/cart.tsx`, `checkout.tsx`, `order-detail.tsx`, `orders.tsx`, backend `routes/orders.ts`, `services/checkout.service.ts` (via route), `middlewares/idempotency.ts`.

**What is already strong**: cart persists in localStorage (`subnation_cart_v1`, cart.tsx:32,58-130) so refresh/mid-checkout navigations keep state; checkout keeps form state on failure (persistent `orderError` banner, partial-success accounting, cart shrunk to exactly what was charged — checkout.tsx:277-465); balance probe failure renders an honest "—" + non-blocking warning (checkout.tsx:150-179, 503-527); insufficient-balance path deep-links `wallet?return=/checkout` (checkout.tsx:536-543); server re-prices every unit (PRODUCT_STALE/STALE_FLASH_SALE 409 with honest Arabic copy, orders.ts:186-235); order-detail 404 vs network error are distinct (order-detail.tsx:152-224); home/category have retry-able error states (home.tsx:779-788).

### 2.1 [P1] Stale money states after backgrounding — socket gives up + no focus/reconnect resync

- **Evidence**: `frontend/src/lib/socket.ts:38` — `reconnectionAttempts: 5` (Socket.IO gives up after 5 tries ≈ 15 s of failures; a backgrounded phone or WiFi↔cellular handoff exhausts this silently). `App.tsx:188,196` — `refetchOnWindowFocus:false`, `refetchOnReconnect:false`. The only visibilitychange resync in the storefront is NotificationBell (NotificationBell.tsx:227-238) — nothing re-validates `/api/orders*`, `/api/wallet`, `/api/wallet/topups`, or the open order-detail query.
- **Mobile scenario**: buyer submits order → locks phone → admin completes the order → buyer reopens the tab → order-detail still shows «قيد المعالجة» indefinitely; wallet balance chip stale after a backgrounded topup approval. No reload prompt, no error — just wrong data on money screens.
- **Fix direction**: in `SocketInitializer` (mounted once, App.tsx:409-425) add a `visibilitychange` + `online` listener that (a) calls `socket.connect()` when `!socket.connected` (idempotent, revives a given-up manager), (b) invalidates the _transactional_ query families only (`/api/orders*`, wallet, topups, `/api/auth/me`) when `document.visibilityState === "visible"` and data is older than ~30 s. Keeping catalog queries out preserves the intentional anti-refetch-storm decision (App.tsx:189-196).

### 2.2 [P1] Checkout unit-order idempotency keys are not stable across retry attempts — double-charge window

- **Evidence**: `checkout.tsx:359` — `generateIdempotencyKey()` is generated inline per unit **per confirm click**; a manual retry after a network-level failure (the outer catch at checkout.tsx:450-458 deliberately keeps the cart, server state unknown) issues **new keys** for units whose request may already have committed. The comment at checkout.tsx:348-351 claims replay protection for "a network retry … of this exact unit", but no transport-level retry exists (React Query mutations default `retry:0`), so the Redis + in-tx guard (`routes/orders.ts:108-135`, `middlewares/idempotency.ts`) never sees the same key twice on the path that matters. `lib/idempotency.ts:24-32` itself prescribes "generate the key ONCE when the user initiates a logical action … preserved across retries".
- **Mobile scenario**: 3G black-hole at unit 2 of 3 → spinner → error banner → user taps تأكيد الطلب again → unit 2 charged twice (2 account credentials delivered, wallet hit twice).
- **Fix direction**: persist per-unit keys in sessionStorage (`subnation_checkout_key:{productId}:{unitIndex}`) at generation; reuse them on the next confirm attempt for units not yet confirmed ordered/rejected; delete on confirmed HTTP-failure (definitive rejection) and on success. Server side needs no change — the durable guard already keys on the header.

### 2.3 [P1] Product page single-buy sends NO Idempotency-Key at all

- **Evidence**: `product.tsx:245-246` — `useCreateOrder` request config sets only Authorization; both `onBuy` call sites (product.tsx:816, 868) call `mutate({data:…})` with no headers. `POST /api/orders` middleware passes through when the key is absent (`middlewares/idempotency.ts:20-24`).
- **Mobile scenario**: jittery tap → first request lands but response is lost → mutation resets (`isPending` false) → user taps شراء الآن again → second order, second wallet deduction.
- **Fix direction**: generate a key per buy-intent (`useRef`/state reset on success-or-definitive-failure) and pass `headers: {"Idempotency-Key": key}` via the mutation's second argument (same shape as checkout.tsx:358-360).

### 2.4 [P2] Buy-intent login loses the product context

- **Evidence**: `product.tsx:478` navigates to `/login?intent=buy&product=<name>`; `login.tsx:74-76` honors only `?redirect=` — on success the intent flow lands on `/` (the banner promised «سجّل دخولك لإكمال شراء «X»», then dumps the user on home).
- **Fix direction**: append `&redirect=/product/<slug>` to the intent navigation (or make `handleLoginSuccess` fall back to the intent product URL).

### 2.5 [P3] Cart is localStorage-only

- `lib/cart.tsx` (no server sync; the `cart` DB table/routes exist but aren't used by this flow). Safari private mode / "clear website data" silently empties the cart mid-journey. Acceptable trade-off; note for awareness.

---

## §3 — Auth journeys (login / register / onboarding / token lifecycle / 401 mid-journey)

Walked: `login.tsx`, `register.tsx`, `WhatsAppPhoneSignIn.tsx`, `AuthProviders.tsx`, `TelegramLoginButton.tsx`, `auth-callback.tsx`, `telegram-callback.tsx`, `onboarding.tsx`, `lib/auth.tsx`, `lib/admin-session.ts`, `shared/api-client-react/src/custom-fetch.ts`, backend `routes/auth.ts`, `routes/auth-whatsapp.ts`, `routes/auth-settings.ts`, `lib/session.ts`, `app.ts` (limiters).

**What is already strong**: httpOnly cookie + JWT hybrid with a boot probe behind a splash gate (auth.tsx:188-288) — no logout flicker, no token in localStorage (Safari ITP-safe); 30-day session TTL consistent across JWT/cookie/DB row (session.ts:6-7); logout actually revokes server-side (auth.ts:126-150); guarded `?redirect=` threading on login + WhatsApp + Telegram callback paths (login.tsx:56-67, telegram-callback.tsx:101-110,180-187); onboarding is honest (no fake inputs, non-fatal completion POST, onboarding.tsx:44-72); admin has a full 401 mid-work handler (admin-session.ts) with dedupe + redirect; the 401 observer hook exists in the shared client (custom-fetch.ts:389-399) — ready to be reused.

### 3.1 [P1] Storefront 401 mid-journey is a dead end — no re-login redirect

- **Evidence**: `admin-session.ts:33-35` explicitly scopes the global 401 handler to `/api/admin/*` only ("storefront … out of scope"). No storefront handler is registered anywhere (`setUnauthorizedHandler` callers: only `useAdminHeaders`). When the server session dies mid-visit (30-day expiry, `logout-all-devices` from another device, admin deletion), the client `token` state stays truthy (sentinel, auth.tsx:65) because it only refreshes at boot — every subsequent API call 401s and pages render generic error banners ("تعذّر تحميل الطلب", order-detail.tsx:182-206) with retry buttons that can never succeed.
- **Mobile scenario**: user returns after 31 days to an open checkout tab → taps تأكيد الطلب → ApiError 401 → orderError banner shows a generic auth message; no prompt to sign in again; cart survives but the user must self-diagnose.
- **Fix direction**: mirror the admin pattern — a `user-session.ts` module registering on the same `setUnauthorizedHandler` choke point: on first non-`/api/auth/*` 401 while a user session is believed active → one toast «انتهت الجلسة — سجّل دخولك مجددًا» (15 s dedupe), `setToken(null)` + `disconnectSocket()`, soft-navigate `/login?redirect=<current>` (checkout form + cart survive via localStorage). The observer already fires for every 401 (custom-fetch.ts:393-399) — only the handler is missing.

### 3.2 [P2] International phone input not normalized (+218 / 00218 paste fails)

- **Evidence**: backend `normalizeLibyanPhone` (lib/crypto.ts:59-65) accepts only bare 9-digit `91-94…` or `09…`; frontend input strips non-digits and hard-caps at 10 (WhatsAppPhoneSignIn.tsx:260) so pasting `+218 91 345 6789` truncates to `2189134567` → `invalid_phone` → «رقم الهاتف غير صالح». Contacts/WhatsApp-profile copies on phones are almost always international format.
- **Fix direction**: in both the `onChange` sanitizer and `normalizeLibyanPhone`, strip a leading `00218`/`218` (after digit-strip) before the 9-digit validation; keep the 09-prefix hint for local format.

### 3.3 [P2] No request timeouts on interactive auth fetches (infinite spinner risk)

- **Evidence**: `WhatsAppPhoneSignIn.tsx:93-97,127-131` (`fetch("/api/auth/whatsapp/start"|"verify")` — no `signal`), same for the coupon validate probes (checkout.tsx:212,311), support submits (support.tsx:253,285), onboarding complete (onboarding.tsx:58), auth probes (auth.tsx:219,258). Server-side, the OTP route itself can take up to ~24 s worst case (ensureSession 8 s + preflight 8 s + send 8 s, openwa.service.ts:155,172) before answering.
- **Mobile scenario**: cellular black-hole → the send-code button spins indefinitely; user backs out and retries, stacking requests.
- **Fix direction**: `AbortSignal.timeout(15_000)` on all interactive storefront mutations; map `TimeoutError`/`AbortError` to the existing «تعذّر الاتصال بالخادم» copy with a retry affordance.

### 3.4 [P2] Shared authLimiter can false-lock CGNAT-mobile users

- **Evidence**: `app.ts:761` mounts `authLimiter` (10 req / 15 min / IP, successes counted — app.ts:492-510) across `/api/auth/whatsapp/*` **and** Google/Telegram/admin login. Libya's mobile carriers widely share egress IPs (acknowledged at app.ts:426-428 for the 600/min API limiter). One OTP login = start+verify = 2 requests; a wrong-code retry loop (5 cap) + resends exhausts 10 quickly; strangers behind the same IP then see 429 «تم تجاوز حد المحاولات» for 15 min.
- **Fix direction**: keep per-phone limits in the OTP orchestration (already strict: 60 s / 5 per hour / 5 attempts) and raise the IP ceiling for `/api/auth/whatsapp/start` specifically (e.g. 20/15 min) while keeping verify + password admin login at 10; or key the start limiter per (IP, phone).

### 3.5 [P3] Legacy `/auth/callback` drops `?redirect=`

- `auth-callback.tsx:54,63` navigates to `/` unconditionally, while the Telegram callback thread properly (telegram-callback.tsx:175-187). Only the legacy Google-redirect fallback path is affected; the popup path honors `onSuccess`. Align by reading the same guarded `redirect` param.

---

## §4 — WhatsApp OTP flow (deep) — beyond the §1 race

### 4.1 [P1] No resend affordance on the code step — the worst recovery path for the exact production bug

- **Evidence**: the code-step UI (WhatsAppPhoneSignIn.tsx:308-374) offers only paste / تحقق / «تغيير الرقم». `resetFlow()` (line 152-158) wipes **phone + code + step**. The 60 s «إعادة الإرسال (Xs)» affordance lives only on the _phone_ step's send button (line 279-289).
- **Mobile scenario**: message undecryptable (§1) or simply delayed on WhatsApp's side → user sits on the code step → the only path to a new code is «تغيير الرقم» → re-type the number → resend. Every 60 s. During the production incident this multiplies abandonment.
- **Fix direction**: render a secondary «لم يصلك الرمز؟ إعادة الإرسال» button inside the code step wired to `sendCode()` (it already respects the cooldown + re-uses the stored phone); keep the phone state intact. Optionally surface `expires_at` as a 5:00 countdown (already returned by the backend, auth-whatsapp.ts:118, currently ignored).

### 4.2 [P2] OTP delivered but DB insert fails → duplicate messages on retry

- **Evidence**: `whatsapp-otp.service.ts:158-222` — send happens BEFORE insert (deliberate: no dead rows). If the insert throws (DB blip) the route 500s («حدث خطأ، حاول مجدداً») with **no cooldown set client-side** (cooldown only starts on success, WhatsAppPhoneSignIn.tsx:110-111) → the user retries immediately → a second WhatsApp message is delivered while the first code is also still valid.
- **Impact**: low (verify picks the latest row, whatsapp-otp.service.ts:281-292 — newest wins) but it confuses users ("which code?") and burns the hourly cap.
- **Fix direction**: wrap the insert in a retry-once; on failure return a 200-with-warning shape or set a short client cooldown via `retry_after_sec` on the 500 path.

### 4.3 [P3] `whatsapp_otps` pruning never scheduled

- `pruneExpiredOtps()` (whatsapp-otp.service.ts:507-512) is exported but not wired to any cron ("Not wired to a cron job in this commit"). Rows are tiny but accumulate forever now that the channel is live. Wire it into the existing retention policy job (`jobs/cron.ts` 00:00 policy sweep).

### 4.4 Positive notes (verified)

- OTP crypto: CSPRNG 6-digit, HMAC-SHA256 with purpose-scoped derived key (A8-07), timing-safe compare, 5-attempt atomic hard-consume, replay-guarded consume (whatsapp-otp.service.ts:355-370) — brute-force surface is closed.
- Frontend auto-submit guard (WhatsAppPhoneSignIn.tsx:201-208) prevents double-verify of the same code; smart paste extraction (165-167, 318-329) is genuinely good mobile UX (`autoComplete="one-time-code"` included).
- r95 honesty chain (`whatsapp_status` probe → hint under the button → distinct `whatsapp_not_paired` 503) works as designed; the settle gate (§1.3C) slots straight into this existing mechanism.
- Referral attribution parity (ref event row in-tx, welcome bonus ledger) — F2 round-94 confirmed in code (whatsapp-otp.service.ts:434-471).

---

## §5 — Wallet topup journey

Walked: `wallet.tsx`, `TopupWaitingModal.tsx`, `hooks/use-socket.ts`, backend `routes/wallet.ts`, `services/topup.service.ts`, `lib/socket.ts`.

**What is already strong**: waiting modal is a dedicated state machine (30 s cosmetic countdown → honest «ما زلنا نراجع طلبك», no forced close while waiting — TopupWaitingModal.tsx:99-143); 3 s poll fallback with `refetchIntervalInBackground:true` (line 61-74) + socket invalidation of the same query (use-socket.ts:85-108); balance/topup list error cards with retry (wallet.tsx:422-446, 607-630); MAX_PENDING=3 gate with oldest-pending age shown (448-462, 691+); payment_reference dedup machinery on approval (advisory lock + in-tx check + partial unique index — topup.service.ts:81-112, 224-300); return-to-product flow via sessionStorage (wallet.tsx:384-400); USSD `tel:` transfer code with copy fallback (wallet.tsx:254-317).

### 5.1 [P2] Topup create has no idempotency — double pending rows on double-submit

- **Evidence**: `routes/wallet.ts:120` — `POST /topups` mounts `requireUser` + risk guard only (no `idempotency()` middleware; contrast orders.ts:112). Frontend `topupMutation.mutate` (wallet.tsx:569-580) sends no `Idempotency-Key`. The `submitting` state + MAX_PENDING check guard the happy path, but a slow network + impatient double-tap/double-Enter creates 2 identical pending requests.
- **Mobile scenario**: two pending «50 د.ل» rows; admin must reject one manually; user confusion + review friction. (Money duplication is still blocked at approval by the reference dedup — only when a reference was entered.)
- **Fix direction**: send `generateIdempotencyKey()` on the mutation (stable for the submit intent) and mount `idempotency({ routeKey: "topups.create" })` — both halves already exist as generic infrastructure.

### 5.2 [P3] Waiting state lost if the OS kills the tab

- If the browser evicts the backgrounded tab mid-wait, the modal state (topupId in React state) is gone; recovery = navigate to /wallet and read the pending list (which is prominent and honest). Notification bell refetches on visibility (NotificationBell.tsx:227-238) so approval toasts resume. Residual risk is low; a `sessionStorage` `subnation_pending_topup` id could auto-reopen the modal — optional polish.

---

## §6 — Support / terms / status / not-found + error coverage

- **support.tsx**: ticket create/reply double-submit guarded (`submitting`, line 245-285, 552, 642); error toasts present; no fetch timeouts (covered by §3.3 fix). Reachable from footer + 404 quick links.
- **terms.tsx**: links only to `/` and `/support` (lines 218-263) — no dead links; long-content layout matched by skeleton (App.tsx:117-118).
- **status.tsx**: chromeless, 90 s poll, honest unknown-state (never green on missing data, status.tsx:87-95) — works even when SPA state is broken.
- **not-found.tsx**: quick links to /, /wallet, /orders, /support; `noindex,follow` + soft-404 mitigation documented.
- **ErrorBoundary**: storefront Switch + separate admin boundary (App.tsx:358-389, 250-282) — a crash in one page keeps the shell + navigation alive; lazy Sentry import on the error path; reload/home actions are mobile-sized (44 px+ targets).
- **Toasts**: unified sonner shim (`hooks/use-toast`), money-critical errors use persistent in-page banners (checkout orderError with partial-success accounting) rather than 4 s toasts — correct severity mapping throughout the walked flows.

No dead-ends found on these pages beyond the items above.

---

## §7 — Backend mobile-network resilience (cross-cutting)

| Concern                               | Status                                                                        | Evidence                                     |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| Frontend AbortController/timeout      | ❌ absent on all storefront interactive fetches                               | §3.3 (only admin/profile use them)           |
| Server gateway timeouts               | ✅ 8 s per gateway call (but < free-tier cold start, see §1.2-7)              | openwa.service.ts:155,172                    |
| Redis command timeouts                | ✅ raced + degraded fallback                                                  | redis-client.ts, idempotency.ts:13-18        |
| DB statement timeout                  | ✅ (db-statement-timeout test)                                                | lib/db-instrumentation.ts                    |
| Idempotency on checkout               | ✅ Redis + durable in-tx guard                                                | orders.ts:108-135 — but key instability §2.2 |
| Idempotency on topup                  | ❌ not mounted                                                                | §5.1                                         |
| Socket reconnect backoff              | ⚠️ default backoff, **5 attempts then dead**, no revival                      | socket.ts:38, §2.1                           |
| Query invalidation on reconnect/focus | ❌ globally disabled                                                          | App.tsx:188,196, §2.1                        |
| Rate limiting                         | ✅ layered (IP 600/min, user 1200/min, auth 10/15 min) with CGNAT caveat §3.4 | app.ts:424-510, 749-761                      |

---

## §8 — Prioritized remediation order

1. **P0 §1.3 A+B+C** — settle gate + warm-up self-check + honest settling state (the live production bug).
2. **P1 §4.1** — resend button on the OTP code step (cheapest, highest-leverage UX fix for the same incident).
3. **P1 §2.1** — socket revival + transactional resync on visibilitychange/online.
4. **P1 §2.2 + §2.3** — stable idempotency keys on both buy paths (money).
5. **P1 §3.1** — storefront 401 handler (mirror admin-session pattern).
6. **P1 §1.3 D** — send retry/backoff (absorbs gateway cold starts).
7. P2s: fetch timeouts, +218 normalization, topup idempotency, authLimiter tuning, buy-intent redirect.
8. P3s: otp pruning cron, legacy callback redirect, topup modal rehydration, expiry countdown.
