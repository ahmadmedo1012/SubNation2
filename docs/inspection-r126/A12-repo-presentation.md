# R126-A12 — Repo Presentation & Docs Truth Audit

- **Agent:** R126-A12 (repo/docs truth + presentation, parallel fleet round 126)
- **Repo:** `SubNation2` @ HEAD `186b131` (read-only audit; no modifications, no installs, no builds, no test runs)
- **Scope:** README truth audit · docs/ map audit (all buckets) · CHANGELOG R124/R125 numeric spot-checks · root presentation hygiene (env examples, docker, scripts, gitignore, .github) · repo size/structure · gstack methodology cross-reference · execution-ready presentation improvement plan.
- **Method:** every claim verified at HEAD with file:line or a live guest GET (`https://subnation.ly` only, ≤8 requests total). Test suites were **not** run (hard rule) — counts marked "static" below are `find`/`grep` derivations, with the exact commands in §9.
- **Live baseline (this audit):** `https://subnation.ly/api/healthz` → **200** · `https://www.subnation.ly/` → **301 → apex** · `http://subnation.ly/` → **302 → https** · `https://subnation.ly/status` → **200**. Every deployment claim in the README status block re-verified TRUE.

---

## 1. Executive summary

The R124/R125 truth-passes did their job: the README is **overwhelmingly true** — 16/16 relative links resolve, the quickstart commands exist, the stack table matches `pnpm-workspace.yaml`, the budget gates match `vite.config.ts`, and all four live-edge claims match live probes. **One stale number survives** (backend test file count, 227 vs 231 at HEAD) plus **two stale claims in the tracked `.hermes.md`** that contradict the README's CI story. The docs 4-bucket map is accurate to the file (48/74/16/1 all recount exactly).

What remains is *presentation*, not truth: the repo is a **public** OSS-style storefront product that presents like an internal audit archive — no LICENSE file (despite `"license": "MIT"` in `package.json`), no SECURITY.md/CONTRIBUTING/issue templates, no screenshots, a 12-line round-history status block before the first-time visitor learns anything, a mid-README performance-audit section, and 13 mermaid architecture maps that exist in `docs/project-graph/` but are **never linked from the README**. The gstack repo-craft standard (§7) marks exactly these as violations.

**Counts:** README stale claims = **1** (plus 2 in `.hermes.md`). Docs issues = **10** (1 P2-class, 8 P3, 1 P4). Root-hygiene gaps = **8**. Dead links = **0**. Junk tracked = **0**. Files >500 KB = **0**.

**Verdict: SHIP-WORTHY** — nothing presented is false enough to block a ship; the lane-queued plan (§8) is the improvement round the operator's standing order asks for. FIX-FIRST items are one-liners (the 231 restamp, the `.hermes.md` two-liner) and belong in the plan's commit 1/2, not a hotfix.

---

## 2. README.md truth audit

### 2.1 Claim-by-claim verification

