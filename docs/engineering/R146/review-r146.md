# R146 round review — ponytail-review (agent 146-REV)

Scope: everything from commit `ae531a7` (the audit-docs commit) to the current
working tree — 88 tracked files (+1387/−1007) plus 14 untracked new files
(`frontend/src/lib/intent-envelope.ts`, `frontend/src/lib/category-registry.ts`,
and twelve test files). Excluded per instructions: `docs/**`, `*.md`, AGENTS.md.
Load assumed: the production shape the repo documents — one web process
(SINGLE_INSTANCE_MODE), an optional dedicated worker, Neon Postgres, Redis
optional (`REDIS_URL` unset in production today). All gates already ran green
on this exact tree (lint 0 errors, typecheck clean, backend 2,518 /
frontend 2,475 tests, contract gates 3/3, build 146,690 B eager, −12 vs R145).

## What this change does:
R146 ran the ponytail method repo-wide: six audit lanes wrote findings, six fix
lanes implemented them, and the orchestrator closed cross-lane leftovers. On
the money/auth side it reads the coupon-maxed signal from the guarded UPDATE's
RETURNing row, catches the Firebase/Telegram first-login double-submit 23505
and returns the winner's row as a normal login, writes auth_activity rows for
the Google session mint, and fixes migrate.ts's encryption pre-filter (legacy
plaintext containing two colons was skipped forever). It also bounds five
unbounded Redis writes, keeps the alerting evaluator on the web process in
every topology, writes the copilot refusal audit row inline before the 403,
and consolidates duplicated frontend code: four intent-key envelopes onto
`lib/intent-envelope.ts`, ten category tables onto `lib/category-registry.ts`,
and three ApiError duck-type reads onto `readApiError`.

## Verified in depth (no findings)
- **checkout.service.ts:646** — `updatedCoupon.usedCount` is the RETURNing
  row's true post-increment value (integer columns, numeric compare); money
  authority (guarded UPDATE) untouched; alert still fires post-commit. New
  interleave test asserts DB `usedCount === 2` AND the alert.
- **intent-envelope.ts + 4 consumers** — delegation is semantically exact:
  same parse/k/t/TTL/fingerprint guard order, same try/catch on every access,
  same `{k,t,f}` persist shape. Slot names, TTL constants (all 10 min) and
  fingerprint builders byte-compared old vs new — identical. Topup keeps
  rotation-only (no clear function before or after; no caller exists).
  The four pages' call sites are unchanged (checkout.tsx/wallet.tsx untouched).
- **auth.ts firebase session** — success + FirebaseAuthError rows mirror the
  `/firebase/refresh` twin exactly (identifier ≤ 255 fits varchar(255));
  sessions `lastActive` dropped end-to-end (route, openapi, both generated
  clients, SessionManager, fixtures — zero remaining consumers).
- **23505 catch-and-reread** — firebase re-reads by `firebase_uid` (the twin
  race's unique key; an unrelated phone/googleId collision returns null and
  rethrows, preserving the old 500); telegram re-reads by `telegram_id` and
  refreshes the identity row with the existing-user path's upsert. Postgres
  blocks the loser's INSERT until the winner commits, so the re-read always
  sees the winner. Loser skips referral/identity side effects — the winner
  owns them, and a crashed winner self-heals on the next login (step-1 path
  upserts the identity). Both race tests exist and were mutation-checked.
- **migrate.ts** — the SQL pre-filter `NOT LIKE 'v2:%' AND !~ '^[0-9a-f]{24}:[0-9a-f]{32}:'`
  excludes exactly the two ciphertext shapes `isEncrypted()` treats as
  ciphertext-at-rest (v2 prefix-only; v1 length-only is looser than the SQL's
  hex form, so the SQL is a strict subset — nothing the JS gate would encrypt
  is excluded, and newly-pulled values round-trip through encrypt/decrypt).
  Admin seed `ON CONFLICT (username) DO NOTHING` matches the sibling seeds;
  the moved "Migrations completed" log sits after the last V1 stage, before
  the fingerprint persist — log-only.
- **category-registry** — every derivation byte-compared against the deleted
  pre-R146 tables (ProductCard accent/icon 9×, rail tiles, admin composites,
  both admin option lists, PDP gradients/initial colors, Navbar order): all
  identical. The new registry test hardcodes the OLD values (I re-checked the
  hardcoded tables against `git show ae531a7:` sources). No eager module
  imports the registry (Navbar uses utils' LIVE_CATEGORY_SLUGS; only lazy
  chunk components import it) — consistent with the measured eager path.
- **copilot ask/draft** — the refusal row is awaited BEFORE the 403 responds;
  `recordNonExecute` never throws (try/catch + warn inside, returns null);
  `correlationId` is bounded to varchar(64). 403 bodies byte-identical.
- **alerting topology** — evaluator starts exactly once in every shape:
  leader/single-instance via `startLeaderJobs()` (guarded by `started`),
  DISABLE_WEB_SCHEDULERS via the new early-start + stop-owned handle
  (server.ts `registerShutdown` calls stop() unconditionally). worker.ts no
  longer imports or starts it; the multi-web duplicate-dispatch cost is a
  marked `shortcut:` comment — a decision, and single-instance is the load.
