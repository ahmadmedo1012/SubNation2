# R146 — Workspace skeleton, build/CI/deploy tooling, dependency hygiene (agent 146-AUD-6)

What this part does: the repo skeleton that everything else stands on — the root
`package.json` / `pnpm-workspace.yaml` / tsconfigs / eslint config, the three
GitHub workflows (ci, docker, uptime-monitor), the `Dockerfile` +
`docker-compose.yml` + `.dockerignore`, the `config/` + `deploy/` + `scripts/`
tree (15 files), the four root docs, and every `package.json` in the monorepo
(8 packages). Load assumed: a real public storefront in production
(https://subnation.ly), one long-lived API container in SINGLE_INSTANCE_MODE,
CI on every push to main plus a weekly scheduled full run (CVE sweep + e2e
heartbeat), and a 5-minute external uptime cron.

Method: static reading only, whole-tree greps before every "unused/dead" claim
(including `.github` — note: plain `rg .` skips hidden dirs, so CI references
were checked separately). No test, build, lint, or deploy script was run. One
behavior probe was done outside the repo (a temp file + the repo's own prettier
binary) to settle an ignore-semantics question before reporting it.

Checked and CLEAN (no finding, recorded so the next round does not re-dig):
- Dependency hygiene: every declared dep in all 8 package.json files has a
  real import/usage — including the non-obvious ones: `vite` in backend
  (satisfies vitest 4's `vite` peer, required because `autoInstallPeers=false`),
  `thread-stream`/`pino-pretty` (peers of esbuild-plugin-pino), `@testing-library/dom`
  (peer of @testing-library/react v16), `@lhci/cli` (scripts/validate.ts check
  43.2), `impeccable` (CI ui gate), `qrcode`/`recharts`/`web-vitals`/`motion`
  (dynamic imports in frontend src). Zero removable dependencies. Every
  `catalog:` entry in pnpm-workspace.yaml has a consumer.
- Dockerfile: manifest-first layer ordering, non-root USER, no secrets baked
  (ENV block is public VITE_* + PORT/TZ only), digest-pinned base, deploy-time
  typecheck gate — all match the R122/R127 records; no regressions found.
- docker-compose: default host binds are 127.0.0.1-only on both services;
  openwa gets only its own read-set of env vars; log rotation + stop-grace
  consistent with the app's drain budget. The Dockerfile ↔ compose ↔
  COOLIFY_FINAL_SETUP §2.2 VITE_* build-arg lists are in sync.
- .dockerignore / .gitignore: nested-env, backups, secrets, docs/specs all
  excluded; backend/tests deliberately kept (deploy-time typecheck reads them).
- tsconfigs: every package extends tsconfig.base.json; per-package deltas are
  justified (composite/emitDeclarationOnly for shared, noEmit for apps); no
  drift bug found.
- Root docs link check: every relative link in README.md and docs/README.md
  resolves to a real file; OPERATIONS_RUNBOOK §1–§16 references all exist.
- scripts/: backup-db.ts (retention, partial-file cleanup, gzip CRC verify,
  presigned-upload deadline), backup-cron.sh, preflights, docker-verify.sh,
  dns-cutover-check.sh, restore-drill-check.sh, validate.ts, inspect.ts —
  all referenced (CI, root package.json, or the runbook/docs) and internally
  consistent; the secrets script has one wrong-word comment (finding 2).

Findings below. Nothing previously closed in R143/R144/R145 is re-reported.

## Must fix

None. No correctness, security, or data-loss defect found in this domain at
the expected load.

## Should fix

1. **A push to main can silently cancel the weekly CI sweep — including the
   e2e heartbeat, the only runtime boot guard** (`.github/workflows/ci.yml:23-25`)
   - **What this is:** The workflow-level concurrency group is
     `ci-${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true`.
     Scheduled runs and pushes to main both evaluate to `ci-CI-refs/heads/main`,
     so they share one group.
   - **Problem:** The Monday 04:17 UTC scheduled run (CVE audit + checks +
     tests + build + the weekly e2e heartbeat) runs ~20-30 minutes. Any push
     landing in that window is queued into the same group and cancels the
     scheduled run mid-flight. The replacement push run is code-gated, so the
     `e2e` job (dispatch/schedule-only, ci.yml:577) and usually the `audit` job
     do not run at all. Net effect: the weekly heartbeat is skipped with no
     red run anywhere — the exact silent-drift class R143 L15-1 fixed for the
     selector, reintroduced by cancellation. Pushes to main land most days, so
     over months this will eat heartbeats.
   - **Fix:** Add the event name to the group so pushes never cancel scheduled
     runs: `group: ci-${{ github.workflow }}-${{ github.ref }}-${{ github.event_name }}`.
     Pushes still cancel older pushes (same group), schedules never collide
     with anything but themselves. One line.
   - **If we skip it:** The weekly e2e + CVE coverage is best-effort; a
     Monday-morning push silently voids it, and the first sign of a dead shell
     is a customer report instead of the heartbeat.

2. **The secrets generator names the wrong secret for the OTP HMAC fallback**
   (`scripts/generate-production-secrets.sh:94`)
   - **What this is:** The `OTP_HMAC_KEY_EXPLICIT=1` branch prints
     "only set OTP_HMAC_KEY if you intentionally override the
     ENCRYPTION_KEY-derived default".
   - **Problem:** The default is derived from `SESSION_SECRET`, not
     `ENCRYPTION_KEY` — `backend/src/services/whatsapp-otp.service.ts:58-73`
     (`HMAC(SESSION_SECRET, "whatsapp-otp-v1")`), and the same script's own
     header (lines 23-26) says so. The two statements inside one operator
     script disagree. An operator at 3am rotating `ENCRYPTION_KEY` (the
     documented `ENCRYPTION_KEY_PREV` flow) would wrongly expect in-flight OTP
     codes to die; rotating `SESSION_SECRET` — which really does re-key the
     OTP HMAC — would wrongly be considered OTP-safe.
   - **Fix:** One word: "ENCRYPTION_KEY-derived" → "SESSION_SECRET-derived".
   - **If we skip it:** A future secret rotation makes wrong assumptions about
     which logins break; WhatsApp OTP users see stale codes until re-request.

3. **Three docs point round reports at a directory convention that no longer
   exists** (`CONTRIBUTING.md:70-71`, `SECURITY.md:52-53`, `README.md:126`)
   - **What this is:** All three say in-flight audit/inspection reports live
     under `docs/inspection-r###/` and are archived to `docs/history/inspection-r###/`.
   - **Problem:** No `docs/inspection-*` directory exists anywhere — the last
     one (r134) already sits under `docs/history/`. Since R142 the live
     convention is `docs/engineering/R###/` (R142 lanes, R143 findings,
     R144 ledger, R145 defect map all live there). A contributor following
     CONTRIBUTING.md creates `docs/inspection-r146/` and splits round records
     across two trees; a security reporter following SECURITY.md cannot find
     the published reports the doc promises.
   - **Fix:** Update the three lines to say: in-flight under
     `docs/engineering/R###/`, executed-round archives under
     `docs/history/inspection-r###/` (pre-R141 legacy name).
   - **If we skip it:** Round records keep fragmenting; every future reader
     re-discovers the real path by grep.

## Nice to have

4. **`onlyBuiltDependencies` names three packages that are not in the tree**
   (`pnpm-workspace.yaml:59-63`)
   - **What this is:** The postinstall allowlist lists `@swc/core`, `esbuild`,
     `msw`, `unrs-resolver`.
   - **Problem:** Only `esbuild` exists in `pnpm-lock.yaml` — `@swc/core`,
     `msw`, and `unrs-resolver` appear nowhere in the lockfile (msw survives
     only as an *optional, unmet* peer of `@orval/mock`/`@vitest/mocker`). The
     three entries are dead config that reads as if those packages were part
     of the build.
   - **Fix:** Delete the three dead lines (keep `esbuild`).
   - **If we skip it:** Misleading supply-chain surface claims; a reader
     auditing build-script permissions chases packages that are not installed.

5. **lint-staged routes `md` files to prettier, which the repo forbids from
   touching md** (`.lintstagedrc.json:2` vs `.prettierignore` `*.md` entry)
   - **What this is:** The prettier task glob is
     `*.{json,md,css,html,yml,yaml}` while `.prettierignore` excludes `*.md`
     (documented: prettier mangles prose — two docs carry the scars).
   - **Problem:** Verified with the repo's own prettier (3.9.9): explicitly
     passed files that match `.prettierignore` are skipped silently. So the
     `md` token in the lint-staged glob is dead — md is never formatted on
     commit, only json/css/html/yml are. Corollary: the 144-F8 worklog claim
     that "lint-staged ran prettier --write over the md set and auto-staged
     the reformats" cannot be true for `.md` files — worth knowing so that
     claim is not copied forward.
   - **Fix:** Drop `md` from the glob: `*.{json,css,html,yml,yaml}`. Zero
     behavior change; the config stops promising something it never did.
   - **If we skip it:** Every docs commit invokes prettier on files it then
     skips; agents reading the config believe md is prettier-formatted.

6. **`pnpm clean` misses `shared/error-codes/dist`** (`scripts/clean-workspace-artifacts.sh:10-19`)
   - **What this is:** The clean script removes build output for frontend,
     backend, scripts, and three of the four shared packages.
   - **Problem:** `shared/error-codes/dist` (which exists — declarations +
     `tsconfig.tsbuildinfo`) is not on the list, so a "clean workspace
     artifacts" run leaves one package's stale build output behind. The
     `*.tsbuildinfo` find-delete does run, so typecheck recovers; only the
     stale `dist` lingers.
   - **Fix:** Add `shared/error-codes/dist` to the `rm -rf` list (and drop
     `scripts/dist`, which no build ever emits).
   - **If we skip it:** Mostly cosmetic; a stale declaration dir survives a
     cleanup whose job is to remove exactly that.

7. **The rollback runbook names a doc without its path** (`OPERATIONS_RUNBOOK.md:220`)
   - **What this is:** Rollback step 1 (deploy the previous commit) cites
     "COOLIFY_FINAL_SETUP.md §7" as a bare filename.
   - **Problem:** The file is at `docs/deployment/COOLIFY_FINAL_SETUP.md`;
     every other reference in the runbook and in docker-compose.yml uses the
     full path. During a rollback at 3am the bare name forces a find-the-file
     detour in the most time-pressured section of the runbook.
   - **Fix:** Prefix with `docs/deployment/`.
   - **If we skip it:** A few lost minutes in a rollback; the section
     otherwise still names the right panels.

8. **The CVE audit job installs the whole workspace before a lockfile-only
   command** (`.github/workflows/ci.yml:226-229`)
   - **What this is:** The `audit` job runs `pnpm install --frozen-lockfile`
     (full workspace, all dev deps) before `pnpm audit --prod`.
   - **Problem:** `pnpm audit` resolves from `pnpm-lock.yaml` — it does not
     read `node_modules`. The install costs ~1-3 minutes per deps-change push
     plus weekly and dispatch runs, and buys nothing the lockfile does not
     already provide. (Verify once on a clean clone without `node_modules`
     before deleting; if `pnpm audit --prod` passes there, the step is pure
     overhead.)
   - **Fix:** Delete the install step (keep checkout + pnpm setup + node
     setup for the cache-less audit run), or gate it behind the verification.
   - **If we skip it:** A couple of runner-minutes per audit run — free on a
     public repo, but it contradicts the file's own cost-gating philosophy.

9. **`.hermes.md` mangles the branch name as "ain]"** (`.hermes.md:18`)
   - **What this is:** The agent contract says the CI branch filters are
     "`ain]` both for push and PR" (the mangled rendering of `main`, inherited
     from the r127 audit's line 35, which garbled `[main, develop]` the same
     way).
   - **Problem:** A new agent reading the highest-authority contract file
     cannot tell that "ain]" means the `main` branch; the string also fails
     any grep for "main".
   - **Fix:** Rewrite as "the filters are `[main]` both for push and PR".
   - **If we skip it:** One more decoding tax on every agent session that
     reads the contract.

## Verdict

`Verdict:` Healthy skeleton with unusually deep in-file rationale — zero
must-fix defects; fix the CI concurrency group (finding 1) next so the weekly
heartbeat cannot be silently cancelled, then the one-word fixes (2, 7, 9) and
the doc path (3).

`Lean: -6 lines, -0 dependencies possible.` (findings 4 and 8 delete ~6
config/CI lines; finding 5 trims a dead glob token; finding 6 adds one line
back. No dependency is removable — every declared dep verified used. The
skeleton is already tight; most findings are one-word corrections, not bloat.)

`Not checked:` pnpm-lock.yaml contents and resolved versions (skipped per
instructions); `.gitleaks.toml` rule-by-rule correctness (16 KB, previously
audited R130/R144); the inner logic of `scripts/src/validate-production-env.ts`
and `scripts/src/import-seo.ts` (spot-checked env keys only); vite.config.ts /
vitest.config.ts internals beyond the budget-gate numbers (frontend-domain
agents' territory); GitHub branch-protection / repo Settings (not visible in
the tree); behavior of any script actually executed (read-only audit).