| # | Claim (README line) | Verdict | Evidence |
|---|---|---|---|
| 1 | "backend **227 test files** / 2101 tests green" (:249-250) | ✗ **STALE** | `git ls-tree -r HEAD --name-only \| grep -E 'backend/.*\.test\.ts$'` = **231**. The count was true mid-R125 (`a8d688c~1` = 227) but R125's own backend lane (`a8d688c`) then added 4 files (`admin-observability-no-store`, `admin-security-summary`, `admin-stats-emit`, `copilot-error-envelope`, +17 test cases). Note the convention nuance: excluding `backend/tests/` (4 top-level files) yields exactly 227 — but the documented command (`pnpm --filter @workspace/api-server exec vitest run`, ci.yml:324, README:130) collects those files too, so **231 is the truthful number for the documented command**. Test *count* not re-runnable read-only; static floor (1,906 `it/test(` + 40 `.each` expansions) keeps "≥2101" plausible — the file count is the assertable correction. |
| 2 | "frontend **148 files / 996 tests**" (:249) | ✓ (files exact) | 148 `*.test.ts(x)` under `frontend/src` (git ls-files, e2e excluded). 996 tests plausible (941 static `it/test(` + 9 `.each` expansions); not runnable read-only. |
| 3 | "guest-only e2e **40/40**" (:229, :250) | ✓ exact | 10 spec files contain **20** `test()` definitions (incl. loop-generated: auth-gates ×3, mobile-390 ×2+1) × **2** Playwright projects (`desktop-chromium` + `mobile-390`, playwright.config.ts:29-39) = **40**. Structurally exact. |
| 4 | "production is LIVE at subnation.ly" (:28) | ✓ live | `GET /api/healthz` → 200. |
| 5 | "www→apex is a 301 permanent single-hop at the edge" (:32-33) | ✓ live | `https://www.subnation.ly/` → 301 → `https://subnation.ly/`. |
| 6 | "apex's own http→https hop is a temporary redirect (302/307…)" (:242-243) | ✓ live | `http://subnation.ly/` → **302** → https. |
| 7 | "public `/status`" (:52) | ✓ live | `GET /status` → 200 (route: `backend/src/routes/cwv.ts:56`). |
| 8 | "`strictFunctionTypes` … newly-enabled" (R125 block, :247-248) | ✓ | `tsconfig.base.json` → `"strictFunctionTypes": true`. |
| 9 | Budget gate "145 KiB warn / 160 KiB hard-fail" (:72-73) | ✓ | `frontend/vite.config.ts:154-155` (`EAGER_GZIP_LIMIT_WARN = 145 * 1024`, `EAGER_GZIP_LIMIT_ERROR = 160 * 1024`). |
| 10 | "Eager path ≈ 143 KiB gz" (:72) | ✓ consistent | R125 CHANGELOG 145,709 B gz = 142.3 KiB ≈ 143; R126-A5 independently re-measured 145,717 B gz at HEAD (worklog) — still under the 145 KiB warn line. |
| 11 | Stack: "React 19, Vite, Tailwind, wouter, TanStack Query" (:81) | ✓ | `pnpm-workspace.yaml` catalog: `react: 19.1.0`, `@vitejs/plugin-react ^5`, `@tailwindcss/vite ^4.1`, `@tanstack/react-query ^5.90`. |
| 12 | "pnpm is enforced (installs via npm/yarn fail fast)" (:94) | ✓ | `package.json` `preinstall` script exits 1 for non-pnpm user agents. |
| 13 | Quickstart commands `pnpm run dev` / `db:seed` / `build` / `start` (:117-121, :165-167) | ✓ | All defined: root `package.json` scripts → `scripts/package.json` (`dev`, `seed`, `start`), `build` chains lint+typecheck+api-server build. `config/env.example` exists (31,466 B, 85 uncommented keys). |
| 14 | Test commands (:129-131) | ✓ | `test:run`/`test:e2e` in `frontend/package.json`; `exec vitest run` matches ci.yml:324. |
| 15 | "no `db:push` step in the workflow… must never be run against production" (:134-140) | ✓ | Root `db:push` exists with the warning consistent; `shared/db/scripts/guard-drizzle-push.mjs` fence present. |
| 16 | Main API routes list (:288-293) | ✓ | All verified defined: `/api/healthz` (health.ts:508), `/api/auth/firebase/session` (auth.ts:511), `/api/auth/telegram` (telegram-webhook.ts:207), `/api/auth/whatsapp/start|verify` (auth-whatsapp.ts), `/api/orders`, `/api/wallet`, `/api/products` (+`?fields=list`, openapi.yaml:661), `/api/admin/stats` (admin/stats.ts:60), `/api/auth/me` (auth.ts:358). |
| 17 | "GitHub Actions CI is green on every push (ci.yml: secret scan, lint, typecheck, OpenAPI parity, migration + orval drift gates, both unit suites, production build)" (:251-254) | ✓ (jobs) / ○ (green, live-unverified) | All listed jobs exist in `.github/workflows/ci.yml` (secret-scan, filter, audit, quality incl. every named gate, e2e dispatch-only). "Green on every push" not probe-able from the sandbox (no GitHub API access authorized) — plausible, and would be self-evidencing with a badge (§8.3-R6). |
| 18 | All 16 relative links | ✓ | Programmatic check: 16/16 resolve (§9). |

### 2.2 Simplicity assessment (operator's standard: «تبسيط وشرح المشروع بشكل مبسط وواضح ومنظم وصحيح واحترافي وعملي»)

**Correct ✓, Professional ✓, Practical ✓ — Simple/Clear ✗ (the remaining gap).** Specific friction for a first-time visitor:

1. **The status blockquote (:28-40) is round-history, not orientation.** 12 dense lines (R125/R124 dates, "pre-R124-redeploy answer was 308", Coolify webhook mechanics, Sentry org names) before the reader has seen a screenshot or understood the product. Truth-rich, simplicity-poor.
2. **Performance section (:56-73) is internal audit detail** (chunk byte counts, "sticky 10% roll", "experimentalMinChunkSize") sitting between Highlights and Tech stack — the natural mid-README position for "How it works" / architecture.
3. **No screenshots.** This is a visual storefront product; `frontend/public/pwa-screenshot-*.png` assets already exist in-repo and are used nowhere in the README.
4. **No architecture visual.** `docs/project-graph/` holds **13 mermaid truth maps** (00-system-overview → 12-source-of-truth) — exactly the "simple and clear" material the operator asks for — and the README never mentions the directory. The only diagram-ish link is the textual topology doc inside the status block.
5. **Zero Arabic.** An Arabic-first Libyan product whose README can't greet its own audience — a 3-line «عن المشروع» summary costs nothing and directly serves «عملي».
6. **Missing OSS sections** (see §5): license, security policy, contributing, CI badge, screenshots — the standard first-visit trust surface.

### 2.3 README section scorecard