- **readApiError** — every replaced call site (coupon-quote, product.tsx ×2,
  WhatsAppPhoneSignIn, telegram-callback, isHttpApiError/apiErrorData)
  preserves classification semantics exactly, including the string-status,
  non-object-data and ResponseParseError (no `.data`) edges.
- **CI concurrency group** — `…-${{ github.event_name }}` splits push
  (`…-push`) from schedule (`…-schedule`): pushes still cancel older pushes
  on the same ref; the weekly sweep can no longer be cancelled by a push.
  The audit job's install/cache removal is safe (`pnpm audit` reads the
  lockfile only; empirically verified by the lane with a no-node_modules probe).
- **Low-risk areas** — comment-only edits (ledger.ts, read.ts, docblocks),
  scripts/config one-liners (bash -n clean, yaml/json parse), lockfile
  consistent with the zod removal, `requireCopilotPermission` factory and
  `legacyBodyHash` arm deleted with zero dangling references (`hasScope`
  keeps its real caller), frontend page fixes (slug-key seeding, coupon-void
  dep, ref threading, useSeo blocks, memoized buckets, CopyField fold) all
  pinned by new/extended tests.

## Findings

### Should fix

1. **An orphaned Redis duplicate client can kill the web process**
   (`backend/src/services/risk-config-cache.service.ts:174-188`)
   - **What this is:** every `getRiskConfig` cache expiry (60 s) calls
     `ensureInvalidationSubscription`, which clones the main Redis client
     (`redis.duplicate()`) and connects it. R146 correctly bounded that
     connect (`withRedisCommandTimeout`) so a black-holed socket no longer
     hangs the risk pipeline.
   - **Problem:** on timeout the catch swallows the rejection and
     `invalidationSubscribed` stays false — so the NEXT expiry mints another
     duplicate, and the old one is never closed and never gets an
     `.on("error")` listener (the main singleton has one at
     redis-client.ts:213; node-redis duplicates do not inherit listeners).
     node-redis emits `error` on the client when its socket errors
     (@redis/client `lib/client/index.js:538-539`), and an EventEmitter
     `error` with no listener throws → the repo's uncaughtException handler
     (instrument.ts:46) exits the process. Concrete case: `REDIS_URL` set,
     Redis accepts TCP then stops answering; each minute of the outage leaves
     one un-listened duplicate, and the first socket-level error (RST from
     Redis or a middlebox) takes the whole web process down instead of
     degrading. The crash path predates R146 (the unbounded connect left the
     same un-listened client), but the new retry loop widens it from one
     orphan to one per minute. Production today runs without `REDIS_URL`, so
     the path is dark there — it goes live the moment Redis is wired.
   - **Fix:** one line before the connect: `sub.on("error", () => {});`
     (or a warn logger, mirroring redis-client.ts:213). Optionally retire the
     loser in the catch with a best-effort `sub.quit().catch(() => {})`.
   - **If we skip it:** a sustained Redis outage plus one RST restarts the
     web process — the exact opposite of the stay-up/degrade-loudly contract
     the rest of redis-client.ts promises.

2. **`isUniqueViolation` is copy-pasted verbatim into two services**
   (`backend/src/services/firebase-auth.service.ts:600-604`,
   `backend/src/services/telegram-auth-flow.ts:74-78`)
   - **What this is:** the 5-line helper that detects SQLSTATE 23505 through
     Drizzle's error wrapper (`.cause`), added this round to both race fixes.
   - **Problem:** the two copies are byte-identical and must change together —
     a Drizzle upgrade that moves the driver error off `.cause` needs the
     same edit in both files (a constraint-specific third variant of the same
     traversal already lives in topup.service.ts:24).
   - **Fix:** export one `isUniqueViolation` from a shared lib module and
     import it in both services. Deletes ~10 lines.
   - **If we skip it:** the next 23505-related change lands in one file; the
     other silently keeps the old semantics until its race test fails.

### Nice to have

3. **Copilot refusal rows hardcode the scope vocabulary**
   (`backend/src/routes/admin/copilot/ask.ts:190`, `draft.ts:96`)
   - **What this is:** the new pre-403 audit row writes
     `failureReason: "out_of_scope: missing scope inventory|admins|users"`
     (ask) / `"out_of_scope: missing scope inventory"` (draft).
   - **Problem:** the 403 condition itself derives from the live tool
     catalogs (`tools.length === 0` over read/operational/direct/universal
     tools), but the string is frozen. Add a read tool scoped e.g.
     `"tickets"` and the forensic text keeps claiming the admin lacked
     inventory|admins|users — the row lies about why the probe was refused
     while an operator is triaging it.
   - **Fix:** derive the list from the catalogs
     (`[...new Set(READ_TOOLS.map((t) => t.requiredScope))].join("|")`) or
     drop the enumeration from the string.
   - **If we skip it:** misleading audit text after the next tool lands; the
     403 itself stays correct.

---

- **Verdict:** fix 1 and 2 first.
- **Lean:** -10 lines possible.
- **Not checked:** Playwright e2e was not run (out of round scope) and the
  orval regeneration was verified only by spec/client diff consistency plus
  the green contract gate — orval itself was not executed.
