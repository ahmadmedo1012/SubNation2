# R127-B9 — CI/CD Pipeline + Repo Surface Audit

- **Agent:** R127-B9 (read-only auditor; only writes = this report + one worklog append; no commits, no installs into the repo)
- **Repo:** `SubNation2` @ HEAD `f53a886` = `origin/main` = production (verified: `git rev-parse HEAD` → `f53a886d1cbd74e35a6926ce9f3aef6ca0da2f1`, tree clean except untracked `docs/inspection-r127/`)
- **Scope:** `.github/workflows/ci.yml` (366 L) + `docker.yml` (243 L) line-by-line · supply-chain posture · **actionlint v1.7.12 (run)** · **zizmor v1.30.1 (run)** · efficiency · docker.yml vs Coolify · repo-surface residue post-R126
- **Predecessors (not re-reported):** R126-A12 (docs/repo truth register D1-D10, R1-R8), R127-T1 (tool research: gh / actionlint / zizmor / CodeQL / Knip), B1 (orval drift), B2 (Knip inventory), B3 (impeccable CI plan), B4 (live perf incl. budget-gate basis), B5 (PWA)
- **Tool runs:** actionlint 1.7.12 + shellcheck 0.10.0 integration → **0 errors**; zizmor 1.30.1 (`--offline`) → **13 findings (10 shown, 3 auto-suppressed): 4 high, 6 medium, 0 low/info**

---

## 0. Executive summary

The pipeline is in **unusually good shape for a solo public repo**: least-privilege workflow-level `permissions: contents: read`, job-level escalation only where justified (SARIF upload), `concurrency` with cancel-in-progress, `timeout-minutes` on every job, synthetic (non-secret) env values in the quality job, **9 of 12 action references SHA-pinned** with the r110 discipline documented in-file, no `pull_request_target`, no repo secrets exposed to any workflow, and a path-filter cost gate that drops docs-only pushes from ~19 min to ~2 min. actionlint is **completely clean** (with shellcheck enabled). Every gate claim in the worklog's CI story verifies against the YAML (§1 table).

The residue is concentrated in exactly two places: **(a) the `e2e` job** — the only 3 unpinned action references in the repo (zizmor High ×3), missing `HUSKY=0`, missing `cache-dependency-path`, and an undocumented repo-variable dependency; **(b) `docker.yml`** — its R107 "Oracle ARM64" rationale is dead (production = Contabo, R117), its arm64 leg burns 15-25 min QEMU per publish for a platform nothing consumes, and its own "NOT YET VERIFIED" banner is still standing a week after the `v0.0.1-coolify-test` tag run that was never recorded as verified — while the rollback runbook *depends* on the `sha-<short>` GHCR tags this workflow is the only publisher of. On the repo surface, R126's A12 plan largely landed truthfully (13 of 16 register items verified closed at HEAD); one **new** drift instance appeared anyway: `CONTRIBUTING.md` still carries the pre-R126 suite counts (231/148 vs truth 234/159).

**Findings: P0 0 · P1 0 · P2 1 · P3 6 · P4 2.** Top efficiency win: split the monolithic `quality` job (~13-17 min per its own comment) into parallel suites/build jobs → est. **−4 to −8 min wall-clock per code push**.

---

## 1. ci.yml step map + gate-claim verification

### 1.1 Job graph (order as declared; ✱ = gated by `filter` job outputs)

| # | Job (line) | Runs when | Steps (order) | Caching | Timeout |
|---|---|---|---|---|---|
| 1 | `secret-scan` (:31) | **always** (incl. docs-only pushes — deliberate, :100-103) | checkout **fetch-depth: 0** → TOML-validate `.gitleaks.toml` (python3 heredoc) → gitleaks 8.27.2 → upload SARIF (`if: always() && hashFiles('results.sarif') != ''`, `continue-on-error`) | — | 10 m |
| 2 | `filter` (:104) | always | checkout → `dorny/paths-filter` (`code` = 13 path globs, `deps` = lockfile + `**/package.json`) | — | 3 m |
| 3 | `audit` (:172) | schedule ∨ dispatch ∨ `deps`✱ | checkout → pnpm → node 22 → `pnpm install --frozen-lockfile` → audit summary (all sev, `\|\| true`) → high inventory (warn) → **gate: `pnpm audit --prod --audit-level critical`** | setup-node `cache: pnpm` + lockfile dep-path | 10 m |
| 4 | `quality` (:240) | schedule ∨ dispatch ∨ `code`✱ | checkout → pnpm → node 22 → install → **lint → typecheck → OpenAPI↔Express parity → drizzle drift (generate + `git diff --exit-code`) → orval drift (codegen + diff) → backend vitest → frontend vitest → production build** | same | 25 m |
| 5 | `e2e` (:347) | **workflow_dispatch only** | checkout@v4 → pnpm@v4 → node@v4 → install → Playwright chromium → guest suite (`E2E_ENABLED=1`, `E2E_BASE_URL: vars.E2E_BASE_URL \|\| localhost:8080`) | `cache: pnpm`, no dep-path | 20 m |