| OSS-standard section | State |
|---|---|
| Badges | ✓ (status/stack/node/pnpm) — **missing CI + license badges** |
| One-paragraph pitch | ✓ (What is this?) |
| Screenshots | ✗ **absent** |
| Features/highlights | ✓ |
| Architecture diagram link | ✗ **absent** (13 .mmd exist unexposed) |
| Tech stack table | ✓ accurate |
| Repo layout | ✓ accurate |
| Quickstart | ✓ works |
| Tests | ✓ (1 stale count) |
| Env-var table | ✓ good |
| Deployment | ✓ (over-dense status block) |
| API surface | ✓ |
| Docs table | partial (omits money invariants, architecture/, project-graph/) |
| License | ✗ **absent** (no LICENSE file; only `package.json` MIT string) |
| Security policy | ✗ **absent** |
| Contributing | ✗ **absent** |

---

## 3. Docs map audit

### 3.1 Area-by-area verdict

| Area | Files | Verdict |
|---|---|---|
| `docs/README.md` (index) | 1 | **Accurate to the file.** Recount: CURRENT 48 = 34 md + 13 mmd + 1 json ✓ exact; HISTORY 74 (+README=75 on disk) ✓; DEPRECATED 16 (+README=17) ✓; PENDING 1 ✓. Pointer hierarchy + bucket legend + house rules = genuinely good repo-craft. Gaps: no `specs/` coverage (D6), no per-file status for `project-graph/` (D5). |
| `architecture/` | 2 | CURRENT ✓ (topology §1 updated R125; live claims re-verified by this audit's probes). |
| `deployment/` | 10 | CURRENT ✓ (ENVIRONMENT_MATRIX is r108-era but rows-verified per index; acceptable as dated-but-verified). |
| `operations/` | 8 | CURRENT ✓ (OPERATOR_ACTIONS, TOTP, inventory, monitoring, retention, cold-start, www-301, Contabo ops). |
| `project-state/` | 2 | CURRENT ✓ — `source-of-truth.md` is exemplary (9 numbered reconciliations, live-wins rule). |
| `project-plan/` | 1 | CURRENT ✓ (append-only progress ledger; 00-09 correctly deprecated). |
| `ux/` `pricing/` `loyalty/` | 4 | CURRENT ✓. |
| `project-graph/` | 13 mmd | **Mixed currency (D5).** `03-deployment-target.mmd` and `11-environment-secrets.mmd` are current (app `kjxqu…` git-source), but `00-system-overview.mmd` still draws the **DELETED app-2** container (`wbgj7cszizukrlrblncq8by5`, dockerimage — line 16) behind a Wave-0-snapshot banner, and `12-source-of-truth.mmd` names a foreign local-clone path (`/home/rh2011/Projects/SubNation2`). The index labels the whole tree "CURRENT … truth maps". |
| `docs/` root | 8 | Mostly ✓. **`API.md` is stale by one feature (D4):** its products line (:34) lists `?category=&search=&sort=&available_only=` but not the R124-public `?fields=list` projection or `variant_count`, both in `shared/api-spec/openapi.yaml:661-682`. |
| `pending/` `deprecated/` `history/` | 1 / 16 / 74 | Bucketed correctly, each with a README move-map ✓. Runbook §3's "Render logs" title is legacy-labeled in-body (acceptable; title still says Render — D9 cosmetic). |
| `inspection-r124/` `r125/` `r126/` | 11 / 13 / 8 | Round evidence by convention ✓; r126 currently untracked (this round's output). |

### 3.2 The three journeys

- **Operator (incident):** ✓ **excellent** — `docs/README.md` "Start here — for incidents" → DR → runbook §2 → monitoring; runbook §1-§15 complete with the R121+ sections. This journey is the docs system's strongest asset.
- **New developer:** ✗ **no ordered path.** The "Start here" is incident-first; a new dev must assemble their journey from README quickstart + scattered law docs (`FINAL_MONEY_INVARIANTS.md`, no-`db:push` rule, orval codegen workflow, Arabic RTL conventions, gates to run before PR). Nothing named ONBOARDING/DEVELOPMENT exists. (D7 — the single biggest docs-journey gap.)
- **Auditor:** ○ **good but incomplete** — CHANGELOG + inspection-r### are indexed and the round-record notes in `docs/README` are exemplary; but the front-door index never mentions `specs/` (6 dated spec dirs: 003-anomaly-detection, 004-security-audit, 008-audit-coverage-gaps, 010-ai-admin-copilot, 011-inventory-demand-forecast, 012-arabic-catalog-enrichment) — a whole evidence tree invisible from the docs front door (D6).

### 3.3 Docs issues register (D1-D10)

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| D1 | **P2** | Backend test-count claim stale: "227 files / 2101 tests" in README:249 + CHANGELOG:91,:122 vs **231 files** at HEAD (R125's own lane `a8d688c` added 4 after the count; convention nuance: 227 = excluding `backend/tests/`, which the documented CI command *does* collect) | `git ls-tree` (§9) | Restamp 231 + re-derive the test total on the next full run, or qualify "231 files (227 in src/ + 4 in tests/)" |
| D2 | **P2** | **Root-file contradiction:** tracked `.hermes.md` says "CI is billing-disabled: run every gate locally before claiming green" — the README (:251-254), `docs/project-state/source-of-truth.md` #7, and ci.yml's own R122 comment ("the repo is PUBLIC now — minutes free") all say CI runs green on every push. `.hermes.md` is R119-era and was never truth-swept | `.hermes.md` "Project shape" bullet vs ci.yml:162-171 | 2-line correction in `.hermes.md` |
| D3 | P3 | `.hermes.md` also notes "develop does not exist even though CI declares it" — and **ci.yml still declares it** (branches `[main, develop]`, ci.yml:4-7); the self-acknowledged cleanup never happened | ci.yml:4-7 | Drop `develop` from the filters (or create the branch — but the repo is main-only by policy) |
| D4 | P3 | `docs/API.md` products line missing the R124-public `?fields=list` projection + `variant_count` (openapi.yaml:661-682 has both) | API.md:34 | One line: `GET /api/products?fields=list` → light grid projection |
| D5 | P3 | `project-graph/` mixed currency under a CURRENT label: `00` draws the deleted app-2 (:16); `12` cites a foreign clone path `/home/rh2011/…` | .mmd headers | Refresh 00 + 12 (03/11 already current); add per-file status rows to the index |
| D6 | P3 | Docs front-door index has no `specs/` coverage — 6 spec dirs invisible to the documented auditor journey | `grep -n "specs/" docs/README.md` → 0 hits | One row in the CURRENT table (or a HISTORY-classified row if specs are frozen) |
| D7 | P3 | No developer-onboarding doc/journey anywhere in the tree | `find docs -iname "*onboard*"` → 0 | Add `docs/ONBOARDING.md` (§8.2) |
| D8 | P3 | README Documentation table omits the "law" doc (`FINAL_MONEY_INVARIANTS.md`), `architecture/`, and `project-graph/` — key assets underexposed at the front door | README:301-311 | Expand the table (§8.1) |
| D9 | P4 | Runbook §3 title still reads "Reading Render & Neon logs" (body carries a correct LEGACY banner; Render is retired) | OPERATIONS_RUNBOOK.md:167 | Retitle "Reading logs (live stack: Docker/Coolify + Neon)" |
| D10 | P3 (obs) | The 301/308 canonical-host truth is narrated in ~7 files (README ×3 sections, docs/README, runbook §13, topology §1, DISASTER_RECOVERY, ops docs). The both-states convention is documented and current — but every edge regen re-opens a 7-file edit. Drift-prone by design | R125-A12's own 7-file sweep | Optional: make runbook §13 the single canonical-host record and have others link it (do NOT execute now — the convention is freshly swept and true) |

**Duplicates:** none material (the R122 reorg + two A12 sweeps already consolidated; buckets recount exactly). **Dead paths:** 0 (README 16/16; docs index spot-checks resolve). **Contradictions:** D2 is the only live root-level one; D1 is numeric staleness, not contradiction.

---

## 4. CHANGELOG.md — R124/R125 numeric spot-checks

13 claims checked (mandate asked for 10):

| # | Claim | Verdict |
|---|---|---|
| 1 | R125 "backend 227 files / 2101 tests" (:91, :122) | ✗ STALE — **231** at HEAD (see D1). The R124 entry's count was retro-corrected by R125 (~199→227) but R125's own entry wasn't re-stamped post-`a8d688c` — the "dated ledger, no retro-edits" convention is applied inconsistently at exactly this seam. |
| 2 | R125 "frontend 131 → 148 files / 908 → 996 tests" (:89-90) | ✓ files exact at HEAD (148); deltas internally consistent. |
| 3 | R125 "e2e … 40/40" (:96, :123) | ✓ structurally exact (20 tests × 2 projects). |
| 4 | R125 "strictFunctionTypes ENABLED … 11 errors … four standard idiom widenings" (:70-77) | ✓ flag in tsconfig.base.json; the four widenings are findable (`lazyWithRetry` `ComponentType<any>` etc.). |
| 5 | R125 "vendor-charts (514.75 KB raw / 134.74 KB gz)" (:58) | ✓ credible — corroborated independently by R126-A5's live+dist audit ("charts 134.74 lazy"). |
| 6 | R125 "Eager path 145,709 B gz (no-DSN) / 146,096 B (DSN) — under the 145 KiB gate" (:66-67) | ✓ arithmetic true (145 KiB = 148,480 B) and re-measured by R126-A5 (145,717 B). |
| 7 | R125 "3 P1 + ~30 P2 + ~85 P3" (:18) | ✓ P1 exact (A6 B-1/B-2/B-3 = 3 headers); P2/P3 within the tilde (counted 27+ P2 headers, 70+ P3 headers incl. table-row findings; some rows cross-reference). |
| 8 | R124 "93 findings, 0 P0" (:135) | ○ approximately consistent — 97 `[Px]` headers counted across A1-A10 (delta = known-open confirmation entries, a format artifact). Not exactly derivable by simple count; not a truth violation. |
| 9 | R124 "vendor-sentry 469,777 → 328,652 B (−141 KB raw, −30%)" (:154) | ✓ credible — `469,777 B` figure is pinned in `vite.config.ts` comments; end-state not re-derivable read-only (no dist); R126-A5 re-verified the boundary held. |
| 10 | R125 "Copilot's 47 hand-rolled error envelopes" (:83) | ✓ exact — A8 evidence: previews 31 + draft 7 + ask 5 + settings 4 = **47**. |
| 11 | R125 "docs truth … 35 rows, 0 skipped" (:101) | ✓ consistent with `docs/inspection-r125/A12-docs-truth.md` (289 path citations, 0 broken links). |
| 12 | R125 gates "lint 0 errors (30 BE + 14 FE warnings)" (:120-121) | ○ not verifiable read-only (no lint run). |
| 13 | docs index "48 CURRENT … 74 HISTORY … 16 DEPRECATED … 1 PENDING" | ✓ exact (recounted, §3.1). |

**Format fitness:** **good — keep it.** One entry per round, newest-first, theme subsections, a "Deferred (documented, not forgotten)" block and a "Gates on the merged tree" block per entry — that is exactly the evidence-trail shape an auditor needs. Two refinements: (a) live counts repeated across README + CHANGELOG + docs/README drift independently (D1 proves it) — stamp counts "as of `<short-sha>`" or move the canonical numbers to one place; (b) state the retro-edit convention once at the top (R125 edited R124's entry; R126 may edit R125's for the same class of correction — currently the rule is implicit).

---

## 5. Root presentation hygiene

**Inventory (root):** `.dockerignore` `.git/` `.github/` `.gitignore` `.gitleaks.toml` `.hermes.md` `.husky/` `.kiro/` `.lintstagedrc.json` `.npmrc` `.nvmrc` `.prettierignore` `.prettierrc` `.specify/` `.vscode/` `CHANGELOG.md` `Dockerfile` `OPERATIONS_RUNBOOK.md` `README.md` `backend/` `config/` `deploy/` `docker-compose.yml` `docs/` `eslint.config.mjs` `frontend/` `package.json` `pnpm-lock.yaml` `pnpm-workspace.yaml` `scripts/` `shared/` `specs/` `tsconfig.base.json` `tsconfig.json`.

| ID | Sev | Finding |
|---|---|---|
| R1 | **P1** | **No `LICENSE` file.** `package.json` declares `"license": "MIT"` on a **public** repo — GitHub renders a license badge from that string but there are no terms text and no copyright line; MIT requires the notice be distributed with the software. Biggest single professionalism gap. |
| R2 | P2 | **No `SECURITY.md`** (and R126-A7 found `/.well-known/security.txt` serving SPA HTML — no security contact exists anywhere). |
| R3 | P2 | **No `CONTRIBUTING.md`** — conventions (round-tagged conventional commits, pnpm-only, gates to run, no-`db:push` law) exist but live in scattered notes; a public repo gets PRs with none of this surfaced. |
| R4 | P3 | No `.editorconfig` (prettier covers formatting; editorconfig is the cross-editor courtesy layer). |
| R5 | P3 | No `.github/ISSUE_TEMPLATE/` and no PR template — `.github/` contains only the two workflows. |
| R6 | P3 | No CI/license badges in README while the README *claims* CI green — a badge makes the claim self-evidencing (and is the OSS-standard trust signal). |
| R7 | P4 | `.gitignore` whitelists `!backend/.env.example` but the file doesn't exist (frontend's does). Cosmetic asymmetry. |
| R8 | P3 | **Scripts sanity ✓** (verified without running): all README-documented commands resolve (`dev`/`seed`/`start`/`backup`/`validate:env` in `scripts/package.json`; `test:run`/`test:e2e` in `frontend/package.json`; `db:push` present with the never-in-prod warning). `docker-verify.sh` exists and executable. |

**Positives (verified clean):** `.gitignore` is thorough with an explanatory comment trail; **zero junk tracked** (`git ls-files` filtered for log/tmp/dist/env/node_modules → 0 hits); the only tracked binaries are intentional product art (45 webp + pwa logos + og image, all ≤192 KB); **no file >500 KB** (largest: `pnpm-lock.yaml` 466 KB — normal; next: generated orval client 315 KB — CI-drift-gated by design). `docker-compose.yml` (subnation + openwa, :3000/:3001 localhost-bound) is coherent with `deploy/env.compose.example` and the README's compose instructions; `Dockerfile` multi-stage matches. `.github/workflows/docker.yml` is manual/tag-only with an honest "NOT YET VERIFIED" banner — fine, just unmentioned in the README.

**Env examples:** `config/env.example` is **excellent** — 85 active keys + ~40 documented-as-commented optionals; of the 101 distinct `process.env.*` reads in `backend/src`, only `FRONTEND_DIST` is absent even as a comment (P4; it has a default). The README's `ENCRYPTION_KEY_PREV` pointer into env.example resolves (commented entry :109-126). Stale-var note: `RENDER_*` (7) are still read as instance-metadata fallbacks (`sentry.ts:207-208`, `boot-migrations.ts:87`, `diagnostics.ts:276-277`) — legacy-but-harmless, worth a deprecation note someday, not a presentation blocker.

---

## 6. Repo size / structure

- **Large files:** none over 500 KB. Top: `pnpm-lock.yaml` 466 KB, `shared/api-client-react/src/generated/api.ts` 315 KB (orval-generated, CI-gated), `docs/SEO_PRODUCTS.json` 265 KB (curated data), `openapi.yaml` 216 KB, pwa screenshots ~190 KB. All justified.
- **Binary junk:** none — all tracked images are product/PWA assets.
- **Orphans:** `frontend/public/init.js` (404 B) is referenced by the SPA shell (R126-A5 traced it live); `docs/NEON_MCP_SETUP.md` is indexed; nothing found referenced-by-nothing. `.kiro/`, `.specify/`, `.husky/`, `.vscode/` are deliberately tracked with explanatory `.gitignore` comments — legitimate tooling state, not junk.
- **Structure verdict:** monorepo layout is clean and matches the README's map (backend/frontend/shared/docs/deploy/scripts/config/specs all present and as-described).

---

## 7. gstack methodology cross-reference

Consulted: `/home/z/my-project/repos/gstack` — `SKILL.md`, `ARCHITECTURE.md`, `README.md`, `ETHOS.md`, `CONTRIBUTING.md`. Applicable repo-craft principles and SubNation2's status against each:

| # | gstack principle (citation) | SubNation2 status |
|---|---|---|
| G1 | **"Hand-maintained docs always drift from code"** — ARCHITECTURE.md:310; the fix is mechanical truth-stamping: generated docs + a CI drift gate (`gen:skill-docs --dry-run` + `git diff --exit-code`, ARCHITECTURE.md:366) | **Partially violated.** OpenAPI/orval/drizzle drift gates exist and work — but the README/CHANGELOG *numeric* claims (test counts) are hand-maintained with no gate, and D1 is precisely that drift, twice now (~199→227→231). Count-stamping needs to be mechanical or sha-qualified. |
| G2 | **One doc, one job, explicit cross-pointers** — ARCHITECTURE.md:3 "This document explains why… For setup see CLAUDE.md. For contributing, see CONTRIBUTING.md" | **Violated at the README.** The README currently holds four jobs: product pitch + round-history ledger + perf-audit report + ops status. gstack splits these across README/CHANGELOG/docs and keeps the front page one job. |
| G3 | **Voice: "Direct, concrete… No filler"** (SKILL.md preamble) applied to the front page — Quick start reachable in seconds ("Install — 30 seconds", README §Quick start) | **Violated.** A first-time visitor passes a 12-line audit-status block and a raw-byte Performance section before the quickstart; no screenshot anchors the product in the first screen. |
| G4 | **Boil the Ocean / "completeness is cheap"** (ETHOS.md §1) — the trust surface (LICENSE, CONTRIBUTING, SECURITY, templates) is the cheap-to-complete last 10% | **Violated.** R1-R5: the public repo ships with no license text, no security policy, no contributing guide, no issue/PR templates — each is a minutes-cost file. |
| G5 | **Layered entry points for different readers** — gstack README (users) → CLAUDE.md (commands) → ARCHITECTURE.md (why) → CONTRIBUTING (how to help), each discoverable from the one above | **Half-violated.** docs/README's pointer hierarchy is genuinely good (operator+auditor served), but the *new-developer* layer is missing entirely (D7) and the front door doesn't reach `specs/` (D6) or `project-graph/` (D8). |
| G6 | **Evidence lines / verification culture** — every claim carries a reproducible check | **Aligned (strength).** SubNation's file:line evidence trails, live-probe stamps, and this round's 4/4 live re-verification are fully in the gstack spirit — keep. |

---

## 8. THE PLAN — execution-ready repo-presentation improvement round

> Nothing below was executed (read-only mandate). Sizes are estimates; everything is additive or line-level.

### 8.1 README.md — target outline (truth-corrected sketches)

```
<div center> # SubNation + badges (add: CI status, License MIT)      ← G3/G4
1-paragraph EN pitch (current :21-26, kept verbatim — it's good)
3-line Arabic «عن المشروع» summary                                    ← simplicity for the product's own audience
SCREENSHOTS: storefront home + admin dashboard
  (use existing frontend/public/pwa-screenshot-{wide,narrow}.png, or take 2 fresh ones)
## Highlights                      (current :44-54, unchanged)
## How it works                    NEW — 5-step user journey (sign in → wallet → buy → instant encrypted delivery → admin ops)
                                    + link docs/project-graph/00-system-overview.mmd (rendered) 
                                    + link docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md
## Tech stack                      (current table, unchanged — verified true)
## Repository layout               (current, unchanged)
## Quick start                     (current Local development + Tests, restamped:
                                    "backend 231 test files (~2.1k tests)" [D1 fix] — or run the suite once and stamp exact)
## Production & deployment         Docker + Coolify sections (current), then a 3-LINE status:
                                    ✅ Live at https://subnation.ly (single VM: Coolify+Traefik+Contabo, Neon external)
                                    ✅ CI green on every push (badge above) · docs/project-state/source-of-truth.md = live truth
                                    → the full round-by-round deployment history moves OUT (link CHANGELOG + source-of-truth)
## Performance                     5 bullets max (current :56-73 distilled: lazy replay −30% vendor, lazy admin charts,
                                    ?fields=list −62.6% wire, route warm-up, 143 KiB eager budget) + link NEW docs/PERFORMANCE.md
## Configuration                   (current env table, unchanged — verified)
## API                             (current, + one line: ?fields=list light projection [D4 parity])
## Documentation                   EXPANDED table: + FINAL_MONEY_INVARIANTS (the law), architecture/, project-graph/ (13 maps),
                                    + NEW docs/PERFORMANCE.md, + NEW docs/ONBOARDING.md [D7/D8]
## Contributing · Security · License  NEW 3-liners linking CONTRIBUTING.md / SECURITY.md / LICENSE [R1-R3]
## Notes                           (current ruflo note, kept)
```

Net effect: front page = product + proof + paths in; audit narrative one click deep. Every line that remains is one this audit verified true.

### 8.2 Docs tree reorg — file-level table

| Action | Path | Rationale / note |
|---|---|---|
| **ADD** | `docs/PERFORMANCE.md` | Extract README :56-73 detail + round-measured numbers (R124/R125/R126-A5's fresh measurements) into one perf record; README keeps 5 bullets + link. |
| **ADD** | `docs/ONBOARDING.md` | The missing developer journey: quickstart → pnpm-only rule → no-`db:push` law → orval codegen workflow (edit openapi → regen → commit) → money invariants as law → Arabic RTL conventions → gates to run (lint/typecheck/both suites/build) → round-tagged conventional commits → where truth lives (pointer hierarchy). All content exists scattered today; this is assembly, not authorship. [D7] |
| **ADD** | root `LICENSE` (MIT text + copyright line) · `SECURITY.md` (supported versions, reporting contact, safe-harbor scope — cross-ref the gitleaks CI) · `CONTRIBUTING.md` (conventions + gates + doc house rules) · `.editorconfig` · `.github/ISSUE_TEMPLATE/{bug,feature}.md` · `.github/PULL_REQUEST_TEMPLATE.md` | The trust surface. [R1-R5] |
| **EDIT** | `README.md` | §8.1 restructure + the D1 restamp (231). |
| **EDIT** | `.hermes.md` | 2-line truth fix: CI is live on the public repo (drop "billing-disabled / run locally"); drop or fix the develop-branch note. [D2] |
| **EDIT** | `.github/workflows/ci.yml` | Remove `develop` from push/PR branch filters (:4-7) — branch doesn't exist and main-only is policy. [D3] |
| **EDIT** | `docs/API.md` | Add `?fields=list` + `variant_count` to the products line (:34). [D4] |
| **EDIT** | `docs/README.md` | + row for `specs/` (with status); + rows for PERFORMANCE.md / ONBOARDING.md; + per-file status note for `project-graph/` (00/12 = snapshot-era until refreshed); note the LICENSE/CONTRIBUTING/SECURITY additions in the repo-root companions line. [D5/D6] |
| **EDIT** | `docs/project-graph/00-system-overview.mmd` | Refresh: deleted app-2 subgraph → app `kjxqu…` git-source (banner already describes it; make the drawing match). [D5] |
| **EDIT** | `docs/project-graph/12-source-of-truth.mmd` | Replace the foreign clone path `/home/rh2011/Projects/SubNation2` with a generic "local working clone" node. [D5] |
| **EDIT** | `OPERATIONS_RUNBOOK.md` | Retitle §3 "Reading logs (live stack: Docker/Coolify + Neon)". [D9, one line] |
| **EDIT** | `CHANGELOG.md` | State the retro-edit convention once in the preamble; optionally restamp R125's gates line with a bracketed correction `[R126: 231 files at HEAD]` — the same class of correction R125 itself applied to R124's entry. [§4] |
| MOVE (optional, defer) | `docs/NEON_MCP_SETUP.md` → `docs/operations/` | Root-shrink candidate only; costs link edits and the current placement is indexed — **not worth it this round**. |
| DELETE | — | **Nothing.** The 4-bucket tree recounts exactly; no doc is dead, duplicated, or contradictory enough to remove. The R122 reorg already did that work correctly. |

### 8.3 Root hygiene fix list (checklist form)

1. `LICENSE` (MIT, copyright `ahmadmedo1012`) — closes R1/P1.
2. `SECURITY.md` — closes R2; mirrors gitleaks CI + the never-commit-secrets rule; add `public/.well-known/security.txt` as an ops follow-up (A7-F9).
3. `CONTRIBUTING.md` — closes R3; steal from ONBOARDING.md + house rules.
4. `.editorconfig` — closes R4.
5. `.github/ISSUE_TEMPLATE/` ×2 + `PULL_REQUEST_TEMPLATE.md` — closes R5.
6. README badges: CI workflow badge + license badge — closes R6.
7. `.hermes.md` truth fix (D2) + ci.yml `develop` removal (D3).
8. `backend/.env.example` stub (or drop the gitignore whitelist) — closes R7.

### 8.4 Suggested 3-commit sequencing

| Commit | Content | Why this order |
|---|---|---|
| **C1 — `chore(repo): trust surface + root truth`** | LICENSE, SECURITY.md, CONTRIBUTING.md, .editorconfig, .github templates, README badges, `.hermes.md` 2-line fix, ci.yml develop-removal, backend/.env.example stub | Purely additive + 3 one-line fixes; zero risk; no doc-index churn; makes the public repo legally + procedurally presentable immediately. |
| **C2 — `docs(readme): truth restamp + simplification`** | README restructure per §8.1 (231 restamp, status block → 3 lines, perf → 5 bullets, screenshots, Arabic intro, expanded Documentation table, How-it-works + graph links), API.md fields=line, runbook §3 retitle | The visible centerpiece; depends on C1 only for the badge/license links to point at real files. |
| **C3 — `docs(tree): layering + graph refresh`** | docs/PERFORMANCE.md + docs/ONBOARDING.md (new), project-graph 00/12 refresh, docs/README index rows (specs/, project-graph status, the two new docs, root companions), CHANGELOG convention line + optional R125 bracket-correction | Index/ledger work lands last so it indexes the final state of C1+C2; the new docs need C2's README links in place. |

Effort estimate: C1 ≈ 30 min (mostly boilerplate), C2 ≈ 90 min (restructure + 2 screenshots), C3 ≈ 90 min (two assembled docs + graph edits + index rows). All three are docs-only — no code paths touched, CI-safe by construction (docs-only pushes already skip the heavy jobs via the path filter).

---

## 9. Verification appendix (reproducible commands)

```bash
# backend test files (D1) — 231 total; 227 excluding backend/tests/
git ls-tree -r HEAD --name-only | grep -E 'backend/.*\.test\.ts$' | wc -l          # → 231
find backend -name "*.test.ts" -not -path "*/node_modules/*" -not -path "backend/tests/*" | wc -l   # → 227
# at the R125 mid-round tree: git ls-tree -r a8d688c~1 --name-only | grep -cE 'backend/.*\.test\.ts$' # → 227

# frontend test files — 148
git ls-files | grep -E 'frontend/.*\.test\.tsx?$' | grep -v e2e | wc -l            # → 148

# e2e = 20 tests × 2 projects = 40
grep -cE '\btest\(' frontend/e2e/*.spec.ts   # 4,1,1,1,1,1,2,1,2,3 (+loop expansions ×3, ×2)
grep -n "projects:" -A8 frontend/playwright.config.ts                              # 2 projects

# README links — 16/16 OK
grep -oE '\]\((\./[^)#?]+|[^)]*\.md)' README.md | sed 's/^](//' | sort -u | while read p; do [ -e "$p" ] || echo "DEAD $p"; done

# docs bucket recount — 48 CURRENT (34 md + 13 mmd + 1 json), 74 HISTORY, 16 DEPRECATED, 1 PENDING
find docs -name "*.md" -not -path "docs/history/*" -not -path "docs/deprecated/*" -not -path "docs/inspection-*" | wc -l   # 36 (−2 bucket READMEs = 34)
find docs -name "*.mmd" | wc -l                                                     # 13
find docs/history -name "*.md" | wc -l                                              # 75 (incl. its README)
find docs/deprecated -name "*.md" | wc -l                                           # 17 (incl. its README)

# budget gates + strictFunctionTypes
sed -n '154,155p' frontend/vite.config.ts        # 145 KiB warn / 160 KiB hard-fail
grep strictFunctionTypes tsconfig.base.json      # true

# live probes (guest GETs, this audit)
curl -s -o /dev/null -w "%{http_code}" https://subnation.ly/api/healthz            # 200
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" https://www.subnation.ly/    # 301 → apex
curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://subnation.ly/         # 302 → https
curl -s -o /dev/null -w "%{http_code}" https://subnation.ly/status                  # 200

# junk / size
git ls-files | grep -iE '(^|/)(logs?|tmp|dist|node_modules)/|\.(log|tmp)$|(^|/)env$'   # → (empty)
git ls-files | xargs -I{} du -b "{}" | sort -rn | head -3                                # 466323, 315041, 265831
```

**End of report — R126-A12.**
