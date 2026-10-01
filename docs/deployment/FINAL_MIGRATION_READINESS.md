# Final Migration Readiness — SubNation2 → Oracle ARM64 + Coolify

> **R108 — FINAL MIGRATION CANDIDATE report** (mission §69, final-hardening
> phase). Base: `175bbeb` (r107) + the R108 commits on top. Companion docs:
> `MIGRATION_RUNBOOK.md` (the executable checklist) ·
> `COOLIFY_ORACLE_MIGRATION.md` (the why/how) · `ENVIRONMENT_MATRIX.md`
> (the authoritative env reference) · `docs/architecture/PRODUCTION_ARCHITECTURE.md`.
>
> Verification vocabulary used throughout (nothing vaguer is allowed):
> **VERIFIED** (evidence exists — tests/builds executed) ·
> **VERIFIED WITH LIMITATION** (verified under an explicit constraint) ·
> **STATICALLY VERIFIED** (proven by code/config/dependency inspection, never
> executed) · **NOT VERIFIED** (no runtime evidence yet — exact command given) ·
> **BLOCKED BY EXTERNAL INFRASTRUCTURE** (needs an asset this phase cannot
> provision) · **FAILED** (attempted and broken — none).
>
> **r110 update (2026-09-23, post-`bb4418e`):** R109 proved two Docker P0s —
> the runtime-stage `pnpm install --prod` died on the root `prepare: husky`
> script (husky is a devDependency, absent from a prod tree), and the
> pnpm-workspace platform-exclusion overrides had stripped every non-x64-linux
> native (arm64-gnu/musl, x64-musl) from the lockfile — so the image was
> UNBUILDABLE at the R108/R109 bases and the ARM64/Docker rows below
> overstated readiness. Both P0s are fixed in `bb4418e` (`--ignore-scripts` on
> the runtime-stage install; exclusions dropped + lockfile regenerated).
> Current verification: static + exact-stage replay in the sandbox — full
> frozen install exit 0; the runtime stage's exact command and file layout
> exit 0; arm64/musl + x64-musl natives present (30 lockfile refs);
> `require('argon2')` + `require('firebase-admin')` succeed in the
> `--ignore-scripts` prod tree. Still NOT done: an actual `docker build`
> anywhere (no Docker in the sandbox) — `scripts/docker-verify.sh` (extended
> in r110) upgrades this on any Docker host. The affected rows are amended
> in place below.
>
> **r115 update (2026-10-01, release `6f14bc3`):** the migration corpus grew
> by two idempotent boot stages — **V1-M21** (`points_ledger` table with
> structural exactly-once partial UNIQUE + attributed-type CHECKs,
> `users.welcome_bonus_granted`, `users.loyalty_points >= 0` CHECK —
> probe-gated, skip-and-warn + reboot-to-apply on CHECK violations) and
> **V1-M22** (orders `refunded_at` / `refund_amount` / `refunded_by_admin_id`
> + backfill from `wallet_ledger` evidence). The drizzle journal moved to
> **0014** (`0014_fuzzy_jazinda`); migration drift gate re-verified clean at
> `6f14bc3` (regenerate → no tree change). The independent R115-R1 review
> caught a **P0 in the original V1-M21 opening-balance backfill** (zero-point
> users tripped `chk_points_ledger_delta_nonzero` → SQLSTATE 23514 → boot
> abort); fixed in `6f14bc3` with `WHERE u.loyalty_points <> 0` — therefore
> **`6caa63b` / `3a2e2e1` are never deploy targets** (rollback law:
> `FINAL_ROLLBACK_RUNBOOK.md` §4 R115 floor). First R115 boot applies every
> still-pending stage (the R112 live-DB record: 4 non-destructive pre-R115
> stages through V1-M20) plus M21/M22 in one idempotent, advisory-locked
> pass.
>
> `FH-A*` references below point to the R108 mission audit specs (a
> working-session record) — they are **not** files in this repository.

## 1. What R108 changed (the final-hardening deltas)