Workflow-level: `permissions: contents: read` (:24-25), `concurrency: cancel-in-progress: true` (:19-21), triggers = push/PR `[main, develop]` + dispatch + weekly cron `17 4 * * 1` (:3-15).

### 1.2 Worklog gate claims vs YAML (the R127-T1 summary: "secret-scan, lint, typecheck, drift gates, both suites, build, budget, CSP gate")

| Claimed gate | Verdict | Evidence |
|---|---|---|
| secret-scan | ✅ | :31-94, always-on, full-history, SARIF → Security tab (:83-94) |
| lint | ✅ | :282 `pnpm run lint` (root script: eslint over backend/frontend/shared/scripts) |
| typecheck | ✅ | :285 (project refs + per-package, matches R126's widened programs) |
| drift gates | ✅ ×3 | OpenAPI parity :287-295 · drizzle migration :297-308 · orval :310-321 (B1 re-ran the codegen command at HEAD: **drift-free**) |
| both suites | ✅ | backend :324 + frontend :331 (code-gated, not literally "every push" — see F6) |
| build | ✅ | :337 → `api-server` build chains the Vite SPA build (`backend/package.json:8`) |
| budget | ✅ | inside the vite build — entry 55 KiB fail (vite.config.ts:114), eager path 145 KiB warn / 160 KiB hard-fail (:179-180). Caveat (B4 NEW-1, known): CI measures the no-DSN build, 2,325 B lighter than production |
| CSP gate | ✅ | bundle-budget plugin fails the build on any src-less inline `<script>` (vite.config.ts:78) — the R126 "CSP gate PASS (0 inline scripts)" mechanism |
| (+ not in the summary) | — | CVE critical gate (:229-235), path-filter cost gate (:104-138), weekly sweep (:14-15) |

**All claims verify.** The R126 gates line (CHANGELOG:120-124 "159 files / 1,076 tests · 234 files / 2,148 tests") is still file-exact at HEAD: frontend 159 ✅, backend 234 ✅ (230 `backend/src/**` + 4 `backend/tests/**` — recounted via `git ls-tree`).

### 1.3 Runtime hogs (measured context)

- `quality` is the critical path: **~13-17 min** per its own comment (:245-246). All 8 steps serial in one job (§5 W1).
- gitleaks `fetch-depth: 0`: full history = **272 commits, 30 MB** — checkout+scan overhead is modest (~30-60 s). **Keep** — it is the only always-on gate that would catch a secret in an old commit; the cost is negligible at this repo size.
- Double `pnpm install` on dep-touching pushes (audit + quality): by design, documented at :177-183. At ~40-60 s warm each, not worth restructuring.
- Docs-only pushes: ~2 min (filter + secret-scan only) — the FH-A12 cost gate works as documented (:101).

---

## 2. Supply-chain posture

**Actions pinning: 9/12 SHA-pinned; the 3 exceptions are all in the `e2e` job (F1).** Verified reference inventory: `checkout` ×5 (4 SHA + e2e `@v4`), `gitleaks-action` SHA (:66), `codeql-action/upload-sarif` SHA (:88), `dorny/paths-filter` SHA (:118), `pnpm/action-setup` ×2 (1 SHA + e2e `@v4`), `setup-node` ×2 (1 SHA + e2e `@v4`); docker.yml: all 9 references SHA-pinned (checkout :90, qemu :97, buildx :102/:167, login :105/:170, metadata :117/:181, build-push :133). The r110 discipline is stated in-file: *"SHA-pinned (r110, 109-p P2): every uses: resolves to a full 40-hex commit"* (ci.yml:43-45) — which makes the e2e job a self-declared policy violation, not just a zizmor finding.

**GITHUB_TOKEN permissions:** workflow-level `contents: read` on both files (least privilege ✓). Escalations: ci.yml `secret-scan` → `security-events: write` (:35-39, required for SARIF publish, commented); docker.yml → `packages: write` **at workflow level** (:61-63, both jobs genuinely need it, but zizmor wants job-level scoping — F2). `e2e`/`filter`/`audit`/`quality` inherit read-only.

**No `pull_request_target` anywhere** (both files read line-by-line). **No repo secrets used by any workflow** — only `secrets.GITHUB_TOKEN` (gitleaks env :68, GHCR login docker.yml:109/:174) and `vars.E2E_BASE_URL` (a variable, not a secret). Fork PRs therefore expose nothing: the quality job's `DATABASE_URL`/`SESSION_SECRET` are synthetic values explicitly labeled *"Synthetic values — the test suite stubs all DB/auth interactions"* (:253-257).

---

## 3. actionlint verdict — **CLEAN (0 errors)**

```
$ /tmp/actionlint --version        → 1.7.12 (built with go1.26.1)
$ PATH=/tmp:$PATH actionlint .github/workflows/ci.yml .github/workflows/docker.yml
  Rule "shellcheck" enabled (shellcheck 0.10.0 — downloaded to /tmp for the run)
  verbose: Found 0 parse errors · Found total 0 errors in 2 files
```

Both workflows pass actionlint **with the shellcheck rule active** (the `run:` blocks — drift-gate bash, CVE triage bash, the merge-job `imagetools` bash — all shellcheck-clean; the `set -euo pipefail` discipline holds). The pyflakes rule was unavailable (no pyflakes binary); the one python heredoc (:53-62) is trivial TOML-parsing already guarded by explicit exception handling. **No findings to report.** Recommend making this a CI step (§10.4) so it stays at zero.

## 4. zizmor verdict — 13 findings (10 shown, 3 auto-suppressed by persona/confidence policy)

zizmor 1.30.1, `--offline`, both workflows. Severity per zizmor; my contextual grade in §8.

| zizmor severity | ident | Location | Subject | My grade |
|---|---|---|---|---|
| High ×3 (conf High) | `unpinned-uses` | ci.yml:352-354 `[e2e]` | `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` — *"action is not pinned to a hash (required by blanket policy)"* | **F1 / P2** |
| High ×1 (conf High) | `excessive-permissions` | docker.yml:63 | *"packages: write is overly broad at the workflow level"* | **F2 / P3** (both jobs need it; scoping is defense-in-depth) |
| Medium ×6 (conf Low) | `artipacked` | ci.yml:41,113,187,261,352 + docker.yml:87 (every `checkout`) | *"does not set persist-credentials: false"* — checkout persists the 90-day-token in the workspace git config | **F3 / P3** |
| 3 suppressed | — | — | auto-suppressed by zizmor's default confidence/persona policy | noted |

No `template-injection`, no `dangerous-triggers` (no `pull_request_target`), no `hardcoded-credentials`, no `self-hosted-runner` issues. The only Highs are the e2e unpinned refs and the docker.yml permission placement — both fixable in ~15 YAML lines total (§8 diffs).

---

## 5. Efficiency — concrete wins only

**W1 — Split the `quality` job (biggest win): est. −4 to −8 min wall-clock per code push.**
The job runs 8 serial steps; the last three (backend vitest, frontend vitest, build) are mutually independent and independent of nothing before them except the install. Local evidence for suite scale: full vitest runs in this fleet's logs run 2-7 min per suite on a 2-core box (worklog :642 — 417.8 s; :657 — 131.4 s). Split into:

```yaml
  checks:            # lint → typecheck → parity → drizzle drift → orval drift (unchanged, ~5-7 min)
  tests:
    strategy:
      matrix: { suite: [backend, frontend] }
    steps: [ … install …,
      - run: pnpm --filter ${{ matrix.suite == 'backend' && '@workspace/api-server' || '@workspace/subnation' }} exec vitest run ]
  build:             # install → pnpm --filter @workspace/api-server run build  (~3-5 min)
```

Critical path becomes `max(checks, backend, frontend, build)` ≈ **7-9 min vs 13-17 today**. Cost: 2 extra warm `pnpm install`s (~+1-2 min total runner time) — irrelevant on a public repo (free minutes); the win is operator feedback latency. All three new jobs keep the same `if:`/`permissions`/env block. (Alternative minimal version: move only the two vitest suites into one new job and keep build+checks in `quality` — still −4 to −6 min.)

**W2 — docker.yml arm64 leg: −15 to −25 min QEMU per publish + removes the known-flaky leg.** The workflow's own header admits the cost: *"the QEMU-emulated arm64 legs stay ~3-5× slower than native (~15-25 min each)"* (docker.yml:17-18) — and the fail-fast:false matrix exists *because* arm64 fails (:20-21, R109 P2-2). Nothing consumes arm64 subnation2 images (§6). Conditional on F5's verify-or-retire decision; if retained at all, amd64-only publish = one-line matrix change.

**W3 — e2e job hygiene (bundled with F1's diff):** add `HUSKY: "0"` (the quality job documents this practice at :258-259 — *"Quiets the husky `prepare` script that runs on `pnpm install`"* — but e2e omits it, so its install runs husky pointlessly) + `cache-dependency-path: pnpm-lock.yaml` for consistency with the other three node jobs. ~20-40 s + noise per manual run.

**Reviewed and deliberately NOT flagged as wins:** gitleaks full-history (cheap at 272 commits, real coverage — keep); audit+quality double install on dep pushes (documented design, :177-183); weekly schedule forcing a full run (intended CVE/suite sweep); `filter`+`secret-scan` always-on (intended).

---

## 6. docker.yml purpose vs Coolify — **not stale, but rudderless: a rollback dependency wearing a dead rationale and an unverified banner**

What it does: manual/tag-triggered (`workflow_dispatch` + `v*` tags) multi-arch buildx → GHCR `ghcr.io/ahmadmedo1012/subnation2`, per-arch suffixed tags + a `merge` job assembling canonical `sha-<short>`/semver tags via `imagetools`. It does **not** participate in production deploys — Coolify's push-to-deploy builds on the VM (the file itself says so: *"Coolify's push-to-deploy webhook already builds every push on the VM itself, so publishing GHCR multi-arch images from here adds nothing on the per-push path"*, :14-18; README.md:237 *"Coolify is the only deployment authority (push-to-deploy:…"*).

Why it is NOT dead code: the emergency rollback path **depends** on its output — `FINAL_ROLLBACK_RUNBOOK.md:64`: *"docker pull ghcr.io/ahmadmedo1012/subnation2:sha-<short> # PRIVATE package —"* and `COOLIFY_FINAL_SETUP.md:15`: *"Emergency fallback = ghcr.io/ahmadmedo1012/subnation2:sha-<short>"*. Retiring it silently would strand the rollback runbook.

But three truths make it rudderless (→ **F5, P3**):
1. **The WHY is obsolete:** *"WHY: the production target is Oracle Cloud Always Free Ampere A1 (ARM64)"* (:4-5) — production has been a **Contabo** VPS since the 2026-10 cutover (`FINAL_PRODUCTION_TOPOLOGY.md:26` *"observed host: Contabo — R117 live probe"*, `:49` *"Contabo VPS, not the Oracle VM this page…"*). The arm64 leg exists to serve a target that is gone; the topology doc even notes *"the VM shape is not recorded"* (:170).
2. **The banner is still up:** *"STATUS: NOT YET VERIFIED on real infrastructure"* (:41-44) — and the repo carries `v0.0.1-coolify-test` (tagged 2026-10-01 at R115, which matched the `v*` trigger and present docker.yml with the same trigger block at that ref), yet no worklog/docs entry anywhere records the run's verdict (`rg 'GHCR|ghcr'` over the worklog → 0 hits). The rollback path's publisher has plausibly never been confirmed end-to-end.
3. **The `sha-<short>` tags the runbook pulls only exist for commits someone manually built** — there is no per-push or per-tag cadence, so an actual emergency would likely find no image for the commit being rolled back to.

**Fix directive (F5):** one recorded manual `workflow_dispatch` run on `main` (verdict → close or confirm the banner), then EITHER (a) keep as the DR publisher: drop the arm64 matrix leg (W2), rewrite the WHY header to the Contabo/DR reality, and add a quarterly manual-build note to the rollback runbook, OR (b) retire the workflow + rewrite the runbook fallback to "rebuild from git tag on the VM". Do not leave it as-is: it is an emergency path whose reliability is unverified and whose platform half is unmaintained.

---

## 7. Repo surface residue (post-R126)

**R126-A12 register closure audit at HEAD** (13 of 16 verified closed; remainder known-open, §9):

| A12 item | Status at f53a886 |
|---|---|
| D1 test counts / D2 .hermes CI story / D4 API.md fields=list / D5 graph 00+12 / D6 specs/ index row / D7 ONBOARDING / D8 README docs table / D9 runbook §3 | ✅ **closed & verified** (README:153-154 counts exact; .hermes.md:20-25 rewritten; API.md:35; graph header truth-up + no `rh2011` hit; docs/README.md:161-165; docs/ONBOARDING.md exists, links resolve; runbook:167 retitled) |
| R1 LICENSE / R2 SECURITY.md / R3 CONTRIBUTING.md / R5 templates / R6 CI badge | ✅ **closed & verified** — files exist; badge **curl-checked live: HTTP 200, `CI - passing`** (`github.com/ahmadmedo1012/SubNation2/actions/workflows/ci.yml/badge.svg`, this audit); all 6 badge targets resolve incl. anchors `#tech-stack`→:95, `#local-development`→:129 |
| D3 develop filters / R4 .editorconfig / R7 backend/.env.example | ❌ **still open, documented as queued** (`.hermes.md:16-19` *"its removal is queued for a config-touching round"*; no `.editorconfig` in `ls -a`; `backend/.env.example` absent while `.gitignore:45` whitelists it) → §9 pointers, not re-reported |

**README/ONBOARDING freshness at f53a886:** README links 16+/16 resolve (re-ran A12's link check — 0 dead); README:153-154 "frontend 159 test files / 1,076 tests · backend 234 test files / 2,148 tests (230 under `backend/src/**` + 4 under `backend/tests/**`)" — file counts + split **recounted exact**; ONBOARDING.md:83-84 "(234 files)"/"(159 files)" **exact**; ONBOARDING §5's CI gate list matches ci.yml step-for-step. **One regression elsewhere: `CONTRIBUTING.md:30-31` still says "(231 files)"/"(148 files)"** — the pre-R126 counts (→ F4). One precision nit: "CI runs both unit suites on every push" (README:152-153, ONBOARDING:78, CONTRIBUTING:24-25) is false for docs-only pushes (→ F6). One contradiction-adjacent nuance: `.hermes.md:54` *"3. **No automatic deploys.**"* + ONBOARDING:63-64 vs README:237 push-to-deploy (→ F7).

**docs/ tree:** structure sane — 4 buckets + inspection-r124/125/126/127 + project-graph per A12's map; only tree events since A12 are the R126 additions, all indexed (`docs/README.md:63-65` lists CONTRIBUTING/SECURITY/templates/screenshots). `docs/inspection-r127/` is in-flight/untracked as expected mid-round. **Stale top-level files: none new** — root inventory matches A12's minus nothing; `docs/NEON_MCP_SETUP.md` root placement remains the known deferred optional move (A12 §8.2). `.github/` = 2 workflows + ISSUE_TEMPLATE/{bug,feature}.md + PULL_REQUEST_TEMPLATE.md — complete as claimed. No Dependabot config — deliberate and documented (ci.yml:163-171).

**Worklog's R127-T1 recommendations → this audit operationalizes two:** actionlint (run here, clean, §3) and zizmor (run here, §4). gh CLI + CodeQL default setup remain operator actions; Knip was run by B2 (pointer §9).

---

## 8. Findings (P0-P3 + P4, verbatim quotes, confidence 1-5, fix directives)

> All are NEW vs the R126-A12 register and the R127 B-reports. Known-open items are pointers only (§9).

**F1 [P2 · conf 5 · zizmor High ×3]** — The `e2e` job holds the repo's only mutable action references, violating its own documented pinning policy.
Evidence (ci.yml:352-354):
```yaml
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
```
against the in-file policy (ci.yml:43-45): *"SHA-pinned (r110, 109-p P2): every uses: resolves to a full 40-hex commit; the tag it was resolved from rides along as a comment."* Exploitability honestly low (job is `workflow_dispatch`-only, so a trigger requires write access, at which point the workflow itself is editable) — but a tag-moving compromise would execute inside a job that reads `vars.E2E_BASE_URL` and runs Playwright against an operator-chosen URL. Fix (one hunk — the SHAs are already resolved elsewhere in this same file, zero new resolution work):
```yaml
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
```
plus job-level `permissions: contents: read` and `env: HUSKY: "0"` (W3) in the same commit.

**F2 [P3 · conf 4 · zizmor High]** — docker.yml grants `packages: write` at workflow level (docker.yml:61-63):
```yaml
permissions:
  contents: read
  packages: write
```
Both current jobs legitimately need it (build-and-push pushes; merge mints canonical tags), so this is placement, not over-grant — but any future job added to this file inherits registry write. Fix: drop `packages: write` from the workflow block; add `permissions: { contents: read, packages: write }` to `build-and-push` (:71) and `merge` (:156).

**F3 [P3 · conf 3 · zizmor Medium ×6]** — No `checkout` sets `persist-credentials: false` (all 6 sites in ci.yml + 1 in docker.yml). Context keeps risk low (ephemeral hosted runners, `contents: read` token, no untrusted `run:` after checkout), but the hardening is free and zizmor-standard. Fix: add `persist-credentials: false` to every `with:` block (verified safe for this pipeline: the drift gates only run local `git diff`; gitleaks needs no creds on a public repo; GHCR login is its own step).

**F4 [P3 · conf 5]** — CONTRIBUTING.md carries pre-R126 suite counts, one round after the restamp fixed the same class in README/CHANGELOG. Evidence (CONTRIBUTING.md:30-31):
```bash
pnpm --filter @workspace/api-server exec vitest run      # backend suite (231 files)
pnpm --filter @workspace/subnation run test:run          # frontend suite (148 files)
```
Truth at HEAD: **234 / 159**. This is A12 §4's exact prediction — *"live counts repeated across README + CHANGELOG + docs/README drift independently … Count-stamping needs to be mechanical or sha-qualified"* — recurring in the new file R126 itself added. Fix: restamp to 234/159 **or** (better, per A12) replace the parenthetical with "suite sizes: see README *Tests* — the canonical count" to stop the drift class at its third surface.

**F5 [P3 · conf 4]** — docker.yml: dead rationale + standing "NOT YET VERIFIED" banner on a rollback dependency (full analysis in §6): header WHY = *"the production target is Oracle Cloud Always Free Ampere A1 (ARM64)"* (:4-5) vs Contabo reality; banner *"STATUS: NOT YET VERIFIED on real infrastructure"* (:41-44) never closed despite the `v0.0.1-coolify-test` trigger match (2026-10-01) and zero recorded verification; `FINAL_ROLLBACK_RUNBOOK.md:64` depends on its `sha-<short>` output. Fix: the §6 decision directive (verify-or-retire + arm64 drop + header rewrite).

**F6 [P3 · conf 5]** — "on every push" precision: README:152-153 *"CI runs both unit suites on every push"* (same shape at ONBOARDING:78, CONTRIBUTING:24-25) — docs-only pushes skip audit+quality via the path filter (ci.yml:100-103, by design and documented there). Fix: "on every code push (docs-only pushes skip the heavy jobs via ci.yml's `filter`)" — one line per file.

**F7 [P3 · conf 4]** — "No automatic deploys" vs push-to-deploy: `.hermes.md:54` *"3. **No automatic deploys.** Deployment, restarts, DNS, Coolify secrets, and production data writes are explicit, confirmed, user-ordered actions."* is quoted into the developer onboarding (ONBOARDING:63-64) while README:237 states *"**Coolify is the only deployment authority** (push-to-deploy:…"*. Both are true in their own frames (agent-discipline vs deploy topology), but a new developer is never told the operational fact that **pushing to `main` goes live in ~10-30 min** (worklog round-126-live-verify). Fix: one sentence in ONBOARDING §3: "Nuance: the operator-ordered push to `main` itself triggers Coolify's push-to-deploy — 'no automatic deploys' governs agent-initiated deploy/restart/DNS actions, not the push." + mirror in `.hermes.md` non-negotiable #3.

**F8 [P4 · conf 4]** — The manual `e2e` job silently requires an undocumented repo variable: `E2E_BASE_URL: ${{ vars.E2E_BASE_URL || 'http://localhost:8080' }}` (ci.yml:364) — on a GitHub-hosted runner nothing listens at localhost:8080, so an operator dispatching without having set the variable gets a 100%-fail run. No doc mentions `vars.E2E_BASE_URL` (`rg` over docs/CONTRIBUTING/README/runbook → 0 hits outside inspection reports). Fix: one comment line above the env + a row in CONTRIBUTING's CI section ("set the `E2E_BASE_URL` Actions variable before dispatching e2e").

**F9 [P4 · conf 4]** — e2e job inconsistencies vs its siblings (no `HUSKY=0`, no `cache-dependency-path`, no explicit job `permissions`) — folded into F1's diff; listed separately so the checklist item is greppable.

**Positives verified clean (for the record):** workflow-level read-only defaults · no `pull_request_target` · no fork-visible secrets · synthetic CI env values · per-job timeouts · concurrency cancellation · SHA-pinning 9/12 · CI badge live-and-passing · actionlint 0 errors with shellcheck · all worklog gate claims true (§1.2) · README/ONBOARDING counts exact at HEAD · all relative links resolve.

---

## 9. Known-items pointer table (held open elsewhere — NOT re-reported)

| Item | Source | Status/pointer |
|---|---|---|
| `develop` in ci.yml branch filters (:5,:7) | R126-A12 D3 | Open by policy — `.hermes.md:16-19` "queued for a config-touching round"; bundle with F1's commit (same file, same class) |
| No `.editorconfig` | R126-A12 R4 | Open (not claimed in CHANGELOG R126) |
| `backend/.env.example` absent + `.gitignore:45` whitelist | R126-A12 R7 | Open, cosmetic |
| `docs/NEON_MCP_SETUP.md` root placement | R126-A12 §8.2 MOVE (optional, deferred) | Still at docs/ root, still indexed |
| Canonical-host 301/308 narrated in ~7 files | R126-A12 D10 | Do-not-execute convention, freshly swept |
| CI budget gate measures the no-DSN build (2,325 B lighter than production) | **R127-B4 NEW-1** | CI-gate blindspot — fix = placeholder-DSN budget build; squarely ci.yml-adjacent, owned by B4 |
| Knip in CI: v5-line or >6 GiB box + config ignores | **R127-B2 §B** | Mechanics triaged by B2; adoption decision open |
| impeccable source-gate CI plan (5 inline waivers → exit 0) | **R127-B3** | Phase-1 plan ready; adoption decision open |
| gh CLI / CodeQL default setup / Dependabot decision | R127-T1 + ci.yml:163-171 | Operator actions, not repo commits |
| `.well-known/security.txt` absent | R126-A7 → SECURITY.md honest note | Ops follow-up |

---

## 10. Next actions (ordered, all small)

1. **One config-touching CI commit** (the round `.hermes.md` already queues): F1+F2+F3 + the `develop` filter removal (D3) + `persist-credentials` sweep — ~20 YAML lines total, zero behavior change to the gates; re-run actionlint locally (already 0) before push.
2. **docker.yml verify-or-retire** (F5/W2): one recorded manual dispatch on `main`; then drop the arm64 leg + rewrite the WHY + close or replace the banner; sync `FINAL_ROLLBACK_RUNBOOK.md` §2 with the decision.
3. **Docs truth micro-commit** (F4+F6+F7+F8): CONTRIBUTING restamp-or-dedup, "every push" precision ×3 files, ONBOARDING deploy nuance, `vars.E2E_BASE_URL` doc row — ~10 lines.
4. **Adopt the two tools this audit ran, in CI** (per R127-T1): a tiny `workflows` job in ci.yml — `rhysd/actionlint-action` (or the binary) + `zizmor` via `zizmor-action` (findings → Security tab) on every `.github/workflows/**` change + the weekly schedule; plus CodeQL default setup via repo Settings (zero YAML) for the free public-repo SAST.
5. **Quality-job split** (W1) next time ci.yml is touched for speed: parallel suites+build, est. −4 to −8 min wall-clock per code push.

---

*End of report — R127-B9. Tool artifacts: actionlint 1.7.12 + shellcheck 0.10.0 and zizmor 1.30.1 (pip --target /tmp/zizmor-pkg, ELF binary) — all under /tmp, ephemeral; nothing installed into the repo; no commits; no production mutations.*
