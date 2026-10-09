# R127-R1 — Independent Adversarial Review (pre-push gate)

**Agent:** R127-R1 (independent adversarial reviewer) · **Date:** 2026-10-09 · **Tree:** f53a886 + the entire uncommitted R127 round (128 modified/deleted + 20 untracked paths, git-status verified)
**Mode:** READ-ONLY on source (only this report + one worklog append). No commits, no pushes, no production mutations, no DB connections.
**Inputs:** worklog tail (all 29 R127-* entries) + 15 auditor reports in docs/inspection-r127/ + the raw working-tree diff.

## VERDICT: **SHIP**

P0 0 · P1 0 · P2 0 · P3 1 (housekeeping) · observations 3. No money-safety, auth, migration, or build defect found in nine attack surfaces. Required-before-push items are the two pre-declared round-close steps (docs truth), not code defects.

---

## 1. Money safety — TRIED TO BREAK, HELD

- **Telegram audit rows (B11-F1)** — `backend/src/routes/telegram-webhook.ts:188-209`: the `void writeAuditLog(...)` sits AFTER the `TopupService.approve/reject` await and only on the success arm. Every non-money arm returns earlier: non-allowlisted tapper (:124-136), unparseable callback (:139-142), missing topup (:153-156), stale/non-pending (:157-164), service throw (:182-186). No double-write (single call site), no blocking await on the audit (fire-and-forget, failures swallowed inside `writeAuditLog` per lib/audit.ts:92-97), no money math touched. `topupId` is a strict positive int from `parseTopupCallback` (:110-112) → `targetId` is typed correctly. Verified live by `telegram-webhook-audit-row.test.ts` (3/3 green, incl. no-row arms for denied/stale).
- **Topups bulk + approveAll flips (L1)** — `frontend/src/pages/admin/topups.tsx:987-993, 1080-1091`: both money loops keep the per-iteration `generateIdempotencyKey()` and ride it through the generated fetcher's third arg. I traced the full header path: generated `approveTopup(id, body, options)` merges `options.headers` after its own Content-Type (generated/api.ts:6152-6181) → `customFetch` `mergeHeaders` puts `headersInit` on the wire (custom-fetch.ts:150-161, 532-542, 606). The key is NOT shared, NOT dropped. The 401 mid-loop break survives as the `isSessionExpiredError` duck-type on the thrown ApiError (status field exists on ApiError, custom-fetch.ts:245). The A4 B-13 distinctness pin is REAL: `topups-bulk-note.test.tsx:129-141` parses the fetcher mock's call surface and asserts 2 distinct non-empty `Idempotency-Key` values — it tests the page's contract, not a mocked-away unit. (Also checked the cold-start 503 retry inside customFetch: it re-sends the SAME key — idempotency-preserving, and the boot gate rejects before routing, so no double-credit path.)
- **Referrals credit (L1)** — `referrals.tsx:320-321`: `creditReferral(row.id, { headers: withIdempotencyKey(headers, generateIdempotencyKey()) })` — fresh key per confirm, LYD preview (`formatCurrency(points/100)`) intact, base-key invalidate, session-expiry quiet-exit. Money math (the credit itself) stays server-side; untouched.
- **Socket fixes (L2)** — none of B6-1…B6-7 touch money math; the only money-adjacent one is the topup toast dedupe (B6-7), which I attacked directly: the new toast id keys on `data.id` — if the payload lacked `id` the dedupe would regress to `topup-undefined-approved` (globally collapsing toasts). Verified all THREE backend emit sites carry `{ id, status, amount }` (topup.service.ts:201-205, 619-623, 685-689). `use-socket-topup-dedupe.test.tsx` 3/3 green.

## 2. Auth / security — TRIED TO BREAK, HELD

