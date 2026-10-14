# Lane L6 findings — R143 (Backend APIs & domain logic)

Audit: R143-L6 @ 528ef39 (read-only; no modifications, no commits, no
production calls). Scope: the Express API surface — route inventory
(~150 route registrations across `backend/src/routes/**`), middleware
chain, external-call timeouts, pagination, response-shape contracts,
concurrency/duplicate handling, service boundaries, Socket.IO
authorization, worker/scheduler paths in the API process, plus
verification of R142 D-3 and C-1.

Method: line-read of the middleware/error/rate-limit/socket/idempotency
cores + every user-facing route file (auth, wallet, loyalty, orders,
support, notifications, cart, coupons, products) + targeted reads of
admin routers (index composition, orders, users, products, alerts,
tickets); import-graph cycle scan over all non-test backend files;
targeted vitest re-runs (notifications + socket-auth: 52/52 green).

---

## R142 fix verification

- **D-3 — VERIFIED (wrapper) / PARTIAL (site threading).**
  `SHARED_ADMIN_TIMEOUT_MS` exists and is partial-mock-proof
  (`frontend/src/lib/admin-session.ts:62-70`), and `adminFetch` now
  threads `signal: init?.signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined)`
  (`admin-session.ts:242-246`) — every `adminFetchJson` call site
  inherits the 20 s budget, with the documented SSE exemption
  (`timeoutMs: 0`) live in `CopilotPanel.tsx:429`. **However** the
  "~8 bare `fetch(` call sites" D-3 itself enumerated were never
  threaded or migrated — see L6-2 (two of them are money mutations).
