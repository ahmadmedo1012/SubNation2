# R110 Remediation Report — 2026-09-23

Execution of the R109 fix plan (consolidated from the 22-agent R109 audit) by a
13-agent parallel fix fleet with exclusive file ownership, followed by full-gate
verification and 13 coherent commits (SubNation2) + 1 commit (openwa).

## Outcome vs. the round goal

| Metric | R109 finding | R110 result |
| --- | --- | --- |
| P0 | 2 (Docker image unbuildable on every path) | **0** — fixed in `bb4418e` (P0 commit of this round) |
| P1 | 5 | **0** — all five fixed (see table) |
| P2 | ~14 | **0** — all fixed (see table) |
| P3 | ~45 | Cheap block fixed; intentional/documented trade-offs and residuals listed below |
| Tests | backend 1264 / frontend 573 / openwa 80 | **backend 1312 / frontend 579 / openwa 87** (+61 new, zero regressions) |
| Gates | drift gate RED at HEAD | All green: typecheck, lint (0 errors), OpenAPI 79/79, drift regen no-op, validator 46 rules, shell syntax |

## P0 (fixed in `bb4418e`, empirically verified)

1. **Image build dead at the runtime stage** — root `prepare: husky` exits 1 under
   `pnpm install --prod` (husky is a devDep). Fix: `--ignore-scripts` on the
   runtime-stage install; runtime externals (argon2, firebase-admin) load bundled
   prebuilds at require-time (re-proven in the replay tree).
2. **arm64/musl toolchain natives excluded from the lockfile** — the workspace
   override block stripped every non-x64-linux optional native; the Oracle A1
   target is ARM64 Alpine. Fix: overrides dropped, lockfile regenerated
   (30 native refs across all four families). Verified: full frozen install
   exit 0; exact runtime-stage layout replay exit 0.

## P1 (all fixed)

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 | render.yaml omits `SINGLE_INSTANCE_MODE=true` → PG-lease refresher would keep Neon awake 24/7 on blueprint re-apply | Pinned + legacy banner + un-swapped DB timeout pins | `2e5951b` |
| 2 | Admin wallet-adjust UI/backend contract break (backend requires `note` ≥3; dialog never sent it → guaranteed 400, feature dead) | Dialog note field (required iff wallet field present), spec description updated, api-zod regen (description-only) | `8daad4f` |
| 3 | CI migration-drift gate RED — 39bedf4 removed the FK from the schema but never re-emitted the chain | `0013` committed (DROP CONSTRAINT **IF EXISTS** — hand-hardened against the V1-M20 double-drop), regen proven idempotent | `106688a` |
| 4 | README presents subnation.ly as live production on Render while all services are billing-suspended since ~2026-09-11 (503, deploys API-rejected) | Honest status badge + deployment section; post-`bb4418e` build truth in FMR/COOLIFY (no overclaiming: sandbox proofs listed, VM build still pending) | `3d730da` |
| 5 | No automated backup (manual-only pg_dump, unbounded local growth, empty drill ledger) | `scripts/backup-cron.sh` host wrapper + `--keep` retention + argv-secret fix (PG* env) + DR section with honest PENDING-OPERATOR drill ledger | `1dec82f` |

## P2 (all fixed)

| Finding | Fix | Commit |
| --- | --- | --- |
| Validator blind to scheduler economics (REDIS_URL unset without SIM=true passes) | New rule + 8 more (46 total); forbidden-equality family extended (SESSION==OPENWA key now fails); OPENWA_CREDENTIALS_KEY enforced; WORKER_TIER value-check; OTP_HMAC_KEY dedupe | `2e5951b` |
| Fingerprint persisted despite constraint-skip alert paths ("reboot to apply" no-ops) | Skip-tracking; marker persisted only on fully-reconciled runs | `106688a` |
| Fast-path blind to out-of-band schema drift | v2 composite marker `v2:<codeHash>:<schemaHash>`; legacy markers reconcile exactly once | `106688a` |
| No global per-username admin brute-force ceiling (IP-rotating attacks unbounded) | DB-backed `admin-username:{username}` lockout (10 failures / 15-min doubling), uniform 401 + dummy-argon2 parity preserved | `645c25c` |
| `/healthz/summary` permanently "degraded" in the designed no-Redis single-instance shape | worker/socket branches mirror the redis branch (ok + note); /healthz/worker + /healthz/socket aligned | `f642112` |
| Relative og:image on both no-JS surfaces (share-card middleware + static index.html) | Absolutized (APP_URL || canonical domain — same source as og:url) | `557d4a6` |
| Nothing pins the cron registration inventory | `cron-registration.test.ts` asserts the literal 10-expression inventory (all UTC) + stop() drains all handles | `4578685` |
| GitHub Actions not SHA-pinned (incl. docker.yml with packages:write) | All 20 `uses:` pinned to 40-hex SHAs resolved live via `git ls-remote` (tags kept as comments; pnpm/action-setup@v4 moving tag resolved via API + documented) | `c146eb3` |
| Single multi-platform buildx push: arm64 failure blocks amd64 publish | fail-fast:false matrix with arch-suffixed immutable tags + `imagetools create` merge job (amd64 required, arm64 rejoins when green) | `c146eb3` |
| docker-verify.sh covers 5/10 §15 gates; non-executable | 10/10 gates + `chmod +x` | `c146eb3` |
| PRODUCTION_ARCHITECTURE describes PG-lease as THE scheduler mode; "12 migrations" stale | §1.1 single-instance section + real migration count | `3d730da` |
| FINAL_MIGRATION_READINESS references phantom `audit/FH-*.md` files | Reworded to the real record | `3d730da` |
| openwa: OPENWA_CREDENTIALS_KEY unenforced (see validator row above); doSave resurrect race; unvalidated restore filenames; pool missing connectionTimeoutMillis | All fixed in the gateway repo (FIFO-chain serialization kills the race deterministically; charset validated lossless against Baileys 6.7.24) | openwa `d027199` |

