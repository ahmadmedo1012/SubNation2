# R146 fix notes — workspace skeleton, build/CI/deploy tooling (agent 146-FIX-6)

Implements every actionable finding from `audit-workspace-config.md`.
Method note that governs finding 9 and every grep below: this environment's
shell output display **eats the two bytes `[m` of any literal `main]`** — `printf 'PROBE-[main]-PROBE'` renders as `PROBE-ain]-PROBE` in tool output while `od` hex shows `5b 6d 61 69 6e 5d` (`[main]`). Byte-level checks (`od`/`xxd`) are the only trustworthy read for anything bracketed; `rg`/`sed`/`cat` output is not. This artifact is what produced the "ain]" readings in the r94, R142-lane, and R146-audit reports.

## Finding 1 — CI concurrency group could let a push cancel the weekly sweep
- **Changed:** `.github/workflows/ci.yml:26` — `group: ci-${{ github.workflow }}-${{ github.ref }}-${{ github.event_name }}`; plus one why-comment (lines 22-23) so a future tidy-up doesn't strip the "redundant" event name.
- **Verification:** `yaml.safe_load` OK; group string prints exactly `ci-${{ github.workflow }}-${{ github.ref }}-${{ github.event_name }}`; `cancel-in-progress: true` unchanged. Pushes to main still share `ci-CI-refs/heads/main-push` (older pushes cancel); the Monday 04:17 scheduled run sits alone in `…-schedule`, so the e2e heartbeat and CVE sweep can no longer be cancelled by a push.

## Finding 2 — secrets generator named the wrong OTP HMAC source
- **Changed:** `scripts/generate-production-secrets.sh:94` — one word: `ENCRYPTION_KEY-derived` → `SESSION_SECRET-derived`.
- **Verification:** `backend/src/services/whatsapp-otp.service.ts` (read-only) lines 65-73: default key = `createHmac("sha256", SESSION_SECRET).update("whatsapp-otp-v1")`; the script's own header (lines 23-26) says the same. `bash -n` OK. Script not executed (secrets-generator; output-only by design).

## Finding 3 — three docs pointed round reports at a dead directory convention
- **Changed:**
  - `CONTRIBUTING.md:68-72` — in-flight reports under `docs/engineering/R###/`, executed rounds archived to `docs/history/inspection-r###/` (pre-R141 legacy name); dropped the stale `(R122/R135 policy)` tag that described the superseded convention.
  - `SECURITY.md:52-54` — same convention, "the pre-R141 legacy name" marker added.
  - `README.md:126` — layout line now names both trees: `engineering/R###/ round reports, executed rounds archived to history/inspection-r###/ (pre-R141)`.
- **Verification:** `ls docs/engineering/` → R142 R143 R144 R145 R146 (live rounds all there); `ls docs/history/` → `inspection-r111` … `inspection-r141`-era archives (only pre-R142 rounds use the legacy name).

## Finding 4 — `onlyBuiltDependencies` named three packages not in the tree
- **Changed:** `pnpm-workspace.yaml:59-60` — deleted `@swc/core`, `msw`, `unrs-resolver`; kept `esbuild`.
- **Verification (re-done, not trusted from the audit):** whole-tree `rg --hidden` for the three names → hits only in `pnpm-workspace.yaml` itself plus prose in `docs/` (audit reports, a coverage note). In `pnpm-lock.yaml`: no package entries match `^  msw@` / `^  '@swc/core@'` / `^  unrs-resolver@`; `msw` occurs only as an *optional, unmet* peer spec (`@orval/mock`: `msw: '>=2'` + `optional: true`; `@vitest/mocker`: `msw: ^2.4.9` + `optional: true`) and in `transitivePeerDependencies` lists — never installed, so its build-script allowlist entry was inert. `esbuild`: 99 lockfile hits, kept. `yaml.safe_load` OK.
- **Install note:** `pnpm install` was NOT run (per instructions). Verified `pnpm-lock.yaml`'s `settings:` section carries only `autoInstallPeers: false` + `excludeLinksFromLockfile: false` — it does **not** mirror `onlyBuiltDependencies`, so this edit requires no lockfile refresh; the orchestrator's routine end-of-round install is the resync point if a future pnpm ever starts mirroring it.

## Finding 5 — lint-staged routed md to prettier, which .prettierignore forbids
- **Changed:** `.lintstagedrc.json:3` — `*.{json,css,html,yml,yaml}` (dropped `md`).
- **Verification:** `.prettierignore` ends with `*.md` (+ its rationale comment: prettier mangles prose, two docs carry the scars), so md was never formatted — zero behavior change; JSON parses. The ts/tsx/js glob line untouched.

