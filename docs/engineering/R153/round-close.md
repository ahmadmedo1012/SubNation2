# R153 — Telegram approval recovery, notification excellence & whole-product round: closing report

Round base: `9c9755e` (R152 close). Method: the repo's standing Ponytail
ruleset (root `AGENTS.md`) + `.hermes.md` routing. Two pushed
milestones, each independently CI-verified before the next:

1. `05fe365` — Priority One: the Telegram approval incident + the
   Bot-API hardening + the pending-card settlement system.
2. `ed8d049` — Priority Three: the website-notification freshness and
   honesty defects + the light-theme border parity fix + the
   auth-callback coverage gap.

Mission context: the whole-product excellence program, opened by a
production report: the operator taps ✅ in Telegram and the bot answers
«تمت معالجة هذا الطلب مسبقاً».

## 1. The Telegram incident — root cause and fix (VERIFIED)

### 1.1 Root cause (three producing paths, one shared UX defect)

The message itself is the webhook's stale-branch toast
(`telegram-webhook.ts`: the pre-check found `status !== "pending"`). It
is truthful that the topup was not pending — but it is silent about
WHICH terminal state, WHO acted, and it replaced the success feedback
the operator should have seen. Three production paths produce it:

- **The slow-answer window (the primary):** the success path answered
  the callback query LAST — after the full money transaction AND up to
  30 s of sequential Bot-API edit timeouts (10 s each: keyboard strip,
  text edit, answer). On a slow delivery the tap→feedback window
  stretched to seconds; the operator double-tapped, and Telegram
  re-delivered updates (its documented behavior on slow acks). Every
  second tap landed on the already-committed row and answered with the
  ambiguous stale message — while the FIRST tap had actually succeeded.
- **The website stale card:** a website (admin-console) approval never
  edited the Telegram pending card — the site had no message identity —
  so the card's ✅/❌ buttons stayed live forever, a trap for the next
  operator tap.
- **The race-loser mislabel:** a concurrent duplicate delivery that
  lost the service's in-tx guarded-UPDATE race surfaced as
  «فشل تنفيذ الإجراء، حاول مجدداً» — factually wrong (the twin
  delivery committed the approval) and inviting another tap.

