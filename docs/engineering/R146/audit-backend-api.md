# R146 — Backend API surface audit (routes, middlewares, app/server wiring)

Agent: 146-AUD-1 (ponytail-audit-backend-api) · Round: R146 ("the ponytail round") · Mode: READ-ONLY.

**What this part does:** The Express API layer of the storefront — every HTTP
entry point under `backend/src/routes/` (public storefront, user money paths,
admin panel, copilot), the middleware chain in `backend/src/middlewares/`
(auth gates, idempotency, risk blocks, IP resolution, metrics/correlation),
the wiring in `backend/src/app.ts` / `server.ts` / `index.ts`, and the three
contract scripts that pin this layer to the OpenAPI spec
(`scripts/check-openapi-routes.ts`, `check-openapi-header-params.ts`,
`check-error-code-sync.ts`).

**Load assumed:** a real public storefront (subnation.ly) with concurrent
anonymous + logged-in customers, real money (wallet topups, checkout,
refunds, loyalty conversion), one API process + one background worker,
Postgres (Neon) behind Traefik/Cloudflare. Judged against that scale.

**Method note:** this layer has been through ~20 prior audit rounds
(R92–R145). I read the money/auth/admin surfaces end to end (request in →
validation → service/DB → response out), checked the closed items in
`docs/engineering/R143/findings-ledger.md` and
`docs/engineering/R145/defect-map.md` so nothing closed there is re-reported,
and hunted only for NEW defects. Files read in full or in large part: all 17
top-level route files, 16 of 24 admin route files (incl. copilot ask/draft/
previews), all 11 middlewares, app.ts, server.ts, index.ts, worker.ts (skim),
lib/csrf.ts, lib/rate-limits.ts, lib/http.ts, lib/auth-activity.ts,
lib/idempotency.ts (+retention job), and the three contract scripts.

The checked-and-clean list (no findings, verified this round): checkout
failure mapping (compile-time exhaustive), topup dedup battery + advisory
lock, refund guards (terminal refunded / purchase-only completed), CSRF
origin gate (fail-closed + boot assertion), admin login lockout layers +
dummy-argon2 timing parity, 2FA temp-token rejection at every verifier,
RBAC path-scoped gates + subset-bounded grants + per-request permission
reload, Cloudflare-aware IP validation, CWV cardinality + session caps,
Telegram webhook secret + allowlist, metrics auth, pagination/deep-offset
clamps everywhere, no-store discipline on every authed surface, the OpenAPI
route/header/error-code sync gates.

---

## Must fix

None found. The money and auth paths in this layer held up under a full
end-to-end read: every checkout/topup/refund write is transactional,
idempotent (Redis fast layer + durable in-tx claim), status-guarded, and
scope-gated; every auth mint is cookie-only, session-row-revocable, and
fail-closed on legacy tokens in production.

## Should fix

1. **Google logins leave no trace in the auth-activity audit surface**
   (`backend/src/routes/auth.ts:516-677`)
   - **What this is:** `POST /api/auth/firebase/session` is the primary
     Google sign-in / register endpoint (WhatsApp and Telegram are the other
     two providers). Every provider's mint path writes an `auth_activity`
     row via `logAuthActivity` — except this one.
   - **Problem:** The route mints the session and fires
     `scoreEventFireAndForget("login_success")`, but that risk event is gated
     on `RISK_PIPELINE_ENABLED`, which is unset in production. So the admin
     security surfaces that read `auth_activity` —
     `GET /api/admin/auth-activity`, `/auth-stats`, `/auth-stats/summary`
     (`routes/admin/security.ts`) — and the `auth_outcomes_total{method=
     "firebase"}` Prometheus counter never see a real Google login or
     register. They only see the silent `/firebase/refresh` rotation
     (`auth.ts:693`), which does log. Concrete case: an operator reviewing
     the security tab during a suspected takeover of a Google-linked account
     finds zero login rows for it, while a WhatsApp login of the same account
     would be fully visible. The twin test suites confirm the asymmetry:
     `auth-firebase-refresh.test.ts` pins auth_activity rows;
     `auth-firebase-session.test.ts` has no auth_activity coverage at all.
   - **Fix:** One `logAuthActivity` call in the success path (action
     `"register"` when `result.isNewUser`, else `"login"`; provider
     `"firebase"`; identifier `result.user.phone || firebase uid`; clientInfo
     from `getClientInfo(req)`), plus a failure row in the
     `FirebaseAuthError` catch — the exact shape the refresh twin uses.
     ~10 lines.
   - **If we skip it:** the admin security page stays blind to an entire
     provider's logins; incident reviews on Google-linked accounts have no
     login trail to consult.

2. **`requireCopilotPermission` middleware is dead code, and the
   refusal-audit contract it implements never fires**
   (`backend/src/middlewares/requireCopilotPermission.ts:24-60`)
   - **What this is:** A scope-gate middleware whose doc comment (and spec
     `specs/010-ai-admin-copilot/tasks.md` T027/T146) says every copilot
     route mounts it, and that an out-of-scope refusal must write a
     `copilot_actions` row with `outcome="refused"` BEFORE the 403.
   - **Problem:** Zero call sites. A repo-wide grep finds only `hasScope`
     imported (copilot/settings.ts, services/copilot/tools/read.ts) — the
     `requireCopilotPermission` factory itself is never mounted on any
     route. The actual scope enforcement lives in-handler
     (`ask.ts:174-184` tools.length===0 → 403; `draft.ts:83-88` → 403), and
     those inline 403s write NO copilot_actions row. Concrete case: a
     scoped admin probes `POST /api/admin/copilot/ask` with out-of-scope
     intents — each gets the 403, and the forensic trail the spec demanded
     ("refused intents are forensically reconcilable") does not exist.
   - **Fix:** Either mount the middleware on the copilot routes as designed,
     or delete the factory (~37 lines) and have the two inline 403s write
     the `copilot_actions` refusal row directly. Pick one; today the code
     implies a control that is not actually in place.
   - **If we skip it:** ~37 dead lines that mislead the next reader into
     believing a gate exists, and no audit trail for copilot scope probing.