| # | Change | Type | Evidence |
|---|---|---|---|
| 1 | **`SINGLE_INSTANCE_MODE=true`** — no leader election, no PG-lease heartbeat, zero periodic Neon coordination queries; all jobs still run in-process; election machinery intact for flip-back (P0 economics) | code + tests + docs | `lib/web-scheduler.ts` synthetic leadership; 11 unit tests; `deploy/env.compose.example` default |
| 2 | **V1-M20 migration** — drops the V1-M12 `orders(id)` FK from `idempotency_keys.order_id` (the polymorphic reference the r104 topup claim writes into; the FK would have 500'd the FIRST post-cutover topup) | migration + schema + test | `migrate.ts` `applyIdempotencyDropOrderFkStage`; drizzle `.references()` dropped; FK-regression test |
| 3 | **Admin wallet adjustments durable idempotency** — the last money-adjacent mutation that relied solely on the (pass-through without Redis) middleware now claims in-tx (P1) | code + test | `adjustment.service.ts` in-tx claim; route pre-check; retry→409 test |
| 4 | **Migration mutual exclusion without Redis** — pg advisory xact lock around the whole migration phase; blue-green overlap can no longer race `runMigrations()` | code + tests | `boot-migrations.ts` `runWithPgAdvisoryLock`; boot-resilience cases |
| 5 | **`MIGRATIONS_FORCE_RECONCILE`** accepts `true`/`1`/`yes` + documented (the documented `=1` recipe silently no-op'd before) | code + docs | `migrate.ts` fast-path gate |
| 6 | **Release identity completed** — the 3 remaining direct `RENDER_GIT_COMMIT` reads (admin diagnostics ×2, observability ×1) now route through `getReleaseSha()` | code | admin surfaces show GIT_SHA on Oracle |
| 7 | **Sentry profiling default 0** in production (was silently 0.1, contradicting the matrix's documented intent) | code | `sentry.ts` `resolveProfilesSampleRate` |
| 8 | **`/healthz/summary` no-Redis = `ok`** with a single-tier note (was permanently `degraded` in the designed production shape) | code + test | `health.ts`; observability regression pins |
| 9 | **`scripts/src/validate-production-env.ts`** (mission §44) — 37-rule pre-deploy validator: placeholder secrets that pass boot rules, cross-service parity, forbidden equal-secrets, origin consistency, dangerous combinations; never prints values; `--boot` pure subset exported for the future boot pre-flight | script + wired | template run: 9 errors caught; clean run: exit 0 |
| 10 | **Compose**: openwa env isolation (explicit 11-var block — the gateway no longer receives `ADMIN_JWT_SECRET`/`SESSION_SECRET`/`ENCRYPTION_KEY`), json-file log rotation (10m×3) both services, immutable `sha-<short>` tag guidance | config | `docker-compose.yml` |
| 11 | **Dockerfile**: `CMD ["node",…, "backend/dist/index.mjs"]` (kills corepack re-download at every start + unproven SIGTERM forwarding through pnpm-as-PID-1); backend sourcemaps now emitted ONLY when `SENTRY_AUTH_TOKEN` is set (−23 MB from the default image) | config | `Dockerfile`, `build.mjs`; two offline builds proven |
| 12 | **CI cost**: paths-filter (docs-only push ≈19→2 min), audit job deps-cached, secret-scan stays always-on; `deploy.yml` gated on `RENDER_DEPLOY_ENABLED` (the October trap — see §6) | config | `ci.yml`, `deploy.yml` |
| 13 | **gitleaks allowlist** for `deploy/env.compose.example` placeholders (the secret-scan job was failing on the r107 templates → quality silently skipped) + `.dockerignore` nested `**/.env*` + `**/.env.example` exemption | config | `.gitleaks.toml`, `.dockerignore` |
| 14 | **openwa repo**: pg pool `error` listener + `statement_timeout` 10 s + keepalives (Neon autosuspend survival), `.dockerignore`, CI workflow for its 80 tests (public repo = free), `OPENWA_API_KEY` <32-char boot warning | code (sibling repo) | 80/80 green incl. strict tsc |
| 15 | **Prettier markdown landmine defused** — `*.md` excluded in `.prettierignore` (the formatter rewrites `DATABASE_URL`→`DATABASE*URL` in prose and mashes checklists; a stray run corrupted 7 files + 2 historical scars — all repaired) | config + repairs | `.prettierignore`; `inspection-r97` + `DISASTER_RECOVERY` scars fixed |
| 16 | **Docs truth pass** — runbook phantom `db-backup.sh` → `pnpm run db:backup`; Neon Free restore window corrected (7 days → **~6 hours** — daily off-VM pg_dump is the PRIMARY recovery); WhatsApp one-linked-device rollback trap documented + runbook guard; swap policy (2 GB / swappiness 10); iptables discovery command; CF tiered origin-lockdown; `OPERATIONS_RUNBOOK`/`WHATSAPP_OPERATIONS`/`DISASTER_RECOVERY` legacy-labeled; catalog counts reconciled (56−11=45=45+14=59, 263 variants) | docs | per-file edit lists in the R108 audit record (`FH-*` specs — working-session record, not repo files) |

## 2. Readiness status by subsystem

| Subsystem | Status | Evidence | Limitation |
|---|---|---|---|
| Source gates (tests/type/lint/build) | **VERIFIED** | backend **1264/1264** (+35), frontend **573/573** (+3), openwa **80/80**, typecheck 0×4 packages, lint 0 errors (86 baseline warnings), build green (PWA 10 / 346.85 KiB) | — |
| Single-instance scheduler mode | **VERIFIED** (code+tests) | 11 unit tests: election never called, jobs all start, stop clean, precedence, no-Redis no-poll; observability/healthz/banner pinned | VM runtime = NOT VERIFIED (needs the VM) |
| Neon economics | **VERIFIED (design)** | idle traffic drops 144 q/h (never sleeps) → ~0.5 q/h avg in 5 night windows (~12.5 awake-h/mo vs 720) — R108 audit record FH-A1 §9.11 | Runtime measurement on the VM pending |
| Money invariants | **VERIFIED** | 12-scenario red-team table (R108 audit record FH-A7) re-verified at HEAD + V1-M20 + adjustment idempotency + checkout referenceType filter + 23505 classification fix | Live-DB execution pending first post-cutover flows |
| Migration safety | **VERIFIED** | fingerprint hashes migrate.ts+schemas at build → a code-side schema change cannot ride the fast-path (attack matrix traced); V1-M20 idempotent + probe-gated; advisory lock closes the no-Redis race | — |
| ARM64 — package tier | **STATICALLY VERIFIED** (r110: now incl. the build toolchain) | runtime natives: argon2@0.44 arm64 glibc+musl prebuilds bundled in the package (load at require-time — proven by `require('argon2')` in the `--ignore-scripts` prod tree); Baileys = pure WebSocket (no Chromium); node:22-alpine multi-arch. Build toolchain (post-`bb4418e`): @esbuild/linux-arm64, @rollup/rollup-linux-arm64-gnu+musl, @tailwindcss/oxide-linux-arm64-*, lightningcss-linux-arm64-* and the x64-musl variants all present in `pnpm-lock.yaml` (30 refs). (sharp is the **openwa repo's** dep, pinned in its own lockfile — not a SubNation2 dependency) | — |
| ARM64 — build tier | **BUILD BLOCKERS FIXED (`bb4418e`) · BUILD NOT YET RUN** | both R109 P0s fixed (husky `prepare` killed the `--prod` runtime-stage install → `--ignore-scripts`; platform-exclusion overrides dropped + lockfile regenerated). Proven so far: static inspection + exact runtime-stage replay in the sandbox (exit 0). The actual `docker build` has not run anywhere — exact command: `./scripts/docker-verify.sh --arm64` (QEMU cross-build; script extended in r110) on any Docker host | needs Docker (sandbox has none) |
| ARM64 — runtime/functional tier | **NOT VERIFIED** | exact command: run the arm64 image on the VM (or `--platform` QEMU boot) + Phase-5 gates | needs the Oracle VM |
| Docker artifacts | **STATICALLY VERIFIED** (r110: install stages replay-proven) | Dockerfile line-audit (R108 audit record FH-A3), compose three-way consistency, healthcheck parity, final-image content trace (no .env/secrets/maps), image ~300-330 MB estimated; r110: both install stages replay exit 0 post-`bb4418e` | runtime = NOT VERIFIED until `docker-verify.sh` runs |
| OpenWA isolation & security | **VERIFIED** | internal-only binding, X-API-Key timing-safe + 8 s timeout + bounded retry, key separation (API vs credentials key) proven with 5 dedicated tests, dashboard lockout, no CORS | — |
| OpenWA restart persistence | **VERIFIED WITH LIMITATION** | persistence-level tests + boot auto-restore path verified in code; harness specced (R108 audit record FH-A2 §8) | **Real WhatsApp E2E = BLOCKED EXTERNALLY** (needs a phone pairing on the VM) |
| Single-origin contract | **STATICALLY VERIFIED** | SPA+`/api/*`+same-origin Socket.IO (r107 Host-match + r108 IPv6 pin) + robots/sitemap; zero forbidden `onrender/vercel` runtime reads (census: 20 sites all degrade safely) | live-container check pending |
| Hosting neutrality | **VERIFIED** | §11 census: 0 forbidden occurrences; identity chain GIT_SHA→RENDER_GIT_COMMIT→unknown now uniform across 9 surfaces | — |
| Secrets hygiene | **VERIFIED** | full-pattern sweep of both repos + workflows + Docker inputs: no real secret committed at HEAD; public-by-design values correctly exempt | git-history rotation status unverifiable from shallow clone (audit note) |
| Admin auth | **VERIFIED** | r98 timing fix intact (dummy argon2 ×3 branches), lockout race-safe, cookie flags, rate limits | TOTP for the single admin = operational advisory (operator action) |
| Rate limiting without Redis | **VERIFIED** | 17/17 mechanisms checked: bounded in-memory fallbacks, zero silent disables | — |
| Graceful shutdown | **VERIFIED (code)** | drain order end-to-end, 25 s budget < 40 s grace, hang paths bounded; drain-proof is docker-verify step 5 | container runtime pending |
| Health model | **VERIFIED** | zero-I/O healthz, boot-gate parity, no-Redis reads ok (r108), degraded states documented | — |
| DB connection budget | **VERIFIED** | peak 18/~100 Neon connections incl. blue-green overlap + openwa pool | — |
| Observability/logging | **VERIFIED** | pino redaction test-pinned, Sentry sanitizer deep, profiles default 0, log rotation pinned in compose | — |
| Backup/restore | **PROCEDURE-DOCUMENTED** | `pnpm run db:backup` + Neon ~6 h window reality + off-VM copy + secrets/config backup; restore steps written | **NOT TESTED** — operator must run one restore rehearsal before cutover (runbook Phase-0) |
| Rollback | **VERIFIED (plan)** | same-Neon continuity proven (no data fork); DNS 1-min flip; gateway one-linked-device dance documented | — |
| CI/CD | **STATICALLY VERIFIED** | workflows audited: timeouts, caching, paths-filter, cancel-in-progress; docker.yml tags+manual only; immutable `sha-` tags produced | Actions minutes exhausted → first post-renewal run is the live verification |

## 3. Mission §70 acceptance checklist

- [x] Single-instance architecture explicitly defined (`SINGLE_INSTANCE_MODE`, matrix + compose + docs)
- [x] Scheduler/PG-lease economics resolved (zero coordination queries; flip-back documented)
- [x] Neon not accidentally kept awake (idle autosuspend preserved; retention ladder ≈12.5 h/mo)
- [x] All periodic jobs inventoried (R108 audit record FH-A1 tables: 9 crons + 14 one-shots + evaluator + sweeps, classified)
- [x] OpenWA safely isolated (internal-only, env-split, no public port)
- [x] OpenWA persistence verified at persistence-level + E2E procedure written (real pairing = externally blocked)
- [x] OpenWA encryption key separation verified (5 dedicated tests; rotation docs corrected)
- [x] Docker Compose internally consistent (three-way env/health/grace audit)
- [x] Dockerfile internally consistent (line audit; CMD/sourcemap/healthcheck/signal path)
- [ ] ARM64 build actually tested — **NOT VERIFIED** (build blockers fixed at `bb4418e` — static + replay verification only; no Docker in sandbox; command ready: `./scripts/docker-verify.sh --arm64`, extended in r110)
- [x] ARM64 external verification documented exactly (§2 table + docker-verify.sh gates)
- [x] Runtime vs package compatibility distinguished (three-tier labels above)
- [x] Render runtime dependencies removed/isolated (census; 3 identity reads fixed; deploy.yml gated)
- [x] Vercel optional (documented legacy/preview; nothing requires it)
- [x] Single-origin deployment verified statically (runtime gate = Phase-5)
- [x] Socket.IO verified (12/12 mission test items mapped; 40 socket-auth tests)
- [x] Cloudflare proxy assumptions verified (trust model: CF-range-validated client IP; XFF rightmost; lockdown tiers)
- [x] Health checks verified (zero-I/O + parity + no-Redis ok)
- [x] Shutdown verified (code + hang analysis; container proof = docker-verify step 5)
- [x] DB connection budget documented (18/100 peak)
- [x] Migration fingerprint tested (attack matrix traced; fast-path proof designed into boot tests)
- [x] Secrets audited (both repos; no live values at HEAD)
- [x] Frontend VITE secrets audited (all public-by-design; empty-API-var contract)
- [x] Admin authentication verified (timing/lockout/cookies/rate)
- [x] Money/idempotency invariants verified (12-scenario table + V1-M20 + adjustments backstop)
- [x] Catalog numbers reconcile (56−11=45=45+14=59 rows, 263 variants; docs corrected)
- [x] Environment matrix matches source (r108 matrix fixes: defaults un-swapped, missing vars added)
- [ ] Local Docker deployment reproducible — **STATICALLY VERIFIED** (compose audit; image build unblocked at `bb4418e`; execution needs Docker)
- [x] CI/CD internally consistent (cost table + gates; first live run pending minutes)
- [x] Backup/restore procedure exists (honest labels; restore rehearsal = operator step)
- [x] Rollback procedure exists (incl. gateway collision dance)
- [x] Current docs consistent (banners + fixes; historical docs preserved + dated)
- [x] Historical docs clearly marked (§63 respected — nothing deleted)
- [x] Final red-team performed (16/16 vectors BLOCKED/MITIGATED, R108 audit record FH-A11)
- [x] Second-pass review performed (this report cross-checks every R108 change against its audit spec)

## 4. Remaining before Oracle deployment — the exact list

**Blocked externally (cannot be done from the repository):**
1. GitHub Actions minutes renewal (CI red is billing-only) → then one manual `docker.yml` run (produces the immutable sha-tag image) + confirm the paths-filter timing.
2. The Oracle VM itself (account → A1.Flex 2/12 → Ubuntu → both-layer firewall → swap §4.4 → Coolify §4.5).
3. Real WhatsApp pairing E2E on the VM (Phase-5 gate).

**Operator actions at cutover (all in `MIGRATION_RUNBOOK.md`):**
4. Set `RENDER_DEPLOY_ENABLED=false` (repo variable) or disable `deploy.yml` in the Actions UI **before October's renewal**.
5. Install the nightly backup cron — `scripts/backup-cron.sh` (r110; host-cron wrapper around `pnpm run db:backup`; install line in `docs/DISASTER_RECOVERY.md` "Automated backups") — + run ONE restore rehearsal (Neon Free restore window is only ~6 h).
6. Run `pnpm --filter @workspace/scripts run validate:env -- --file .env --strict` on the filled env (Phase-3 gate).
7. On any Docker host first: `./scripts/docker-verify.sh` + `--arm64` (upgrades ARM64 to VERIFIED before touching the VM; the script is extended in r110 with the remaining container gates — compose config, Socket.IO, gateway health, restart/inspect).

## 5. The single command that starts the real migration

Once the Oracle VM exists and Coolify's wizard is done (runbook Phase 2):

```bash
# Phase 3-4 essence (full checklist in MIGRATION_RUNBOOK.md):
cd SubNation2 && cp deploy/env.compose.example .env   # fill Phase-3 values
pnpm --filter @workspace/scripts run validate:env -- --file .env --strict
# Coolify: + New → Docker Compose → Git → ahmadmedo1012/SubNation2 @ main
# → paste .env → Deploy → watch [boot] lines + healthz 200 + SHA gate
```

Everything else — code, config, tests, docs, runbooks, rollback plans — is
in the repository and verified as far as a Docker-less sandbox allows.