- **C-1 — PARTIAL (PDP fixed; support pages NOT fixed).**
  The PDP coupon validator rides the generated client
  (`frontend/src/pages/product.tsx:447` — `validateCouponApi(...)` via
  customFetch's 20 s budget, comment "C-1 (R142): the raw fetch carried
  NO abort…"). But `frontend/src/pages/support.tsx:202-208` (handleCreate)
  and `:235-241` (handleReply) — the two call sites named in C-1 — still
  ride a raw `fetch` with NO timeout and an UNGUARDED
  `const d = await res.json();` (`support.tsx:207`, `:240`). The R142
  implementation commit `2df0a62` touched `frontend/src/pages/product.tsx`
  but **not** `support.tsx` (git log: support.tsx last touched at `3ba4ef1`
  = R140), despite the commit message and
  `docs/engineering/R142/lanes/IMPL-wave-report.md:19` ("pages/product.tsx,
  **support pages**") both claiming the support half landed. → L6-1.

---

## Findings

### L6-1 · P3 · C-1's support-page half never landed: ticket create/reply still raw-fetch, no timeout, unguarded `r.json()`

- **Evidence:** `frontend/src/pages/support.tsx:202-208` —
  `const res = await fetch("/api/support/tickets", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(form) }); const d = await res.json();`
  and the identical twin at `:235-241`
  (`fetch(\`/api/support/tickets/${selectedTicket.id}/reply\`, …)` / `:240`).
  No `signal`, no `AbortSignal.timeout`, no `.json().catch(() => null)`
  (the sibling loaders `openTicket:93` and `refreshOpenTicketSilently:138`
  DO carry the guarded-parse idiom — only the two writers don't).
- **Root cause:** the R142 C-1 fix shipped only the product.tsx site;
  the support.tsx sites named in the same finding were reported as done
  (IMPL-wave-report.md:19, commit 2df0a62 message "C-1 PDP/support
  client") but the file was never edited. Ledger claims "All FIX-R142
  dispositions… IMPLEMENTED and verified green".
- **Concrete case:** (1) a stalled Libyan mobile link keeps
  `submitting`/`sending` armed until the browser's ~300 s TCP timeout —
  the submit button spins for minutes exactly like the G-1/D-3 class;
  (2) a proxy 502 answering HTML makes `await res.json()` throw
  `SyntaxError: Unexpected token '<'` BEFORE the `!res.ok` check, and
  the catch renders `err.message` (`support.tsx:217`, `:248`) — English
  stack text inside the Arabic-only destructive toast.
- **Proposed fix:** the C-1 minimal fix verbatim, three call sites →
  two here: pass `AbortSignal.timeout(20_000)` (or migrate to the
  generated client) and use
  `const d = await res.json().catch(() => null); if (!res.ok || !d?.error === false…) throw…`
  — i.e. the repo's own NotificationBell/orders hardening idiom.
- **Test requirement:** no test mocks a hanging or non-JSON
  `/api/support/tickets` response (grep of support-* suites: zero hits)
  — add one pin per C-1's missing-test #2.
- **Risk if skipped:** money-adjacent support surface keeps the exact
  defect class R142 claimed closed; the ledger's "verified green" claim
  is falsifiable by any operator on a flaky link.

### L6-2 · P3 · D-3's site-level residual: the enumerated admin raw-fetch sites (incl. two money mutations) remain un-timed

- **Evidence (every site, HEAD):**
  `pages/admin/users.tsx:427` — the wallet/points PATCH:
  `const res = await fetch(\`/api/admin/users/${editingUser.id}\`, { method: "PATCH", headers: withIdempotencyKey(jsonHeaders, intentKey), body: JSON.stringify(body) });`
  (no signal);
  `pages/admin/orders.tsx:377` — the bulk-status/bulk-refund PATCH:
  `const r = await fetch("/api/admin/orders/bulk-status", { method: "PATCH", headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()), … });`
  (no signal);
  plus `orders.tsx:134` (credentials GET), `products.tsx:530` / `:585`
  (bulk DELETE/PATCH), `promotions.tsx:214` (flash-sale PATCH),
  `login.tsx:65` / `:151` (probe + verify-2fa), `system.tsx:91` / `:116`
  (healthz GETs) — all bare `fetch(`, all without `signal`.
- **Root cause:** D-3's implemented scope was the shared-wrapper
  one-fix only (`admin-session.ts` + the SSE exemption); the proposal's
  second half ("then thread `AbortSignal.timeout(20_000)` into the ~8
  bare `fetch(` call sites listed above (or migrate them to
  adminFetchJson)") never executed — the R142 ledger row closed on the
  wrapper alone.
- **Concrete case:** operator taps «تنفيذ التعديل» on a wallet
  adjustment over a dead NAT link → `setSaving(true)` stays armed and
  `dismissable={!saving}` traps the modal for the browser's ~300 s
  worst case (the intent key keeps the money safe on retry; the UX is
  the casualty — D-3's own words, still true at these sites).
- **Proposed fix:** thread `signal: AbortSignal.timeout(20_000)` into
  the ~9 sites (or migrate to `adminFetchJson` where the shape allows —
  `orders.tsx:377` and `users.tsx:427` already parse envelopes the
  wrapper's way).
- **Test requirement:** extend `custom-fetch-network.test.ts`-style
  pinning to one admin page (users wallet save) asserting the abort
  fires; or at minimum a lint/grep CI gate forbidding bare `fetch(` in
  `pages/admin/**` (the same shape the repo used for the N-1
  header-survival gate).
- **Risk if skipped:** the operator-side hang class D-3 documented
  persists on the two money buttons it specifically called out.

### L6-3 · P3 · The two Firebase login endpoints await `verifyIdToken` with no timeout — the last unbounded external call in the request path

- **Evidence:** `backend/src/routes/auth.ts:544` —
  `const decoded = await verifyFirebaseIdToken(id_token, true);`
  (POST /api/auth/firebase/session) and `routes/auth.ts:690` (POST
  /api/auth/firebase/refresh); the service call itself is a bare SDK
  await: `services/firebase-auth.service.ts:207` —
  `return await auth.verifyIdToken(idToken, checkRevoked);`
  (with `checkRevoked=true` this makes a network revocation round-trip
  to Google; no AbortSignal, no Promise.race anywhere in the chain —
  grep of `AbortSignal|signal` over services/: only alerting, copilot
  and openwa carry one).
- **Root cause:** the hang-class hardening rounds (R93 R1/R2 for Redis,
  R93 R4 for the DB statement_timeout, telegram 5 s/10 s, openwa 8 s,
  alerting 10 s, copilot 60 s/90 s) never reached firebase-admin.
- **Concrete case:** a network partition that black-holes
  `googleapis.com` while leaving Postgres/Redis healthy (asymmetric
  egress filter, DNS poisoning, Google-side incident) leaves both
  credential-minting endpoints pending on the SDK's internal retry
  budget; the storefront login button spins, and because these POSTs
  ride `authLimiter` (10/15 min) each stalled attempt also burns a
  login budget slot for minutes.
- **Proposed fix:** wrap `auth.verifyIdToken` in a
  `withRedisCommandTimeout`-style race (e.g. 10 s) inside
  `verifyFirebaseIdToken`; on timeout throw the existing
  `FirebaseAuthError` with a 503/Arabic-network message so the login UI
  renders its outage card instead of spinning.
- **Test requirement:** one unit test asserting the race rejects and
  maps to the Arabic service-error envelope (mirror
  `redis-client-resilience.test.ts`).
- **Risk if skipped:** the one external dependency whose stall is not
  converted to a fast failure — the exact class the R142 robustness
  theme was closing.

### L6-4 · P4 · N-5 persists as deferred: GET /notifications is still dual-shape and the OpenAPI spec still documents only the array arm

- **Evidence:** `backend/src/routes/notifications.ts:52-63` —
  `if (queryString(req, "page") === "") { … .limit(BELL_PAGE_LIMIT); return res.json(rows.map(toNotificationDto)); }`
  (array arm, ≤40) vs `:86-92` — the envelope arm
  `res.json({ notifications: …, total, page, limit, hasMore })`.
  Spec: `shared/api-spec/openapi.yaml:1887-1900` —
  `summary: List the current user's notifications (≤40, newest first)`
  with a single `type: array` 200 schema; the `?page=` envelope has no
  spec arm.
- **Fresh assessment:** materially better than at R142 filing — both
  arms are now clamped (bell 40; paged `MAX_PAGE_LIMIT 100`,
  `MAX_PAGE` deep-offset ceiling via `pageParam`), ownership-scoped,
  no-store, and pinned by a 12-test suite (re-run green at HEAD); the
  paged consumer (`pages/notifications.tsx:104`) deliberately bypasses
  the generated client with a documented shape guard
  (`:119-124`). The deferral rationale (spec churn → orval regen risk)
  is unchanged and still recorded.
- **Proposed fix (when spec churn is affordable):** document both 200
  arms (oneOf) or split the paged shape into a distinct operationId;
  regen the client and retire the page's raw fetch.
- **Risk if skipped:** the documented-contract drift class only — no
  runtime consumer is wrong today.

### L6-5 · P4 · User-side raw-fetch family (non-admin) never adopted the 20 s timeout contract

- **Evidence:** `pages/notifications.tsx:104` (list, react-query signal
  only), `:167` / `:190` (markRead / read-all POSTs — no signal, no
  timeout), `pages/support.tsx:71` / `:92` / `:135` / `:202` / `:235`,
  `pages/orders.tsx:223`, `pages/profile.tsx:162` / `:212`,
  `pages/onboarding.tsx:65`, `pages/cart.tsx:140`,
  `pages/telegram-callback.tsx:151`. React Query's `signal` aborts on
  unmount/cancel — it does NOT bound a stalled network (no timeout by
  default), so `useInfiniteQuery` page loads on a dead link sit in
  `isFetchingNextPage` indefinitely.
- **Root cause:** the G-1/D-3/C-1 fixes were scoped to the money CTAs
  and the admin wrapper; the non-money user surfaces kept the raw-fetch
  idiom (most — not all — carry the guarded `.json().catch(() => null)`
  parse; support's two writers don't, L6-1).
- **Proposed fix:** opportunistic — on each touched page, either adopt
  the generated client or add `signal: AbortSignal.timeout(20_000)`
  composed with the react-query signal (`Signal.any`-style composition
  as used in `lib/auth.tsx:94`).
- **Risk if skipped:** minutes-long spinners on stalled links for
  read-mostly surfaces; read-state POSTs have optimistic rollback so no
  data hazard.

### L6-6 · P4 · GET /api/support/tickets and the ticket-detail reply list are capped but unpaginated

- **Evidence:** `backend/src/routes/support.ts:48-53` —
  `.orderBy(desc(supportTicketsTable.createdAt)).limit(200);` with no
  `?page=`/offset (rows 201+ unreachable — the exact gap R120-B6/A6-F1
  closed for orders/topups/ledgers and R122 A3-P2-1 for referrals);
  `:179-183` — the detail route returns ALL replies
  (`select().from(ticketRepliesTable).where(eq(ticketId, id))` — no
  LIMIT).
- **Mitigation in place:** `ticketCreateLimiter` 5/hour/user
  (`:106-115`) and `ticketReplyLimiter` 30/hour/user (`:206-214`) bound
  organic growth, so the array size grows slowly and the realistic
  ceiling is a years-old very-active account.
- **Proposed fix:** the R120 `?page=` idiom on the list (default page=1
  byte-identical) and a `.limit(500)` + `has_more` hint (or page param)
  on replies.
- **Risk if skipped:** a support power-user's oldest tickets become
  unreachable via API; response payloads grow linearly with thread age.

### L6-7 · P4 · Admin products list is hard-capped at 200 with no page param

- **Evidence:** `backend/src/routes/admin/products.ts:132-133` —
  `.orderBy(desc(productsTable.createdAt)).limit(200);` — no offset;
  every sibling admin table (users :58, orders :244, topups :103,
  tickets :85, audit-logs :153, alerts via parsePagination) is
  paginated.
- **Root cause:** the R120/R122 pagination sweep predates the admin
  products route shape; catalog growth is currently well under 200 so
  the cap is invisible.
- **Proposed fix:** the shared `pageParam` idiom, default page=1.
- **Risk if skipped:** once the active catalog passes 200, the oldest
  products become admin-invisible except via search.

### L6-8 · P4 · Admin observability `GET /metrics` renders the full Prometheus registry through res.json on a 15–90 s poll

- **Evidence:** `backend/src/routes/admin/observability.ts:171-193` —
  the handler awaits the registry text (default Prom text format via
  `getRegistry().metrics()`) and re-serializes; polled by the System tab
  alongside `/summary`, `/alerts/recent`, `/scheduler`. (The dedicated
  `/api/metrics` route (`routes/metrics.ts:115`) requires
  `requireMetricsAuth` and is operator-only.)
- **Note:** payloads are bounded by metric cardinality (low, fixed
  label sets — verified in `lib/metrics.ts` registration sites) and the
  pino-http autoLogging ignore list already silences these paths; this
  is a lean observation (JSON-wrapping the text format doubles the
  serialization cost), not a defect. No action required; recorded so a
  future cardinality addition knows the poll cadence it will ride.

---

## Verified clean (evidence, not assurance)

- **Middleware chain (app.ts:71-328):** order is coherent and
  documented — helmet/permissions-policy → compression → CORS
  origin-gate/credentials/cors → cloudflareClientIp → correlation →
  instrumentation-isolation → pino-http (reqId = correlation id;
  autoLogging ignores healthz/cwv/admin-observability) → metrics →
  cookieParser → `express.json({limit:"1mb"})` + urlencoded 1mb →
  bodyParserRecovery (SyntaxError → clean 400, no Sentry capture) →
  CSRF gate (SEC-92-01 boot assertion) → path-specific limiters
  (auth/whatsapp-start/coupon/money-intent) mounted BEFORE the generic
  /api pair → router → JSON 404 fallback with no-store → SPA shell →
  Sentry handler → globalErrorHandler. Limiter double-mount class
  (98-F3) is documented and pinned by `limiter-composition.test.ts`.
- **Error contract:** one envelope factory (`createErrorResponse`) +
  one global handler (`lib/error-handler.ts:40-88`: body-SyntaxError →
  400 INVALID_DATA; ZodError → 400 with minimal `{path,code}` issues;
  `.errors`-array → 400 count; else 500 INTERNAL_ERROR — never leaks
  internals). Deviations are deliberate and documented: telegram
  webhook `{ok:false}` (retry semantics, routes/telegram-webhook.ts:237-242),
  idempotency 409s (`{success,error,message,code}` — kept for legacy
  clients), copilot debug 500 (settings.ts:101-109 documents the
  exception). Every route 400/401/403/404/409 spot-checked uses the
  factory.
- **Input validation:** money/body routes all gate via shared zod
  contracts (`CreateOrderBody`, `CreateTopupBody`,
  `ValidateCouponBody`, `CreateTicketBody`…) or strict hand-rolled
  equivalents (cart.ts:186-205 integer/quantity guards; loyalty
  convert-points `Number.isInteger`/`/^\d{1,9}$/` gate loyalty.ts:143-176;
  admin bulk-status array+cap+enum orders.ts(admin):422-461;
  set-count bounds products.ts(admin):565-575). `intParam`
  digit-exactness is repo-wide (intparam-strict.test.ts).
- **Timeouts (the R142 hang-class roster):** DB — pool
  `statement_timeout` 15 s default + post-connect `SET` (pinned by
  db-statement-timeout.test.ts); Redis — 500 ms command / 8 s boot /
  isReady gating (redis-client.ts:69-134); Telegram — 5 s per attempt
  (telegram.ts:423) + 10 s gateway (telegram-gateway.ts:15-29) +
  alerting 10 s with 5 s retry (alerting.service.ts:757); OpenWA —
  `REQUEST_TIMEOUT_MS 8_000` on every gatewayFetch
  (openwa/gateway-client.ts:130-148); copilot — 60 s fetch + 90 s
  shared deadline (copilot/llm-client.ts:134-218). The only gap is
  L6-3 (Firebase).
- **Pagination:** user-side list surfaces are all clamped+paged —
  orders (`limitParam`+`pageParam`, orders.ts:126-127), wallet topups
  (page ×200, wallet.ts:163), wallet ledger (page+limit ≤200,
  wallet.ts:193-201), loyalty ledger (loyalty.ts:356-364), referrals
  (page ×200, loyalty.ts:396), notifications (both arms, above),
  sessions E-5 limit(200) (auth.ts:810-815). Admin tables paginated
  except products (L6-7). Bell capped at 40.
- **Concurrency / duplicates:** Redis idempotency middleware with
  in-flight sentinel + `SET NX` claim, both-sides 409 enforcement,
  legacy-hash transition window, 128-char key cap, credential redaction
  of cached bodies, bounded ops (middlewares/idempotency.ts:186-393);
  durable in-tx idempotency claims back the Redis pass-through window
  (wallet/topups/loyalty/checkout service layers, pinned by
  wallet-topups-durable-idempotency, loyalty-durable-idempotency,
  checkout-idempotency suites). Checkout claims inventory with
  `FOR UPDATE SKIP LOCKED` inside one transaction
  (checkout.service.ts:340-435). No `req.on("close")` anywhere — client
  disconnect mid-write never aborts a transaction (correct posture for
  money: the write completes, the idempotency layer replays the
  response on retry).
- **Service boundaries:** import-graph cycle scan over all 260+
  non-test backend files: **0 cycles** (≤6 hops). No route imports a
  route (grep: zero hits). No god module — largest file is
  alerting.service.ts at 1,078 lines; the R136/R137 decompositions
  (app.ts, lib/socket, spa-shell, catalog) hold. Layering is clean:
  routes → services → lib/db.
- **Socket.IO authorization (lib/socket.ts:151-493):** handshake =
  per-IP cap pre-check → origin allowlist → JWT verification → DB
  liveness (revoked sessions/soft-disabled admins rejected at
  handshake), 5-min periodic re-verify, server-driven room joins
  (client-emitted `join-user`/`join-admin` are identity-checked
  defensive no-ops with forgery logging); scope-gated admin-alerts room
  (support scope, reconciled each re-verify); connection caps 5/IP +
  2000 total with sweep; `maxHttpBufferSize` 64 KB; explicit
  ping/pong/connectTimeout. The server accepts NO application-level
  resource events from clients, so per-event ownership cannot be
  skipped; all outbound emitters target identity-derived rooms.
  Re-verified by `socket-auth.test.ts` (40/40 green at HEAD).
- **Event-loop blocking:** sync `readFileSync` only at module-eval boot
  (env.ts:17, spa-shell.ts:105 — one-time snapshot reads); no
  `pbkdf2Sync`/`scryptSync`/`execSync`; all hash ops are
  microsecond-scale (`createHash` on small strings); no large
  `JSON.parse` in request paths (body capped at 1 MB; cwv carries its
  own parser, routes/cwv.ts:187). Worker/scheduler in the API process:
  leader election (Redis or PG lease, SINGLE_INSTANCE_MODE bypass),
  no interval timers since the 2026-09-20 round (opportunistic
  traffic-triggered sweeps only), fire-and-forget discipline with the
  R142 L-2 hung-run floor verified present
  (lib/opportunistic.ts:66-123 — `HUNG_RUN_FLOOR_MS` + entry-capture).
- **R142 spot-verifications beyond mandate:** E-5 sessions LIMIT(200)
  present (auth.ts:815); L-2 fireThrottledMaintenance bounded
  (opportunistic.ts:66,88-107); G-1 loyalty convert rides
  `convertPointsApi` via customFetch (loyalty.tsx:245-253).

## Not checked / limits

- Full-suite runs were not repeated (mandate: targeted vitest only;
  52/52 tests green across the two suites re-run).
- The copilot subtree beyond the ask/authz surface (executor tools,
  draft store) was verified structurally (imports, phase gates,
  rate-limit mount) — the R142 E-1 single-use claim regression suite
  was not re-run.
- Frontend route-tree/SPA concerns belong to FE lanes; only the
  API-boundary call sites (fetch idioms) were audited here.
- checkout.service.ts's 961 lines were read at the transaction/
  claim/idempotency core, not line-by-line — the money suite
  (M1–M17, per the R142 ledger) owns that verification.