3. **`x-correlation-id` header flows unbounded into varchar(64) columns —
   500s the copilot draft path after the LLM call already ran**
   (`backend/src/routes/admin/copilot/ask.ts:157-159`,
   `draft.ts:72-74`, `draft.ts:255-267`)
   - **What this is:** Both copilot entry routes read the raw
     `x-correlation-id` header with no length bound and thread it into
     `copilot_actions.correlation_id` / `copilot_previews.correlation_id`
     — both `varchar(64)` (`shared/db/src/schema/copilot_actions.ts:79`,
     `copilot_previews.ts:71`).
   - **Problem:** Concrete case: an authenticated admin sends
     `POST /api/admin/copilot/draft` with a 100-char `x-correlation-id`
     header and a valid draft intent → the LLM round-trip completes (tokens
     spent) → `createPreview` insert (`draft.ts:255`, not wrapped in
     try/catch) throws SQLSTATE 22001 → the route answers a raw 500 and the
     preview is lost. Same shape at `draft.ts:144` (`recordNonExecute`) and
     in the never-mounted middleware (`requireCopilotPermission.ts:48`).
     This is the exact B2-F3 "column-aligned bound" class the repo fixed on
     every other column (wallet sender_account, admin display_name, product
     fields); the copilot family was missed. The shipped frontend never
     sends the header, so only a hand-crafted admin request hits it — which
     is why it has never fired in production.
   - **Fix:** `slice(0, 64)` where the header is extracted in ask.ts and
     draft.ts (and requireCopilotPermission.ts if it survives finding 2).
     Three one-liners.
   - **If we skip it:** a self-inflicted 500 + a lost LLM round-trip on a
     diagnostic header; the 500 also lands in Sentry as noise.

## Nice to have

4. **`lastActive` in `GET /api/auth/sessions` is always the login time**
   (`backend/src/routes/auth.ts:830`)
   - **What this is:** The devices list (`/api/auth/sessions`) returns
     `lastActive: r.createdAt?.toISOString()`.
   - **Problem:** The `sessions` table has no activity column
     (`shared/db/src/schema/sessions.ts`), so "last active" is always the
     session's creation time. The UI renders it as activity:
     `SessionManager.tsx:184` shows «آخر نشاط: …». Concrete case: a device
     used daily for a month shows "last active: a month ago" — the user
     concludes their session list is broken (or that a stale device is
     "the active one" and revokes the wrong one).
   - **Fix:** Drop the field and the «آخر نشاط» label (it duplicates
     `created_at` two rows up), or stop displaying it. Do not keep a field
     whose name promises data the system does not track.
   - **If we skip it:** a small standing lie on a security-adjacent page.

5. **The R122 legacy-hash transition window in the idempotency middleware
   expired long ago** (`backend/src/middlewares/idempotency.ts:129-145, 289`)
   - **What this is:** The Redis replay check compares the incoming body's
     canonical hash AND a legacy order-sensitive hash
     (`legacyBodyHash`), so claims cached by a pre-R122 deploy still replay.
   - **Problem:** The Redis cache TTL is 24h (durable table 48h,
     `jobs/idempotency-retention.ts:17`) and R122 shipped ~24 rounds ago —
     no pre-R122 claim can still exist, so the second comparison can never
     match anything. ~15 dead lines (the helper + the comparison + its pin
     in `idempotency.test.ts`).
   - **Fix:** Delete `legacyBodyHash` and the `|| cached.hash !== legacy...`
     arm of the check, plus the pinning test case.
   - **If we skip it:** every future reader re-derives the transition-window
     story to decide whether it still matters.

---

- **Verdict:** healthy — this is the most hardened layer in the repo (dual
  idempotency on money writes, compile-time-exhaustive failure mapping,
  fail-closed CSRF/auth posture); fix #1 first — the primary Google login
  path is invisible to the admin security surfaces that exist exactly to
  show it.
- **Lean:** −~50 lines, −0 dependencies possible (findings 2, 4, 5).
- **Not checked:** services' internals beyond what the routes call into
  (checkout/refund/topup/adjustment/whatsapp-otp/telegram-auth service
  bodies, copilot llm-client/executor internals, socket.io wiring, jobs,
  worker scheduling — presumably other R146 agents' domains); the admin
  copilot `previews.ts` double-confirm executor beyond the ownership/phase
  gates (read to line ~210); `admin/forecast.ts`, `admin/product-variants.ts`,
  `admin/pricing-calculator.ts`, `admin/observability.ts`, `seo.ts` sitemap
  half, and `auth-settings.ts` admin PATCH half were skimmed (mount/auth
  gates + body validation verified, handlers not read line by line); no
  tests were run (read-only round — the orchestrator runs gates).
