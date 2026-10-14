# R146 audit — shared packages + the migration system (agent 146-AUD-5, ponytail round)

What this part does: The `shared/` tree holds the contracts both processes and both apps agree on — the React data client the storefront consumes (`api-client-react`, orval-generated hooks over a hand-written `customFetch`), the OpenAPI spec + codegen (`api-spec`), the generated zod request validators the backend consumes (`api-zod`), the Drizzle schema + declarative SQL chain (`db`), and the error-code catalog (`error-codes`). `backend/src/migrate.ts` + `backend/src/migrate/` are the boot reconciler — the ONLY thing that actually builds/changes the live Neon schema at runtime.

Load assumed: real public storefront (subnation.ly) with concurrent paying customers, money in every other request, two long-lived processes (API server + background worker; only the server runs migrations), Docker + Coolify blue-green deploys against Neon PostgreSQL.

Method: full read of SKILL.md + AGENTS.md, worklog r139–r145, the R143/R144/R145 closed-item ledgers (nothing below re-reports a closed item — L9-1 verified fixed in place at `shared/db/src/schema/flash_sales.ts:32-34`, migrate.ts split verified at the R144-B2 shape). Static reading + rg only; no tests, no builds, no DB connections.

## Verified healthy (so the findings below have context)

- **Generated-vs-handwritten separation is genuinely gated**: CI regenerates orval output and diffs `shared/api-zod/src` + `shared/api-client-react/src` (ci.yml:391-402), regenerates the drizzle chain and diffs `shared/db` (ci.yml:378-389), and runs the route/error-code/header-param contract gates (ci.yml:344-376). Hand-written code (`custom-fetch.ts`, `index.ts` files) lives outside the `generated/` dirs orval cleans. No hand edits inside generated files (checked for round-comment markers).
- **Drizzle chain integrity**: journal is strictly sequential 0000–0024 (idx = position, monotonic timestamps, every SQL + snapshot present, no gaps/duplicates). The R143 chain-apply PGlite test replays all 25 files and pins the end shape; the full `runMigrations()` body test replays the 339-statement boot on a fresh PGlite and pins the same census (41/29/39/139). Both paths currently agree.
- **Partial-failure safety of migrate.ts**: every stage is probe-gated or IF-guarded; the runner re-throws on critical failure (migrate.ts:1996-2003) and server.ts exits production before listening (server.ts:225-238); transient read-only/connection windows are retried from the top with lock-TTL refresh (boot-migrations.ts); the fast-path fingerprint is persisted only after a fully successful, skip-free run and its hash covers migrate.ts + migrate/** + schema + chain (build.mjs:62-93). The worker process never runs migrations — no double-run between the two long-lived processes.
- **Error-code three-legged contract**: const ↔ YAML enum gated by check-error-code-sync.ts (55 codes both directions, order-matched — hand-verified against the current files); frontend map is `Record<ErrorCode, string>` (typecheck-gated); backend emissions go through the typed `createErrorResponse`. All current literal emitters (`rate-limits.ts`, `csrf.ts`, `copilot/rate-limit.ts`) use enum members.
- **custom-fetch**: timeout/abort/caller-cancel semantics, 401 observer guards, boot-gate marker uniqueness (one emitter, server.ts:131), and gate-budget termination even with `timeoutMs: 0` are all correct and pinned by the 20-test network battery; the additive 401 registry is registered once per app load with a working unsubscribe (frontend/src/lib/user-session.ts:251).

## Must fix

(none — nothing found that wrongs a result on the expected load today)

## Should fix

1. **Legacy plaintext credentials containing two colons are silently never encrypted** (`backend/src/migrate.ts:945-961` and `backend/src/migrate.ts:1772-1799`)
   - **What this is:** Two boot loops that encrypt legacy plaintext credentials at rest — `inventory.account_password` (the sold-product logins) and `orders.delivered_password`.
   - **Problem:** Both loops pre-filter in SQL with `NOT LIKE '%:%:%'` (migrate.ts:948 and :1776). Encrypted values carry 2–3 colons (`v2:iv:tag:ct` / `iv:tag:ct`), so the filter treats "≥2 colons" as "already encrypted". A legacy PLAINTEXT password that itself contains two colons — an operator pasting `user:pass:2fa` or any password with two colon separators into the password field — is excluded by the SQL, so the JS `isEncrypted()` check, which both comments call the authoritative gate (migrate.ts:941-944 and :1768-1771), never sees the row. That credential stays plaintext in the database forever, with zero log signal, while the loop's stated goal is "a DB dump / backup leak = every delivered account exposed" (migrate.ts:1760-1762). Reads still work (safeDecrypt passes plaintext through), so nothing ever surfaces it.
   - **Fix:** Make the pre-filter unable to match human text: keep `NOT LIKE 'v2:%'` and replace the colon-count guess with the exact legacy ciphertext shape, e.g. `AND account_password !~ '^[0-9a-f]{24}:[0-9a-f]{32}:'` (24-hex IV + 32-hex tag is the v1 shape; no typed password looks like that). Line-for-line swap in both loops.
   - **If we skip it:** any legacy credential row with two colons stays unencrypted at rest with no signal; the encryption-at-rest goal is silently not met for exactly the rows the loops exist for.

2. **No automated column-level parity gate between migrate.ts (the only runtime schema owner) and the Drizzle schema/chain** (`backend/src/jobs/__tests__/migrate-boot-body.test.ts:142-150`, `backend/src/jobs/__tests__/migrate-drizzle-chain-apply.test.ts:169-172`)
   - **What this is:** The live schema is built ONLY by `backend/src/migrate.ts` + `migrate/stages/*` (.hermes.md non-negotiable #1; the drizzle chain is declarative-only, applied by nothing — guard-drizzle-push.mjs documents it). Four copies of the schema exist: migrate.ts body, schema TS, chain SQL, test harness DDL.
   - **Problem:** The permanent tests pin COUNTS only (41 tables / 29 CHECKs / 39 FKs / 139 indexes) plus ~a dozen named money objects (`schema-parity.test.ts`). Adding a COLUMN to `shared/db/src/schema/users.ts` changes none of those counts. Concrete case: a dev adds `users.marketing_opt_in` to the schema TS, runs `drizzle-kit generate` (chain 0025 — the CI drift gate passes because it was regenerated), updates the route and the test harness DDL; lint, typecheck, orval, route and error-code gates are all green; deploy → migrate.ts contains no stage creating the column → every production query selecting it fails with 42703 at runtime. The fingerprint's schemaHash forces one full reconcile on next boot (build.mjs:32-36) but the reconcile body lacks the column and still persists the new marker — no error anywhere. The R143 L9 lane's "three-way substance parity holds" was a one-time manual diff, not a gate.
   - **Fix:** Extend `migrate-boot-body.test.ts` (it already runs the full body on a fresh PGlite) with a column census: for every table exported by `@workspace/db/schema`, compare `getTableColumns(table)` names against `information_schema.columns` of the boot-built database, failing on a mismatch in either direction. ~30 lines inside an existing file, no new machinery.
   - **If we skip it:** the next schema edit that forgets its migrate.ts stage ships through fully green CI and breaks only in production, at request time, on the money paths.

3. **The admin-seed INSERT can abort a concurrent cold boot as "critical"** (`backend/src/migrate.ts:996-1009`, `backend/src/lib/boot-migrations.ts:179`, `backend/src/lib/boot-migrations.ts:526-531`)
   - **What this is:** When `admin_users` is empty, boot seeds the first admin with a count-then-INSERT.
   - **Problem:** The INSERT has no `ON CONFLICT` guard — unlike its three sibling seeds in the same file, which all use `ON CONFLICT DO NOTHING` exactly for re-run/concurrency safety (migrate.ts:984, :1195, :1293). In the production no-Redis shape, concurrent cold containers are serialized only by the PG advisory lock, and that lock fails OPEN after 90 s ("statements are idempotent; boot refusal is the worse failure"). The seed is not idempotent under concurrency: on a fresh database whose first reconcile outlasts 90 s (cold Neon + 339 statements), leader and follower both read COUNT(*)=0 and both INSERT the same username; the loser hits unique_violation (SQLSTATE 23505), which `classifyError` does not list in the "idempotent" class (only 42P06/42P07/42701/42710) → classified "critical" → `process.exit(1)` → Coolify records a failed deploy. It self-heals on the next restart (count now > 0), but the failed container start and the critical-classified Sentry alert are real noise on a fresh-environment deploy.
   - **Fix:** One line — add `ON CONFLICT (username) DO NOTHING` to the admin seed INSERT. Optionally also add 23505 to classifyError's idempotent set as a belt for any other count-then-insert site.
   - **If we skip it:** a blue-green/scale-2 cold start on a fresh database can fail one container's boot with a "critical migration failure" that is actually a benign lost race.

## Nice to have

4. **`zod` is a dead dependency of `@workspace/db`** (`shared/db/package.json:17`)
   - **What this is:** The db package declares `zod: "catalog:"` as a runtime dependency.
   - **Problem:** Zero zod imports remain anywhere in shared/db (src, scripts, drizzle.config — grep-verified across the whole monorepo). The drizzle-zod imports were removed in R135 and the schema files' own comments record that "the dependency line left shared/db/package.json the same round" (`shared/db/src/schema/users.ts:95-98`). Every consumer still resolves and links a zod copy for nothing (visible as `scripts/node_modules/@workspace/db/node_modules/zod` in the tree).
   - **Fix:** Delete the `zod` line from shared/db/package.json and refresh the lockfile. Zero code change; -1 dependency.
   - **If we skip it:** a dead dependency keeps being installed and the comments keep implying this package owns a zod perimeter it does not have.

5. **"Migrations completed" is logged in the middle of the run** (`backend/src/migrate.ts:1243`)
   - **What this is:** A legacy log line fired right after the seed blocks.
   - **Problem:** 26 stages still execute afterwards (V1-M9..V1-M34, lines 1825-1988 — the money constraints, idempotency keys, points ledger, RESTRICT FKs, index waves) plus the fingerprint persist. An operator tailing logs during a slow deploy reads "Migrations completed" while money constraints are still being reconciled. Same class as the R143 L9-4 fix (boot-critical log lines must be greppable and trustworthy).
   - **Fix:** Move the line below `applyR135IndexWaveStage()` (migrate.ts:1988), or reword it to "core tables reconciled".
   - **If we skip it:** log-only confusion during deploys; no runtime effect.

---

**Verdict:** Healthy domain with narrow gaps — fix #1 (the encryption pre-filter) first because it silently defeats a security goal on credential rows; #2 is the one that will eventually page someone (green-CI schema drift breaking production); #3 is a one-liner worth taking with #2.

**Lean:** -1 line, -1 dependency possible (finding 4; findings 1/3 are ~line-neutral, finding 5 moves one line).

**Not checked:** the 2,226 lines of `migrate/stages/02`+`03` were read structurally (probe/DROP/CREATE patterns, the organizations removal and ticket-drift-closure stages in full) — not every line; `openapi.yaml` read at header/security/error-code level, not all 84 operations; the generated `api.ts` (13,061 lines) read in samples (structure, cart family, the createOrder money mutation) — not every hook; frontend call-site invalidations (71 sites) belong to the frontend audit lane — only the shared-client side was verified; no database was touched and no gates were run (read-only audit; the orchestrator runs gates later).