The money state machine was never at fault: the in-tx re-check, the
guarded `UPDATE … WHERE status='pending'`, the advisory locks and the
partial unique index all held — exactly one credit per topup in every
scenario (pinned again by this round's tests).

### 1.2 The fix (7 files, +851/−35)

**`routes/telegram-webhook.ts`**
- The stale branch now reads `status + reviewedBy` and answers
  truthfully and distinctly: «هذا الطلب معتمد بالفعل بواسطة X» /
  «هذا الطلب مرفوض بالفعل بواسطة X» (bare form for legacy rows), AND
  stamps the final state on the card text (not just stripping the
  keyboard — the card stopped reading «⏳ بانتظار الموافقة» with no
  buttons), idempotently (a prior outcome line is detected; Telegram's
  "message is not modified" collision is classified benign).
- The success path answers the tapper FIRST — immediately after the
  money transaction commits, BEFORE the durable card edits. The
  tap→feedback latency collapses to the transaction duration; the
  double-tap/retry window closes.
- The catch branch surfaces `ServiceError` verdicts verbatim (the
  operator sees the money machine's own Arabic: duplicate reference,
  changed balance, …) and for the 409 race-loser re-reads the state
  and answers the truthful verdict — never «حاول مجدداً» for an
  operation that succeeded via its twin delivery.

**`lib/telegram-gateway.ts`** — `apiCall` now parses the Telegram body
and classifies `{ok:false}`: benign collisions ("message is not
modified", "query is too old") at debug (expected under retries), real
failures (bad token, chat not found, …) at warn with method +
error_code + description. A failed card edit is finally observable
instead of silently mistaken for success — while remaining never-fatal
to committed money.

**`lib/telegram-cards.ts` (new) + `telegram.ts` + `services/topup.service.ts`**
— the website-path closure: `notifyNewTopup` captures the delivered
message identity (`result.message_id`, exposed through the dispatch
pipeline) and stores `{chatId, messageId, text}` in Redis (30-day TTL,
best-effort, keyed by topup id). `TopupService.approve/reject` now
settle the pending card from ANY finalization path — the outcome line
appended, the keyboard stripped, claim-then-delete idempotency under
racing callers (the webhook's own benign double-edit is absorbed by
the gateway classification). Redis absent / key expired / Bot-API
failure → silent skip; the webhook's truthful stale-branch remains the
safety net.

### 1.3 Regression tests (the money path, real router + real service + pglite)

`telegram-webhook-topup-money-path.test.ts` extended 13→22 cases:
truthful stale verdicts (approved/rejected/legacy), replay after
commit, double-tap after commit (exactly one credit, truthful second
answer), the concurrent race window via the repo's documented
`tx-interleave` harness (B2-02 idiom — `Promise.all` is sequential-only
under pglite), answer-before-edit ordering (the latency contract),
edit-failure isolation with money intact, ServiceError passthrough
including the duplicate-reference verdict.
`telegram-cards-settlement.test.ts` (new, 4 cases): website-approval
settlement end-to-end (identity captured → card stamped + keyboard
stripped → key claimed → second settle a no-op), reject parity,
Redis-absent no-op, no premature settlement. Sibling batteries
(telegram-webhook, audit-row, referral-gate, csrf, wallet-topups-card,
topup services): 126/126 green.

## 2. Website notifications (Priority Three — four confirmed defects closed)

Evidence-based scope from a read-only parallel investigation (Agent
C+D) — every defect carried file:line evidence; no speculative rewrites:

1. **The bell's false-empty states** (`NotificationBell.tsx`): the
   panel body now rides a loading/ok/error tri-state — a first-load or
   outage previously rendered «لا توجد إشعارات»; the error state
   carries a 44px retry; later poll failures keep the stale rows
   (silent reconcile). The doc comment's socket-primacy claim was
   corrected (the storefront socket exists only on order-detail/wallet
   — the 60 s visible-tab poll is primary elsewhere).
2. **The frozen `/notifications` page**: a 60 s refetchInterval
   (react-query's foreground gating) + a NOTIFICATION_NEW_EVENT
   listener (immediate refetch when a socket-bearing page is mounted
   in the tab) + the family joined the reconnect-resync set. Users
   previously saw new rows only on remount.
3. **The admin alert toast poller race** (`pages/admin/layout.tsx`):
   in-flight guard + stable `admin-alert-<id>` toast ids + the >50-cap
   gap closed (a full `/new?since=` page loops — bounded 5 pages — so
   `sn_last_alert_id` only advances past alerts the operator was
   shown).
4. **The reconnect badge gap**: `admin-alerts` +
   `admin-alerts-unread-count` joined the admin resync set (the badge
   previously lagged up to the 5-minute fallback after a reconnect).

Deferred with rationale: the customer `/unread-count` endpoint — the
badge visually caps at «9+», so the defect is observable only for
users with ≤9 unread whose older unread rows fell outside the bell's
40-row window; it requires the openapi.yaml + orval + zod-mirror chain
and is queued for a spec-touching round.

## 3. Design system + coverage (Priority Four)

- **Light-theme derived borders** (`index.css`): the `*-border` tokens
  lightened by +9 in dark (glow toward light); in light, 93%+9 clamped
  to 100% — a pure-white border on a 93% fill over a white card, i.e.
  invisible (the not-found secondary Button). `.light` now overrides
  `--opaque-button-border-intensity: -6`, landing the derived borders
  at L=87 — the theme's own `--border` language (220 13% 87%).
- **`auth-callback.tsx` behavioral coverage** (3 cases): the
  cookie-bounce, the `?auth_error` redirect, the 12 s hang escape —
  the page previously had string-level pins only.

## 4. The gate battery (run fresh on the final tree)

| Gate | Result |
| --- | --- |
| `pnpm lint` | 0 errors / 15 warnings (the R152 baseline held) |
| `pnpm typecheck` (libs + backend + frontend + scripts) | clean |
| Backend vitest (FULL, 4 chunks) | **272 files / 2,516 tests — all passed** (one non-reproducing route flake in run 1; 2× green full re-runs) |
| Frontend vitest (FULL) | **268 files / 2,508 tests — all passed** (2,496 + 12 net-new) |
| Combined | **5,024 tests** |
| OpenAPI↔Express parity | OK — 84 ops |
| ErrorCode sync | OK — 55, both directions |
| Header-param survival | OK — 7/7 |
| `impeccable detect frontend/src/` | **0 advisories** |
| Production build | green — eager **146,715 B gz** (budget 150 KiB; +50 B = the bell tri-state + page listeners) |
| gitleaks / CVE gates | green (CI jobs) |

## 5. Live-production verification (read-only, post-deploy)

- CI: `05fe365` **success**, `ed8d049` **success**.
- `GET /api/healthz` → `{"status":"ok"}`.
- Bundle identity rotated: `index-B9PE4dD0.js` (R152) →
  `index-DEQJT1zY.js` (R153) — production serves this round's build.
- **Guest E2E against production: 52/52 passed** (3.4 min,
  desktop-chromium + mobile-390).

Production was browsed read-only; no account was created, no mutation
attempted, no customer data read beyond public surfaces. The Telegram
approval lifecycle itself is exercised by the real-router test
battery; a live operator tap is owner-gated by design (it moves real
money).

## 6. Negative results and remaining scope (honestly stated)

- **Storefront/admin P0/P1 sweep** (Agent F+G, read-only): no
  reproducible P0/P1 found — checkout idempotency, wallet guards,
  admin confirmation dialogs, token discipline and a11y patterns all
  verified as pinned by tests. The sub-44px default Button sizes are
  the documented deliberate design (money paths override to min-h-11;
  the R116-S2 rule scoped money surfaces) — recorded, not changed.
- **`admin/enrichment.tsx` behavioral tests**: still uncovered (the
  round's other confirmed gap) — deferred with the unread-count item.
- **Owner-gated (unchanged)**: real-device WhatsApp OTP matrix, Coolify
  gateway re-pin verification, live-credential `validate:suite`
  journeys, and the live Telegram operator tap.

## 7. Definition-of-done scorecard

1. Telegram root cause confirmed + fixed — **VERIFIED** (three paths,
   all closed; tests pin each).
2. Double taps / replays / concurrency cannot double-credit —
   **VERIFIED** (guarded UPDATE re-pinned; tx-interleave race test).
3. Accurate operator feedback and message states — **VERIFIED**
   (truthful verdicts; answer-first; card settlement).
4. Telegram send/edit failures observable — **VERIFIED** ({ok:false}
   classification; benign vs real).
5. Website notifications consistent, non-duplicating, actionable —
   **VERIFIED** for the four closed defects; unread-count endpoint
   **DEFERRED** (rationale above).
6. Customer notification history with pagination — **VERIFIED**
   (existed since R128; now fresh while mounted).
7. Admin/storefront improvements — **VERIFIED** (light-theme borders,
   poller hardening, resync gaps); enrichment tests **DEFERRED**.
8. Visual cohesion RTL/themes — **VERIFIED** (design gates + E2E).
9. CI/tests/security green — **VERIFIED** (counts stated; one
   non-reproducing flake disclosed).
10. Commits pushed, CI + production verified — **VERIFIED**
    (`05fe365`, `ed8d049`; bundle rotated; E2E 52/52).
11. Round-close reflects actual code — this report.