## P3 (cheap block — all fixed)

Env docs completeness + rotation-comment truth (`2e5951b`) · dead `VITE_FIREBASE_MEASUREMENT_ID`
ARG removed; corepack re-verified NOT dead (`c146eb3`) · dead `fetchHealthzReady` removed (`f642112`) ·
product detail routes filter `is_active`; slug-canonical ItemList LD; SEO_PRODUCTS.json refreshed;
import-seo warns on skips (`557d4a6`) · 05:00 slot isolation + per-job Sentry tags; 4 stale job
comments; pruneExpiredOtps ctid-batched; COMPLIANCE cadences; OPERATIONS_RUNBOOK §5 rewritten
(`4578685`) · idempotency comment truth + cross-intent 409 test; coupons/referrals audit logs;
sentry stale log; cloudflareClientIp docs; banker-safe wording; eslint comment (`138e2ed`) ·
whatsapp docs-link degradation; coupon ≥100% + 10,000 LYD client guard; checkout comment (`6698ac7`) ·
backups/ in .dockerignore (`1dec82f`) · vercel.json legacy banner; sha-pinned ghcr pulls; GIT_SHA
VM note; COOLIFY:389 backup line (`3d730da`) · openwa Dockerfile comment + dead `apk add git`
(openwa `d027199`).

Not-a-bug corrections: the `.vscode "arkdown]" typo` was a false positive (terminal strips `[m`;
verified via `od` + git blob hash). The "256kb JSON limit" doc claims are true for openwa and were
never made about SubNation2 (1mb).

## Residuals (documented, for a future round)

- `admin/users.ts:264-265` repeats the old "can never collide" idempotency comment (comment-only).
- Share-card WHERE (app.ts:978) checks `isActive` but not `isArchived` (display-only path).
- `ENVIRONMENT_MATRIX.md:72` still describes VITE_OPENWA_DOCS_URL as the built-in Render URL.
- `/healthz/redis` still 503s in the no-Redis shape (same honesty class; admin-gated).
- `api-client-react` generated JSDoc is one description behind (syncs on its owner's next codegen).
- Intentional trade-offs left as designed: requireUser fail-open on DB error, 60s session-liveness
  cache, OTP state oracle (bounded), worker-tier gate semantics, 48h durable replay horizon.

## Operator TODOs (cannot be done from this sandbox)

1. Install the backup crontab line (DISASTER_RECOVERY.md — Automated Backups).
2. Run + record the first restore drill in the drill ledger.
3. Run `./scripts/docker-verify.sh` on the VM (10/10 gates) — no Docker in the sandbox.
4. Push both repos (this round's commits are local until pushed).

## Verification record (this round, at final HEAD)

- Backend: 151 files / 1312 tests / 1312 passed / 0 failed (~410s).
- Frontend: 82 files / 579 tests / 579 passed / 0 failed (~192s).
- openwa: 6 files / 87 tests / 87 passed / 0 failed.
- `pnpm run typecheck` exit 0 (all workspaces) · `pnpm run lint` exit 0 (0 errors, 85 warnings).
- OpenAPI route gate: 79 documented = 79 implemented.
- Drift gate: second `drizzle-kit generate` = "No schema changes" → green post-commit.
- Validator: 46 rules; template run = 9 placeholder errors (exit 1, expected); clean env exit 0.
- `bash -n` both shell scripts; prettier clean on all 62 changed files.