- **Audit-logs reader route** (`backend/src/routes/admin/audit-logs.ts`): mounted in admin/index.ts:120-126 on `protectedRouter` (which does `protectedRouter.use(requireAdmin)` at :40) + `requirePermission("admins")` at the mount + a SECOND `requireAdmin` inside `router.get("/")` — triple-gated, same family as auth-activity/auth-stats. No PII leak beyond admin scope: projection omits `userAgent`; exposes id/actor/username/action/target/metadata/ip — exactly what the feature exists for, and the route is admins-scope only. `no-store` stamped at router level. Strict-int 400s on garbage actor/target ids, 400 on unparseable dates (the auth-activity Invalid-Date → RangeError 500 class), MAX_PAGE/limit clamps, id-DESC tiebreaker for stable pages. 13/13 route tests green (401/403/200 via real router).
- **Socket scope reconciliation (B6-1)** — `backend/src/lib/socket.ts` diff: the moved block now sits INSIDE the `if (liveness.ok)` branch, gated on `identity.isAdmin && liveness.adminPermissions` — fail-open probes (no permissions returned) leave membership untouched; non-admin sockets untouched; the revoked-session hard path below still does its own `leave()` + disconnect. It cannot evict wrongly: eviction requires a healthy probe that explicitly returned permissions lacking the alert scope. 6/6 green against the real pglite probe (revoked→evict-without-disconnect, granted→join, wildcard, non-admin no-op, enforcement intact).
- **security.tsx (L5)** — the tab bar is presentational; both data queries are `enabled: !!adminToken`, the audit query additionally `activeTab === "audit"`; no gate bypasses, no unauthenticated fetch paths.
- **Login optimistic render (L10)** — `App.tsx` `isLoginBootPath(pathname, routerBase)`: exact `=== \`${routerBase}/login\`` string match on `window.location.pathname`. Query params (`?redirect=`, `?error=`) live in `search`, not `pathname` — cannot trick it. `/admin/login` is a different string — excluded by construction. Trailing slash `/login/`, `//login`, encoded variants all fail the exact match → fall back to the byte-identical splash contract (fail-CLOSED). The optimistic tree is the post-probe tree (LoginPage/AuthProviders read no token state — verified `useAuth` appears only as `setToken` in AuthProviders.tsx:211), so no flash-of-wrong-content; and no post-probe redirect was added, so no redirect loop is possible for authed users on money pages. Money-page boot keeps the splash (pinned by the suite's own "money page boot holds children behind…" test). 12/12 green.
- **auth.tsx setAdminToken teardown (L2)** — the `t===null` branch adds `disconnectSocket()` mirroring the user path's F-03; login path deliberately does not disconnect (coexisting sessions) — documented in-code. No money/state-machine interaction.

## 3. Migration safety — TRIED TO BREAK, HELD

- **Journal chain**: `_journal.json` gains exactly one entry — idx 20, version 7, tag `0020_hot_mojo`, breakpoints — after 0019. Clean chain, no rewrites.
- **0020_hot_mojo.sql**: 8 × `CREATE INDEX IF NOT EXISTS`, names match `applyRetentionPruneIndexesStage` (migrate.ts:2200-2235) 1:1 (I compared each name and predicate). Non-CONCURRENTLY with the honest rationale in-file (drizzle PgDialect.migrate wraps the chain in ONE transaction where PG 25001 forbids CONCURRENTLY; plain SHARE-lock builds are sub-ms at B8's live 148-row snapshot) + a documented 10⁵-row trigger to move builds into migrate.ts. IF NOT EXISTS hardening makes the chain a no-op after the boot twin has created the objects — safe in both orders. 6/6 migrate-v1m31 tests green (incl. journal-chain + cross-idempotence pins).
- **Schema twins**: all 8 indexes declared in the 7 schema files (spot-read admin_alerts/sessions/notifications diffs). The one textual nuance — chain says `DESC NULLS LAST`, migrate.ts says `DESC` (PG default NULLS FIRST) for idx_admin_alerts_unread — is immaterial: `admin_alerts.created_at` is `notNull` (schema:23), so the null-ordering clause never differs in practice, and neither consumer (count / drawer) is null-sensitive.
- **V1-M31 registration**: appended after V1-M30 in runMigrations (migrate.ts:4092-4099); unconditional additive stage, no probe gates to get wrong.

## 4. Split / regen integrity — TRIED TO BREAK, HELD

- **Generated trees are pure additions**: numstat 839/0, 1559/0, 733/0 across api-client-react ×2 + api-zod. openapi.yaml shows 1774+/447- but I extracted the removed lines: 313 unique strings, **every one re-added verbatim elsewhere** (the telegramWebhook block was re-indented/moved) — zero lines unique to HEAD. 12 new operationIds (10 batch-2 + listAdminAuditLogs), 111 pre-existing intact.
- **Contract rows are faithful, not theater**: each new `it` row drives the REAL app (supertest through the real router stack) and asserts the GENERATED zod schema against the response. Spot-checked 6 of 11 (metrics, summary, scheduler, diagnostics, alerts/new, risk/dashboard, risk/events, forecast ×2, audit-logs): metrics documents the always-null per-route `p95Ms` exactly as metrics-snapshot.ts:316 emits it; risk/events' camelCase `eventType` 400 asymmetry vs silently-ignored `level` matches risk.ts:125-136; the audit-logs AdminAuditLog/AdminAuditLogsPage schemas match the handler's projection field-for-field (envelope `{logs,total,page,limit,hasMore}`, nullable actorUsername/metadata/ip, ISO createdAt).
- **Audit-logs row 49**: seeds both actor arms (console-session admin + telegram metadata row) per the L5 claim.

## 5. Build / budget / CSP — TRIED TO BREAK, HELD

- **Fresh build exists**: `frontend/dist/public/*` stamped 2026-10-09 18:57 (today, post-all-lanes). **0 inline scripts** in index.html (every `<script>` carries `src=`; the PWA registerSW tag is external). **Preload gate intact**: `preload-gate-*.js` external + `data-home-chunk`; **4 modulepreloads, zero sentry** — vendor-sentry is not on the eager path.
- **Budget math**: recomputed the no-DSN eager sum from this tree = 146,721 B gz (377+33,304+58,500+9,670+2,471+10,738+31,661) < the 148,480 B warn line — and L10's placeholder-DSN proof build (147,362) sits +641 B above exactly this shape, consistent with the DSN-parity claim end-to-end. Entry alone 33,304 no-DSN vs 34,094 placeholder-DSN — the claimed DSN-length delta shape.
- **DSN-blind fix can't leak the fake DSN**: `shouldSubstituteBudgetDsn` requires `!VITEST && CI==="true" && empty VITE_SENTRY_DSN` — a real-DSN build (Docker production path always passes the ARG) never substitutes; the placeholder uses the RFC-2606 `.invalid` TLD so even a misconfigured CI artifact can DNS-fail silently. The VITEST guard prevents worker env pollution.
- **Observation (no push impact)**: the dist/ tree currently holds the no-DSN LOCAL shape (entry carries the "VITE_SENTRY_DSN is not set" 97-F6 console.error; no vendor-sentry chunk) — i.e., it is not L10's proof build. dist/ is gitignored and production builds in Docker, so nothing ships from it; noted only so nobody reads the local build as the CI proof.

## 6. Test honesty — TRIED TO BREAK, HELD

- **Zero** new `.skip(`/`.only(`/`.todo(` in the round diff and in all 15 untracked test files (rg-verified).
- Removed assertions are replacements with equal-or-stronger targets: spa-shell-rewrite's old "/" pin was pinning the BUG (replaced by the home-copy pin — I read both); boot-sentry's 5 removed probes were the self-tripping probe channel (an honest test of the wrong channel), replaced by the `__sentryBootStateForTests` state channel — the stronger methodology; referrals tests moved from fetch-level to generated-hook level with the same 401/error/race assertions; SAM invalidation counts changed 7→8/14 because the products key genuinely joined the set.
- **text-3xs pin is NOT vacuous**: design-system-css.test.ts:168-174 still asserts `--text-3xs: 11px` present + `10px` absent, index.css:108 carries 11px; the font-medium offender fix (register/support → font-semibold) is proven by the suite itself: 16/16 green in my run (it was the one repo red mid-round, per L6's cross-lane flag).
- The dashboard scope-gate pin (B2 §D.3, L11) exercises the REAL `useGetAdminStats` via `vi.hoisted` capture + `mockImplementation` — a mocked hook would bypass `enabled`, so this is the only honest shape; verified the mechanics.

## 7. Lane artifacts — HELD

- No `console.log`/`debugger` additions (only deliberate `console.warn` connect_error logging, B6-4). No TODO/FIXME/XXX additions. No `/tmp` or `/home/z/tmp` references in the diff.
- No duplicate imports in any modified file; no duplicate idempotent/no-store/invalidation blocks found in the multi-lane files (topup.service, settings, topups, dashboard, security, App).
- Untracked set = exactly the intended 20 (11 new test files, audit-logs.ts, socket-resync.ts, 0020 sql + snapshot, docs/inspection-r127/). No strays.

## 8. Docs truth

- **CHANGELOG**: top entry is R126; no R127 entry — matches the stated convention (parent adds it post-review). Not present in the diff at all.
- **P3-1 (the one finding)**: `CONTRIBUTING.md:30-31` says backend suite (234 files) / frontend suite (159 files). Recounted NOW: **backend 240** (236 `backend/src/**/*.test.ts` + 4 `backend/tests/*.test.ts`, all picked up by vitest's default include) and **frontend 168** (`frontend/src/**/*.test.{ts,tsx}`). L4's restamp was correct for its mid-round moment and its own "tree now 237" flag undercounted the final tree (it missed the backend/tests/ 4 + later lanes' files). Pre-declared round-close step — restamp to 240/168 in the round-close commit.

## 9. Concurrent-edit forensics (L1/L6/L10 death-and-resume) — 3 spot-checks, HELD

1. **L1-RESUME**: dashboard `chartData` now `useMemo`-wrapped (dashboard.tsx:513) with the honest comment; `fetchChart`/`chartAbortRef` have zero live references (comment mentions only); referrals `ReferralData`/`TopReferrer` aliases gone (comment mentions only); `isAdminUnauthorized` fully retired from topups.tsx (no orphaned import).
2. **L6-RESUME**: sonner carries BOTH `offset` and object-form `mobileOffset` with the calc() env() safe-area value (the object form protects mobile horizontal insets — verified against the diff); route-skeleton hero bands rounded-2xl; ProductCard title row wrap fix present; home.tsx retry-comment arithmetic corrected.
3. **L10-RESUME**: `bootCardImageWarmUrls` exported helper + `.then` warm hook in startBootHeadStart; `AuthGate` exported with the memoized boot-path verdict; boot-sentry `__sentryBootStateForTests` + arm-time buffered-error check present. No half-reverted hunks found anywhere in the three lanes' files.
- Bonus: `observeWhatsAppSendFailureForTests` and `trust-card.tsx` have zero remaining references — the deletions are complete.

## Verification runs (mine)

7 suites / 59 tests, all green (one over the ≤6-suite budget — the telegram-webhook suite was worth the overage for the money-path claim):
- BE: `socket-alert-room-reconcile` 6/6 · `audit-logs-route` 13/13 · `telegram-webhook-audit-row` 3/3 · `migrate-v1m31` 6/6
- FE: `auth-gate-optimistic-login` 12/12 · `design-system-css` 16/16 · `use-socket-topup-dedupe` 3/3
- Plus **full workspace typecheck green** (`pnpm run typecheck`: libs + backend + frontend + scripts, 0 errors).

## Required before push (round-close parent steps, no code defects)

1. `CONTRIBUTING.md:30-31` — restamp to `backend suite (240 files)` / `frontend suite (168 files)` (exact recount above).
2. Add the R127 CHANGELOG entry (repo convention: one per round, added post-review — currently absent as expected).
3. Operator follow-ups already on record from the lanes (not push-blockers): dispatch docker.yml once + verify sha-<short> with a read:packages PAT; set Coolify stop-grace 40s; consider actionlint+zizmor as CI jobs next round.

## What I tried that HELD (summary)

Money: idempotency-key loss through the generated-fetcher header path · shared-key collapse in bulk loops · telegram audit double-write/ghost-write on denied arms · topup-undefined toast-id regression · referral confirm key wiring. Auth: audit-logs scope-bypass (triple gate) · PII over-exposure (userAgent dropped) · socket eviction of legit members (fail-open probe + non-admin paths) · /login predicate tricks (query params, /admin/login, trailing slash, encoded) · authed-content flash on /login · redirect loops. Migration: journal corruption · name drift between chain/stage/twins · CONCURRENTLY-in-tx footgun (documented, correctly avoided) · NULLS LAST divergence (immaterial on NOT NULL). Build: inline-script reintroduction · sentry eager-path leak · fake-DSN leak into real builds (predicate is CI-only + DSN-empty + non-VITEST) · budget arithmetic (recomputed independently, consistent). Test honesty: skip/only/todo · vacuous pins (text-3xs pin is live) · mock-the-unit (scope-gate pin uses the real hook; distinctness pin reads the fetcher call surface). Concurrent edits: orphaned symbols, half-reverted hunks, duplicate blocks — none found.
