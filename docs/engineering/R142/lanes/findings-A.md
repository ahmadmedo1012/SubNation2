# R142 Lane A — Repository truth & source-to-runtime map + infrastructure/CI/scripts audit

Task ID: 142-A1 · Agent: lane-A subagent · HEAD: `a9f5e83` (tree clean except this round's `docs/engineering/` outputs) · Mode: read-only.
Coverage: 63/63 inventory files (61 deep-read, 2 historical data artifacts skim-claimed; CHANGELOG full-read last 3 rounds + R130, skim R125–R138). 0 BLOCKED.

**What this repo does:** a single-origin Libyan-Arabic RTL e-commerce platform — Express 5 API + Socket.IO + boot-migrating Postgres layer and a React 19/Vite SPA served by that same API from one Docker image, deployed by Coolify push-to-deploy on a Contabo VM with Neon external. **Load assumed:** one production container (SINGLE_INSTANCE_MODE), one nightly backup run, CI on every push to main. Nothing in this lane requires scaling beyond that.

**Gates re-executed at HEAD during this audit (evidence, not claims):**
- OpenAPI parity gate: **exit 0 — 84 implemented operations**, all documented or allowlisted.
- ErrorCode sync gate: **exit 0 — 55 codes agree in both directions.**
- `eslint backend frontend shared scripts`: **0 errors / 49 warnings** — the exact R139–R141 committed baseline.
- `impeccable detect frontend/src/`: **exit 0** (1 advisory, non-blocking by design).

---

## 1. Source-to-runtime map (verified against files, not docs)

### Build pipeline (Dockerfile, 3 stages)

| Stage | What happens | Verified by |
|---|---|---|
| `deps` | `corepack enable`; copies root manifests + **every** workspace `package.json` first; `pnpm install --frozen-lockfile` with a pnpm-store cache mount | Dockerfile:39–52 |
| `build` (FROM deps) | `COPY . .` (context filtered by `.dockerignore`: no `.env*`, docs, `.kiro`, backups); declares 17 `VITE_*`/`RENDER_GIT_COMMIT`/`GIT_SHA`/`SOURCE_COMMIT`/`SENTRY_*` ARGs → re-exports the VITE set as ENV so Vite can inline them at build time; **`pnpm run typecheck` as a deploy-time gate** (R122 A9-P0-2: Coolify's webhook builds without waiting for CI, and esbuild/vite don't typecheck); then `pnpm --filter @workspace/api-server run build` with `VITE_RELEASE_SHA="${GIT_SHA:-${SOURCE_COMMIT:-…}}"` — backend esbuild bundle (`build.mjs`, entrypoints `src/index.ts` + `src/worker.ts`, sourcemap upload only when the Sentry token trio is present) **chaining the Vite SPA build** (`backend/package.json` build → `pnpm --filter @workspace/subnation run build`) | Dockerfile:54–192; backend/build.mjs:82–96; frontend/vite.config.ts:1153–1155 (`outDir dist/public`) |
| `runtime` | manifest-first `pnpm install --frozen-lockfile --prod --ignore-scripts --filter @workspace/api-server...` (husky `prepare` defused, R109 P0-1; corepack cache deleted in the same layer, R127-L4/B10-F4); copies `backend/dist` + `frontend/dist` **only** (TS sources never ship); `rm -f backend/dist/worker.mjs` (no worker tier exists — `WORKER_TIER` unset, all crons in-process); `chown -R node:node`; `USER node`; `HEALTHCHECK wget /api/healthz` (interval 30s, start-period 150s, retries 3); `CMD ["node","--enable-source-maps","backend/dist/index.mjs"]` — node is PID 1, SIGTERM reaches drain handlers without a pnpm hop | Dockerfile:194–302 |

### Entrypoints and their roles (all verified in source)

| Entrypoint | Role | Reached by |
|---|---|---|
| `backend/src/index.ts` | first `./lib/env` (env file loading + validation), then `./server` | Docker CMD (dist/index.mjs); `pnpm --filter @workspace/api-server start` |
| `backend/src/server.ts` | Sentry instrument FIRST → app → **port binds before migrations** (`listen()` at :371, `bootMigrations()` at :225 in bootstrap) so `/api/healthz` answers 503 "starting" while migrations apply, then the readiness gate opens; web schedulers + Socket.IO init; 25s default drain (`GRACEFUL_SHUTDOWN_TIMEOUT_MS`, env-tunable) | via index.ts |
| `backend/src/migrate.ts` | the idempotent boot reconciler — **the only schema authority** (no `db:push`; the root script is a tripwire: `shared/db/scripts/guard-drizzle-push.mjs` exits 1 without `I_ACCEPT_DRIZZLE_PUSH_DANGER=true`). v2 fingerprint fast-path skips the replay when the stored marker matches the build-time corpus hash | bootMigrations() |
| `backend/src/worker.ts` | standalone worker tier entry (heartbeat, cron jobs, redis) — **compiled but stripped from the runtime image** (`rm dist/worker.mjs`); dormant by design, all crons run in the web process under SINGLE_INSTANCE_MODE | esbuild entry only |
| `backend/src/lib/spa-shell.ts` | serves the SPA: resolves `FRONTEND_DIST` (env → `frontend/dist/public`) with code-default fallbacks; per-route SEO meta rewrites + SPA fallback; non-`/api` health paths return the SPA HTML | app.ts:307–311 |
| `scripts/src/dev.ts` / `start.ts` | local dev/prod orchestrators (port auto-pick, labeled output, child-exit propagation). The Docker image **bypasses** them (direct node CMD) | root `pnpm dev` / `pnpm start` |
| `scripts/src/seed.ts`, `backup-db.ts`, `import-seo.ts`, `validate-production-env.ts` | operator scripts (idempotent seed w/ prod default-password refusal; pg_dump+gzip w/ PG\* env decomposition; dry-run-default SEO importer; env file validator) | root scripts / cron |
| CI gate scripts | `check-openapi-routes.ts`, `check-error-code-sync.ts` (both re-run green at HEAD, see above) | ci.yml `checks` job |

### Runtime topology (docker-compose.yml — the LOCAL/bare-VM path; Coolify builds the Dockerfile directly and never reads this file, documented at compose:74–80)

- `subnation` :8080 (host bind default `127.0.0.1:3000`), env_file `.env`, `stop_grace_period: 40s` > 25s in-app drain, log rotation 10m×3, restart unless-stopped, healthcheck mirrors the Dockerfile's.
- `openwa` :2785 (external image / sibling clone), **scoped env allowlist** (FH-A2: only the 10 vars the gateway actually reads — no SubNation secrets leak into the gateway container), volume for Baileys auth state, `stop_grace_period: 15s` > 4s gateway flush.
- Single-origin contract: VITE_API_BASE_URL / VITE_SOCKET_URL / VITE_API_URL deliberately **absent** from the compose build args.
- `deploy/env.compose.example` documents the required runtime set; `SINGLE_INSTANCE_MODE=true` is the pinned production contract (never >1 replica).

**Map verdict: the documented map is the real map.** Every entrypoint exists, every claim in the Dockerfile/compose comments checked out against the files they describe. The one image-size figure found ("~300–330 MB estimated") lives in a deprecated doc and is explicitly labeled an estimate — not re-verifiable statically (no Docker daemon in this sandbox).

---

## 2. CI job truth table (`.github/workflows/ci.yml`, read completely — 569 lines)

Triggers: push[main], pull_request[main], **workflow_dispatch (full run available ✓)**, schedule Mon 04:17 UTC. `concurrency` cancels in-progress per ref. Default permissions `contents: read`; every `uses:` is SHA-pinned with `persist-credentials: false` (checked all 6 distinct actions).

| Job | Needs | Runs when | What it actually does (verified) | Silent-pass risk |
|---|---|---|---|---|
| `secret-scan` | — | **every trigger incl. docs-only** | TOML-validates `.gitleaks.toml`, gitleaks-action pinned 8.27.2 (global-allowlist fix), SARIF upload is `continue-on-error: true` — documented rationale ("the scan itself is the source of truth") | None on the scan; SARIF upload loss is accepted+documented |
| `filter` | — | every | dorny/paths-filter → `code` (backend/frontend/shared/scripts/config/deploy/package.json/lockfile/workspace/tsconfig/ci.yml/Dockerfile/compose) + `deps` (lockfile + every package.json) | — |
| `audit` | filter | schedule, dispatch, or deps changed | `pnpm audit --prod \|\| true` (informational, labeled) + high inventory with explicit `exit 0` (labeled) + **the real gate: `pnpm audit --prod --audit-level critical`** | The two swallow steps are labeled informational and the gate step is genuine; current posture (0 critical, 1 accepted HIGH node-forge) matches lane H |
| `checks` | secret-scan, filter | schedule, dispatch, or code | impeccable UI gate (**re-run: exit 0**), lint (**0/49 at HEAD**), typecheck, OpenAPI parity (**re-run: 84 ops, exit 0**), ErrorCode sync (**re-run: 55 codes, exit 0**), migration drift (`drizzle-kit generate` + `git diff --exit-code`; synthetic DATABASE_URL present in job env, required by drizzle.config.ts), orval drift (codegen + `git diff`) | **A-2**: coverage thresholds promised "land in R137" never landed — see findings |
| `tests` | secret-scan, filter | same as checks | matrix backend/frontend, `test:coverage`; coverage artifact retention 7 days, `if-no-files-found: warn` | Threshold enforcement absent (A-2); tests themselves still hard-fail |
| `build` | secret-scan, filter | same | api-server build chains Vite SPA build incl. bundle-budget + CSP inline-script gates | None found |
| `e2e` | — (none) | **dispatch/schedule ONLY** | Playwright chromium vs `E2E_BASE_URL` (repo variable, default localhost:8080 fails loudly — and runbook §14 records the variable has been SET to subnation.ly since R130) | None; the skip-on-push is by design (guest suite needs a live stack) |

**Docs-only push behavior (verified):** secret-scan + filter run; audit/checks/tests/build are skipped by the job-level `if`. The R130 incident (43-second push burst + a red gate "fixed" by docs-only pushes) is honestly recorded in CHANGELOG and the mitigation (dispatch re-run + weekly schedule) is wired.

**docker.yml (read completely):** disaster-recovery GHCR publisher — dispatch + `v*` tags only, amd64-only leg + imagetools merge that probes the registry for what actually landed and **fails if amd64 is missing**. Honest standing STATUS block: no completed publish on record; operator dispatch outstanding (cross-checked with compose header note). Not part of the deploy path.

---

## 3. Env-var coverage (census vs `config/env.example`)

Census at HEAD (non-test source, tracked files only): **328 env reference sites / 139 distinct vars** (120 `process.env.*` + 19 `import.meta.env.*`, of which 2 are Vite builtins). The inventory's "629 sites" figure counts test files too. `config/env.example` documents **128 entries** plus comment-documented knobs.

| Category | Vars | Verdict |
|---|---|---|
| Documented (entry form) in env.example | 94 of the 120 process.env vars + most VITE_ vars | ✅ |
| Documented only as comments/prose | WORKER_TIER_ID (env.example:432), GIT_SHA, SENTRY_\*, scheduler/migration/OTP/health knobs (env.example "Tuning knobs" section) | ✅ |
| Platform/build-injected, documented in Dockerfile/compose/ENVIRONMENT_MATRIX | RENDER_GIT_COMMIT, SOURCE_COMMIT, RENDER_INSTANCE_ID/SERVICE_NAME/SERVICE_ID/DEPLOY_ID/REGION/GIT_BRANCH (FINAL_PRODUCTION_ENV.md:163 "display only"), NODE_ENV | ✅ (documented elsewhere; env.example omission acceptable) |
| Script/test-local flags (documented in their own files) | E2E_ENABLED, E2E_BASE_URL, CI, CHECK_ERROR_CODE_SYNC_YAML, DEBUG_ROUTES, IMPORT_SEO_APPLY, I_ACCEPT_DRIZZLE_PUSH_DANGER, API_PROXY_TARGET, VITE_API_PROXY_TARGET, VITE_OPEN | ✅ (fine as-is) |
| **Real gaps** | VITE_GSC_VERIFICATION, VITE_OPENWA_DOCS_URL, BACKUP_DIR, BACKUP_PRESIGNED_PUT_URL, JWT_SECRET, FRONTEND_DIST | **A-5** |

---

## 4. Findings

### A-1 (P4) — `scripts/validate.ts` claims a suite that can never pass, and cites a runbook that doesn't exist
- **What this is:** the "Phase 7 validation suite" (`pnpm validate:suite`).
- **Problem:** of its 10 checks only lighthouse/sitemap/robots execute. `checkFirebase/checkOtp/checkRedis/checkSocket/checkAdmin/checkMobile` are hardcoded `status:"fail"` stubs (validate.ts:544–608) and `checkSentry` **always** returns fail (transport not implemented — at least honestly labeled, :523–531). So `main()` can never return 0. Meanwhile the header (:5–29) and `--help` (:717–751) still enumerate responsibilities including "**Run worker heartbeat freshness check**" — a check with **no implementation anywhere in the file** (not in the `checks` array at :617–629, no function). Worse, the failure alert's `runbookUrl` (:171) is `https://github.com/subnation/subnation2/blob/main/MONITORING_RUNBOOK.md#validation-suite-failure` — wrong org (repo is `ahmadmedo1012/SubNation2`) **and** no `MONITORING_RUNBOOK.md` exists at the root (the on-call doc is `OPERATIONS_RUNBOOK.md`).
- **Concrete case:** an operator paged by a validation timeout clicks the alert's runbook link → GitHub 404 on a repo that doesn't exist. Anyone reading `--help` believes a worker-heartbeat check ran.
- **Fix:** (1) delete the phantom "worker heartbeat" line from header+help and mark the six stubs as not-implemented (or delete them); (2) point `runbookUrl` at `OPERATIONS_RUNBOOK.md` on the correct org. ~10 lines, no behavior change (the suite already fails loudly and honestly per-check).

### A-2 (P3) — CI coverage gate: thresholds promised "land in R137" — five rounds later they still don't exist
- **What this is:** ci.yml `tests` job, step "Run the … suite (coverage)".
- **Problem:** the in-file comment says "REPORT-ONLY this round: thresholds land in R137 calibrated against the first CI runs' artifact numbers" (ci.yml:447–452), and CHANGELOG R136 repeats it twice ("thresholds land R137 calibrated against the first CI artifacts" + the round's follow-up list). R137's own entry contains **zero** coverage-threshold work, and at HEAD neither `backend/vitest.config.ts` (:23–42) nor `frontend/vitest.config.ts` (:55–72) has a `thresholds` key — the coverage block is provider/reporter/include/exclude only. `test:coverage` is therefore behaviorally `test:run` plus an artifact.
- **Concrete case:** a round that deletes a test file and the code it covered now ships with CI reporting "Unit tests (backend) ✅" and a coverage artifact, while the documented plan said coverage regression would be red by R137. The gate's name promises enforcement the config never got.
- **Fix:** either land calibrated `thresholds` in both vitest configs (numbers exist in the 7-day CI artifacts) or replace the stale comment with "report-only by standing decision — enforcement deliberately deferred" and strike the CHANGELOG follow-up. One comment edit closes the truth gap today.

### A-3 (P4) — CHANGELOG R140/R141 ship unfilled `<R140-SHA>` / `<R141-SHA>` placeholders
- **What this is:** the round ledger's commit evidence.
- **Problem:** CHANGELOG.md:65 ("Commit `<R141-SHA>`.") and :80 ("Commit `<R140-SHA>`.") are literal template tokens — the entries were written before their commits existed and never backfilled. R139 by contrast carries a real SHA (`88cdb47`). CONTRIBUTING.md's own convention: "every claim … carries its evidence — file:line, command output, or a live probe."
- **Concrete case:** anyone tracing R141's "Verified centrally" block to its commit gets a placeholder, not a ref — the exact evidence-trail break the repo's ledger exists to prevent.
- **Fix:** backfill `a9f5e83` (R141) and `3ba4ef1` (R140 code commit) — or link the round to its tag/short SHA via the release ledger. Two-line edit.

### A-4 (P4) — README/CONTRIBUTING suite counts are 11–12 rounds stale
- **What this is:** public-facing contributor docs.
- **Problem:** README.md:163–168 claims "frontend 180 test files / 1,255 tests · backend 242 test files / 2,246 tests (recounted at the R130 round close)"; CONTRIBUTING.md:31–32 (undated) claims "backend suite (242 files)" / "frontend suite (178 files)". Actual at `a9f5e83`: **backend 255 test files, frontend 243 test files** (R141's own CHANGELOG records frontend 243 files / 2,306 tests — the growth is real, the docs weren't refreshed).
- **Concrete case:** a contributor sizing the suites before a PR reads numbers ~200 files off; the undated CONTRIBUTING figures look like current truth.
- **Fix:** refresh both (README's are at least dated), or drop file counts from CONTRIBUTING in favor of "the suites grow every round — see CHANGELOG". CONTRIBUTING also implies `E2E_BASE_URL` is still unset while runbook §14 (R130) records it set — one clause fixes that too.

### A-5 (P4) — env.example gaps: two production build args, two backup vars, one undocumented legacy alias
- **What this is:** `config/env.example` — the "fully annotated environment reference" (README:129) the Dockerfile explicitly says to keep in sync ("keep this list in sync with the VITE_* build args in docker-compose.yml and the Coolify build-args panel", Dockerfile:73–75).
- **Problem:** (1) **`VITE_GSC_VERIFICATION`** and **`VITE_OPENWA_DOCS_URL`** are real production build args (Dockerfile ARGs :108/:114, compose args :105/:114, ENVIRONMENT_MATRIX.md rows 70/72) but are absent from env.example's frontend build-time section — the one doc that claims completeness. (2) **`BACKUP_DIR` / `BACKUP_PRESIGNED_PUT_URL`** (operator runtime vars consumed by `scripts/src/backup-db.ts` + backup-cron/preflight) are documented only in DISASTER_RECOVERY.md. (3) **`JWT_SECRET`** is an undocumented legacy alias silently honored as a SESSION_SECRET fallback by `scripts/src/dev.ts:13` and `start.ts:6` — an operator carrying the old var gets a different signing secret than the docs describe. (4) `FRONTEND_DIST` (runtime path override, Dockerfile ENV) appears in no env doc. Minor same-file nit: "used by `npm run db:seed`" — the workspace is pnpm-only.
- **Concrete case:** an operator filling `.env` from env.example alone never learns they can set the GSC token or the off-VM backup target there, and can't discover the JWT_SECRET alias trap.
- **Fix:** add the six rows (VITE_GSC_VERIFICATION + VITE_OPENWA_DOCS_URL under build-time; BACKUP_DIR/BACKUP_PRESIGNED_PUT_URL under a backup section; JWT_SECRET as a "legacy alias, do not set" note; FRONTEND_DIST under runtime/ports). ~12 lines.

### A-6 (P4) — `dns-cutover-check.sh` depends on `rg` without checking for it, and misreports live DNS state when it's absent
- **What this is:** the pre-DNS-cutover readiness check (operator-facing).
- **Problem:** line 44: `dig +short A "$DOMAIN" @1.1.1.1 | rg '^[0-9]+\.' | head -1 || true`. The script `need`s curl and dig/nslookup (:33) but not rg. Ripgrep is an audit-sandbox tool, not a standard VM package. When it's missing, the pipeline fails inside the `|| true` and `A_NOW` stays empty — and line 45 then prints "**no A record published yet (first-time cutover)**" even when the A record exists.
- **Concrete case:** mid-cutover on the Contabo VM (no rg installed), the operator is told the domain has no A record — the opposite of the truth they need before flipping DNS. Display-only (no gate consumes A_NOW), but this script's entire job is operator truth.
- **Fix:** `grep -E '^[0-9]+\.'` (portable) or add `need rg` alongside curl/dig. One word.

### A-7 (P4) — retired-Render residue in the production start path
- **What this is:** `scripts/src/start.ts:18` — `const origin = process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? \`http://127.0.0.1:${port}\``.
- **Problem:** `RENDER_EXTERNAL_URL` is a Render-platform injection that can never exist on Coolify/compose (Render retired 2026-10-05 per .hermes.md). The fallback is operationally dead, undocumented in env.example/ENVIRONMENT_MATRIX, and its only doc appearances are r97-era history notes about the old **openwa** keep-alive. The repo pruned `render.yaml`/`vercel.json` completely (verified: 0 tracked files), and the Dockerfile's remaining `RENDER_GIT_COMMIT` ARG is deliberately documented as a legacy release-identity fallback — this one isn't.
- **Concrete case:** none today (the var can't be set on the live platform) — it's dead code that reads as if the Render split still exists.
- **Fix:** drop the middle term. One-line deletion; behavior identical on every supported platform.

### Cross-references (found by sibling lanes, confirmed present here — not re-filed)
- **H-2 (P4):** `SENTRY_AUTH_TOKEN` flows as a Docker **build ARG** (Dockerfile:185–192) — build-stage layer history exposure; final image unaffected. Confirmed in source.
- **B-4 (P4):** favicon.svg size claim 163B→355B stale in a doc. Confirmed 355 bytes.
- **Positive verifications worth recording:** root `package.json:db:push` is a **tripwire, not a violation** (routes to `shared/db/scripts/guard-drizzle-push.mjs`, exits 1 without `I_ACCEPT_DRIZZLE_PUSH_DANGER=true` — .hermes.md non-negotiable #1 holds); `pnpm-workspace.yaml` is the single overrides home with `minimumReleaseAge: 1440` and package.json carries none (R119-B3 discipline intact); the preinstall guard deletes stray lockfiles and enforces pnpm; husky→lint-staged→eslint/prettier wiring is intact end-to-end.

---

## 5. Hunt results (charter item 7 — things checked and NOT found)

- **Gates that silently pass:** none beyond the labeled-informational audit steps and A-2's missing thresholds. `grep -c … || true` patterns in docker-verify.sh all still compare the count and fail on mismatch. `curl … || true` captures are followed by explicit code checks. restore-drill's `scalar()` swallows psql errors into empty → counted as MISSING (fails loud, correct direction).
- **Dead scripts:** none. Every scripts/ file is either CI-invoked (2), root-script-wired (dev/start/seed/backup/clean/validate:env/import-seo), operator-documented (5 shell scripts in active deployment/disaster docs), or spec-history tooling that still imports a real module (inspect.ts).
- **Retired-path references:** vercel.json/render.yaml/deploy.yml — 0 tracked files. Retired-platform env reads remaining in live code: exactly one (A-7). Dockerfile/compose/CHANGELOG mention Render only in deliberately-marked legacy comments.
- **Accidental credentials in tracked files:** none found in this lane's 63 files (placeholders only, by design; gitleaks + lane H's deep pass corroborate). No P0 to report.
- **Doc-vs-code contradictions:** A-2/A-3/A-4 above are the full set found in root docs. README's CI description, SECURITY.md's claims, the runbook's rollback chain, and .hermes.md's CI list all verified accurate against ci.yml at HEAD.

## Not checked
- `docker build` / `docker-verify.sh` execution (no Docker daemon in this sandbox — the script's own header notes this is its purpose on a Docker host); live GHCR package state; image size (~300–330 MB claim is in a deprecated doc, labeled estimate).
- CHANGELOG R125–R138 read at claims level only (round narratives skimmed for infra claims; full prose not line-audited); `docs/` tree beyond the files cited (owned by other lanes).
- Network-dependent verifications (repo public flag, live probes) — lane H/G ran those this round.

## Verdict
**Healthy.** The source-to-runtime map is fully truthful — every entrypoint, stage, and claim in the infra layer checks out against the code, and the CI gates do exactly what their names promise (both contract gates and the lint baseline were re-executed green during this audit). No P0–P2. Seven small findings, all documentation/truth-hygiene: one stale CI promise (A-2), two evidence-trail nicks in the ledger (A-3/A-4), and four one-line-class cleanups (A-1, A-5, A-6, A-7). Highest value per line: A-2's comment fix (kills a five-round-old false expectation) and A-5's six env.example rows (the operator's single reference doc).

Lean: −0 lines strictly required; A-7 deletes one term, A-1 deletes several claim lines — net negative if taken.