## Finding 6 — `pnpm clean` missed `shared/error-codes/dist`, carried dead `scripts/dist`
- **Changed:** `scripts/clean-workspace-artifacts.sh:17` — `scripts/dist` → `shared/error-codes/dist` (one line swapped, net 0).
- **Verification:** `shared/error-codes/dist/` exists right now (`index.d.ts` + `index.d.ts.map` + `tsconfig.tsbuildinfo`) — the addition removes a real stale dir. `scripts/tsconfig.json` has `"noEmit": true` and `scripts/package.json` has no build script, so nothing ever emits `scripts/dist`; whole-tree `rg --hidden 'scripts/dist'` → only the clean script itself + audit prose. `bash -n` OK. Script not executed (other agents are mid-work in this tree; deleting dist dirs under them is not my call).

## Finding 7 — rollback runbook cited COOLIFY_FINAL_SETUP.md without its path
- **Changed:** `OPERATIONS_RUNBOOK.md:220` — `` `docs/deployment/COOLIFY_FINAL_SETUP.md` `` (§7 reference kept).
- **Verification:** `ls docs/deployment/COOLIFY_FINAL_SETUP.md` → exists; this now matches the full-path style of every other reference.

## Finding 8 — CVE audit job installed the whole workspace before a lockfile-only command
- **Verification first (outside the repo, per instructions):** built `/home/z/my-project/tmp-audit-verify` containing ONLY `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the 8 `package.json` manifests in workspace layout (root + backend + frontend + scripts + shared/{db,api-zod,api-client-react,error-codes,api-spec}) — no `node_modules`, never installed.
  - `pnpm audit --prod --json` → **exit 0**, valid report (`vulnerabilities: {info 0, low 0, moderate 0, high 0, critical 0}` — the R123-era accepted node-forge/uuid moderates have since cleared at current resolutions).
  - `pnpm audit --json` (dev deps too) → 30 advisories (4 low / 9 moderate / 19 high, incl. `@babel/core`, `picomatch`, `tmp`) — proves live registry resolution and importer coverage from the lockfile alone, no install demanded.
  - Control probe (temp dir with manifests but **no lockfile**) → `ERR_PNPM_AUDIT_NO_LOCKFILE` — proves the lockfile, not `node_modules`, is the audit's data source.
  - Temp dirs cleaned up afterwards.
- **Changed:** `.github/workflows/ci.yml` audit job — deleted the `Install workspace dependencies` step (`pnpm install --frozen-lockfile`, was at lines 226-229) and dropped `cache: pnpm` + `cache-dependency-path` from the job's `actions/setup-node` (was lines 223-224), leaving `node-version: 22` + a two-line why-comment. Checkout, pnpm/action-setup, and node setup all kept, per the audit's "cache-less audit run" wording. Cache rationale: with no install, a restored store is dead download weight, and the post-job save under the shared lockfile-hash key would race the three installing jobs that legitimately own that key. The other jobs' cache config is untouched (verified: only one setup-node hunk in the diff; `yaml.safe_load` shows audit `with: {node-version: 22}`, checks job still `cache: pnpm`).

## Finding 9 — ".hermes.md mangles the branch name as ain]" — **not reproducible; no edit made**
- **Verification (byte-level):** `sed -n '18p' .hermes.md | od -An -tx1z` → …`72 65 20 60 5b 6d 61 69 6e 5d 60 20…` = `re `main` both` — i.e. the line already reads exactly "the filters are `[main]` both for push and PR.)", the exact text the finding asks for. `.github/workflows/ci.yml:9` hex is likewise `branches: [main]` (`5b 6d 61 69 6e 5d`).
- **Root cause of the false positive:** the display-pipeline artifact documented at the top — any literal `main]` printed through shell output loses `[m` and shows as `ain]`. The r146 auditor's rg view, the r127 audit's line 35, r94's `branches: ain]`-under-`workflow_run` claim (attributed to "a sed fix that ate it"), and the R142 lane notes' `pushain]` all show the same artifact. The Read/od tools disagree with rg on the same lines because only rg's raw line contains the contiguous `[main]`.
- **Disposition:** `.hermes.md` is byte-identical to HEAD (`git status --porcelain -- .hermes.md` empty). Nothing to fix; recorded here so no future round "fixes" it again. (The literal `ain]` strings that DO exist in `docs/history/inspection-r94/…` and `docs/engineering/R142/lanes/…` are quoted-audit prose in past-round records — per CONTRIBUTING, past entries are not edited.)

## Net

9 findings: 8 fixed (F1-F8), 1 verified-no-op (F9, false positive with byte-level proof).
Lane diff: 9 files, **+15 / -22 (net -7 lines)**. Both edited shell scripts pass `bash -n`; all YAML/JSON edits parse. `pnpm install` not run (see finding 4 note); no commit/push/deploy/backup performed.
