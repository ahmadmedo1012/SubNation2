# R154 Round Close — Wallet Transfer Correction, Telegram OIDC, Provider-Aware Identity & Notification Gaps

**Round:** R154 · **Date:** 2026-10-17 · **Base:** `19ed4e5` (R153 close) · **Commits:** `490597c` (P1 wallet) → `3c81955` (P2 OIDC) → `5551489` (P3 identity) → `38f1c39` (P5 notifications)

The mission brief named R153; the ledger already carried a closed R153, so per the no-collision rule this round executed as **R154**.

---

## P1 — Wallet transfer correction (`490597c`) — VERIFIED

**The encoding finally tells the truth.** `transferCode` (single code, unscaled amount) is replaced by `transferPlan`:

- **Libyana**: USSD parameter is **millimes** (dinars ×1000); a single transfer caps at **50 LYD**. Preset 10 → `*122*218913456789*10000*1#`; **100 → TWO transfers of `*122*218913456789*50000*1#`** (never one 100-dinar transfer); 75 → 50+25 (`50000`, `25000`).
- **Madar**: parameter stays **LYD** (never scaled); cap **20 LYD**. 10 → `*140*4*1*10*0913456789#`; 50 → 20+20+10; 100 → five 20s.
- Installments: deterministic max-first + exact positive remainder; **sum === total** pinned as a property for every total 1..300 × both limits; rounding stays Math.round (the R116 code↔amount parity contract).

**The multi-transfer UI is honest.** `TransferCodePanel` renders each installment as its own row — «التحويل 1 من 2», its own dial action (`tel:` with `%23`), its own copy button — plus the ⚠ instruction (*each code is a separate transfer; complete all, then ONE request for the aggregate total*), the total pinned in the header, recompute on network/amount change, and the generic single CTA honestly retired («أكمل جميع التحويلات أولاً») instead of dialing only the first installment. No fictitious code for invalid input (pinned).

**The reference field is retired from the mobile flow (P1-A).** Field, props, wiring, payload value, and the submit-time guard are gone (the lypay tab keeps its OPTIONAL bank-receipt field + trim contract). The backend's B4-R1 hard-required branch is removed with it.

**Financial safety preserved — not weakened.** The Idempotency-Key replay, pending-cap, auto-reject heuristic, and the ENTIRE reference-based dedup battery (creation 409, V1-M9 partial unique, B2-02 in-tx exact, composite soft-dedup, lypay L7-1) stand verbatim for referenced/legacy rows. For the new ref-less mobile class: an **operator-visible duplicate-risk signal** — a `string_agg` probe on (user, amount, network, normalized sender; pending-or-approved-within-24h; ≤3 sibling ids) riding the same advisory-lock guard statement — surfaces as the pending row's `admin_note` (now rendered on pending cards with warning styling) AND a ⚠ «خطر تكرار محتمل» line on the Telegram approval card with sibling ids to compare. **A review safeguard, never a blanket rejection** (legitimate same-amount repeats pass; amount/network/sender mismatches + cross-user isolation pinned; amount/network alone provably cannot guarantee uniqueness — the UI language says «محتمل»).

## P2 — Modern Telegram Login OIDC (`3c81955`) — VERIFIED (code + protocol; live acceptance OPERATOR-GATED)

The official Authorization Code Flow with PKCE per `core.telegram.org/bots/telegram-login` (Manual Implementation), phone-free by design:

- **Scopes exactly `openid profile`** — the `phone` scope is NEVER requested (no SMS/phone consent at registration) and `telegram:bot_access` never requested. Pinned by test.
- **`GET /api/auth/telegram/oidc/login`** issues a single-use `state` + PKCE S256 verifier + nonce (server-side store, 10-min TTL, Redis-with-memory-fallback mirroring the replay-store idiom) and 302s to `oauth.telegram.org/auth`.
- **`GET /api/auth/telegram/oidc/callback`** consumes the state exactly once, exchanges the code server-side (Basic auth, BotFather Client ID/Secret — a DIFFERENT credential pair from the Bot API token), validates the RS256 ID token against the official JWKS (cached 1h, kid-matched, algorithm-pinned) with the full claim battery (issuer, audience, exp +skew, future-iat, constant-time nonce, the classic `id` claim as the linkage key — **never `sub`**, the different internal identifier), then rides the SAME `findOrCreateTelegramUser` as the widget/Mini App flows (existing accounts log in with zero duplication; the 23505 race loser returns a normal login) and mints the standard httpOnly-cookie session (no token in URLs — F-010 parity). CSRF model = state+PKCE+nonce (the B1-1 banner's documented upgrade path, realized).
- **Identity mapping**: given/family name, `preferred_username`, `picture`, auth_date=iat. Email stays unset — the profile scope carries no email claim; the UI shows «غير متاح من تيليجرام», never a fabricated address.
- **Config surface**: `auth.telegram` gains optional `oidc_client_id`/`oidc_client_secret` (admin form auto-renders; secrets masked `[SET]`; an EMPTY optional field CLEARS — the "not configured" fallback to the legacy widget flow is a legal state). The public `/api/auth/providers` response carries `oidc_enabled`; the SPA switches the Telegram button's transport on it. The legacy widget flow is preserved end-to-end until credentials exist.
- **Tests**: 24 backend (state store single-use/TTL; the full flow with REAL RSA-2048-signed tokens + mocked Telegram endpoints — authorization-URL contract, first-time registration shape, existing-account login, state replay fails closed, per-claim failure table, alg-confusion/tampered-signature/unknown-kid/malformed, valid-claim mapping incl. sub≠id; route redirect envelopes incl. forged-state-no-cookie) + 4 frontend (transport switch, ref/redirect threading, open-redirect guard, legacy fallback).

**OPERATOR ACTION REQUIRED (the only path to live OIDC):** in @BotFather select the bot → **Login Widget** → add the Allowed URL `https://subnation.ly/api/auth/telegram/oidc/callback` (plus the site origin) → copy the displayed **Client ID + Client Secret** into `/admin/settings → Telegram`. Until then `oidc_enabled=false` and the legacy widget flow stays live. NOT TESTED live (no credentials available to the agent); the exact steps are documented in-repo at the route pair.

## P3 — Provider-aware identity & the admin directory (`5551489`) — VERIFIED

- **Exactly-once new-account notifications on every channel.** The Telegram hook lives inside `findOrCreateTelegramUser`'s committed-creation path (widget + Mini App + OIDC all land there; the race loser and every normal login stay silent). The WhatsApp OTP verify route joins (real verified phone, nothing fabricated). The Google/Firebase path now carries the verified claims.
- **The card is provider-aware and honest**: provider label (new «واتساب (OTP)» — WhatsApp users were mislabeled «هاتف (Firebase)» on every operator card), name, real phone or **«لم يقدّم رقم هاتف»** (a tg_/f_ placeholder is never echoed as a number), Telegram `@username` + classic id, real email or **«غير متاح من تيليجرام»**, referral marker, `#id`, timestamp, and a deep-link button to `/admin/users?search=<id>`.
- **`users.telegram_username`** — nullable, display-only (never a linkage key), added through the 4-place contract (Drizzle schema + `USERS_FINAL_COLUMN_DDL` reconcile stage + regenerated `0025_zippy_loa.sql` chain + pglite harness; additive, boot-reconciled, no `db:push`), persisted at creation and **refreshed when the @handle changes** on later logins.
- **The admin directory**: search now covers id/phone/display-name/email/telegram-username/telegram-id (lowercased ILIKE, wildcards escaped, numeric id equality); the response carries the Telegram identity pair (openapi + orval regen); rows (desktop+mobile), GlobalSearch, the edit dialog, the money-confirm/toast copy, aria-labels, and the CSV export all render placeholder-safe phones (`displayUserPhone`: the real number or «لا يوجد رقم هاتف مرتبط»); the CSV gains the «هوية تيليجرام» column (with the OWASP `@`-guard pinned).

## P5 — Notification gaps (`38f1c39`) — VERIFIED

Six closed gaps from the post-R153 census: (1) order placement writes the customer's first notifications row («تم استلام طلبك», name + price + deep link; replays never re-notify); (2) topup submission writes the persistent «قيد المراجعة» row (the waiting modal only covered the open tab); (3) the serial-abuser auto-reject now notifies the customer honestly (previously NOBODY was notified); (4) the bell joined the `SOCKET_RESYNC_EVENT` consumers (a reconnect on a socket-bearing page no longer leaves the badge stale up to 60 s); (5) the admin toast labels cover all 11 AlertTypes (six rendered the generic «تنبيه»); (6) stale docs corrected (the bell's R126-era "pagination deferred" comment; the admin notifications panel lists all 9 shipped events).

## Gates

| Gate | Result |
|---|---|
| Backend battery | **2,549 / 2,549** (4 sequential chunks: lib+middlewares 753, routes 860, services 428, jobs+root 508) |
| Frontend battery | **2,529 / 2,529** |
| Combined | **5,078** (+54 vs R153's 5,024) |
| Lint | **0 errors / 15 warnings** (baseline held) |
| Typecheck | clean (backend + frontend + libs + scripts) |
| Route parity | **86 ops** (+2: the OIDC pair) |
| Error-code sync | 55 |
| Header params | 7/7 |
| Drizzle migration drift | none (chain regen `0025_zippy_loa.sql` committed) |
| Production build | green — eager path **146,719 B gz** (+4 B vs R153; budget 150 KiB) |
| CI | `490597c` ✓ · `3c81955` ✓ · `38f1c39` ✓ (final HEAD green; `5551489`'s run was concurrency-cancelled by the superseding push — its code is covered by the final green run) |

## Status labels

- P1 transfer encoding/UI/reference-retirement/dup-risk signal: **VERIFIED**
- P2 OIDC protocol implementation + security battery: **VERIFIED**; live Telegram acceptance: **NOT TESTED — OPERATOR-GATED** (BotFather credentials + Allowed URL; steps documented)
- P3 identity persistence + notifications + directory: **VERIFIED**
- P5 notification gaps: **VERIFIED**
- Production deployment verification: **NOT TESTED** — no deploy was triggered during this session's authoring window; the Coolify workflow is operator-controlled. The pushed HEAD (38f1c39) is production-safe (all gates green) and will deploy on the established push-triggered workflow.

## Deferred (with rationale)

- `/unread-count` endpoint (R153's deferral): still queued — needs the openapi+orval+zod chain; the badge's 40-row window remains the honest bound.
- Refund / flash-sale-expiry / ticket-created Telegram operator cards: candidate follow-ups (drawer rows exist today); not in this round's brief scope beyond the closed gaps.
- `admin/enrichment.tsx` behavioral tests (R153's deferral): unchanged.
