# R128-B7 — Docs Truth + GitHub Repository Presentation Audit

- **Agent:** R128-B7 (docs truth + repo presentation lane; READ-ONLY — only writes = this report + one worklog append; no commits, no source edits, no GitHub mutations)
- **Repo:** `SubNation2` @ HEAD `7d469d5` (= `origin/main`; tree clean except untracked `docs/inspection-r128/`)
- **Scope:** README/CHANGELOG/CONTRIBUTING/LICENSE/`.github` truth at HEAD · docs-tree health (index, links, SHA stamps, bucket counts, UX canon, architecture/ops docs) · repo structure + root artifacts + secrets scan · GitHub-side presentation (public fetches, unauthenticated) · excellence-bar upgrades.
- **Predecessors read (not re-reported):** R127-B9 (CI/CD + repo surface), R126-A12 (repo presentation register), R125-A12 (docs truth), R124's `63a27f2` + R126's `0d8980d` presentation commits, R127 round record (CHANGELOG §R127), R128 A1/A2/A3/B1/B3 outlines for boundary.
- **Method:** every numeric claim recounted from the tree (`git ls-files`, per-file parses); e2e flow count includes loop-generated tests; GitHub state from `git ls-remote` + the public repo HTML page (API was rate-limited from this IP); 46 relative links across 8 key docs resolved; no test runs (3.9 GB box, per fleet rule).

---

## 0. Executive summary

The R124→R127 presentation work mostly **holds**: the quickstart is mentally runnable end-to-end, all 46 sampled links resolve, the 4-bucket docs map recounts exactly (50/74/16/1 excluding bucket READMEs), both workflows are now exemplary (B9's F1/F2/F3/F5 directives all landed — verified), and CONTRIBUTING carries the fresh 240/168 counts. But **the shop window itself regressed in exactly the way R126-A12 predicted**: count-stamps live on four surfaces and drift independently — the **README front page still carries the R126 numbers (159/1,076 · 234/2,148) against a HEAD truth of 168/1,159 · 240/2,221**, ONBOARDING is one round behind too (234/159), and the README's "latest deep rounds" pointer stops at R125 while the repo contains the two largest fleets ever (R126, R127 — 16 unindexed report files). The R127 boot-perf story (the round's headline) is absent from both the README Performance section and `docs/PERFORMANCE.md`.

**GitHub-side (the operator's actual shop window): description is set and accurate; topics are NOT set; homepage is NOT set; zero releases; one stray test tag; eight stale spec branches.** This is a 15-minute operator win worth more than any doc commit.

**Findings: P0 0 · P1 0 · P2 1 · P3 8 · P4 4** (13 new; ~7 known-open confirmed still open, §4).

---

## 1. Truth findings (file:line + fix)

### P2

**D1 [P2 · conf 5] — README front-page test counts are one round stale, stamped with a false currency claim.**
`README.md:152-156`: "file counts verified at HEAD, R126 … **frontend 159 test files / 1,076 tests** · **backend 234 test files / 2,148 tests** (230 under `backend/src/**` + 4 under `backend/tests/`…)". HEAD truth (recounted via `git ls-files`): **frontend 168 files** (matches CHANGELOG R127's 168) · **backend 240 files = 236 under `backend/src/**` + 4 under `backend/tests/**`** · test-case counts per the R127 gate record: **frontend 1,159 · backend 2,221**. "verified at HEAD, R126" is now a false attribution — the numbers were true at `186b131` and were invalidated by R127's own test additions without a restamp. This is the R126-A12 §4 prediction recurring on the most-visited page. **Fix:** restamp to 168/1,159 + 240 (236+4)/2,221 and change the attribution to "(recounted R128)" — or better, D-upgrade #3 in §5 (a CI count-drift gate) so the class dies. The e2e claim in the same block ("40/40, 20 spec flows × desktop + mobile-390") **verifies** (20 flows counted incl. loop-generated: auth-gates ×3, mobile-390 ×3).

### P3

**D2 [P3 · conf 5] — README's "latest deep rounds" pointer is two rounds stale.**
`README.md:248-251`: "latest deep rounds: R125 admin-focused, R124 storefront — reports in `docs/inspection-r125/` and `docs/inspection-r124/`". HEAD truth: `docs/inspection-r126/` (14 files) and `docs/inspection-r127/` (16 files — the two largest fleets: 13- and 17-agent) exist; R128 is in flight. A partner following the README's own trail misses the project's best evidence of discipline. **Fix:** "latest deep rounds: R127 (17-agent fleet: supply-chain, sockets, boot perf, audit-trail UI) and R126 (13-agent: Arabic quality, a11y vs live) — full index: `CHANGELOG.md`".

**D3 [P3 · conf 5] — ONBOARDING counts one round behind + its own house rule broken.**
`docs/ONBOARDING.md:83-84`: "(234 files)" / "(159 files)" → truth **240/168**. The header (`:3`) still says "Status: CURRENT @ 2026-10-09 (R126)" — `docs/README.md` house rule 4 says the change that invalidates a doc must touch that line; R127's suite growth invalidated §5 and the line wasn't touched. Note the irony at `:90-91`: "Current suite sizes live in the README's *Tests* section (verified each round)" — the dedup pointer exists, but both ends drifted (D1). **Fix:** restamp 240/168, bump the Status line to R128, and delete the parenthetical counts here (keep the pointer only).

**D4 [P3 · conf 5] — the docs index has no R127 round record at all.**
`docs/README.md` — `rg 'R127|inspection-r127'` → 0 hits. The index's newest round-note block is R126 (`:31-45`); `docs/inspection-r127/` (15 auditor reports + R1 review) is unindexed, and `docs/inspection-r128/` (in flight, 9+ files) likewise. R124/R125/R126 each got a block; R127 got none — the index's "round records" promise ("`CHANGELOG.md` §Round R127 + `docs/inspection-r127/`" pattern) breaks at its newest entry. **Fix:** add the R127 block (mirror the R126 one: fleet shape, headline fixes, pointer to the 16 files) + a one-liner noting R128 in flight; while there, consider §5-upgrade #5 (round ledger table).

**D5 [P3 · conf 4] — the R127 boot-perf story is missing from both performance surfaces.**
`README.md:257-273` (Performance) still tells the R126 story: "idle vendor chunk −30% (469,777 → 328,652 B raw)" etc.; `docs/PERFORMANCE.md:3` says "Status: CURRENT @ 2026-10-09 (R126)" and its newest measured row is R126-A5 (`:25`). HEAD truth: R127's headline work is absent — vendor-sentry **defers to first interaction** (`frontend/src/lib/boot-sentry.ts:28-44`, 111 KB br / 70% unused / 221 ms LCP-phase long task per the R127 record), the budget gate now measures a **DSN-shaped build** (`vite.config.ts:186-215`, R127-L10/B4-D1: no-DSN 146.7 KB under-reports the deployed shape), optimistic `/login`, first-4 card-image warming. The "eager path ≈ 143 KiB / 145 KiB warn / 160 KiB hard-fail" claims still verify (146,700 B ≈ 143.3 KiB; thresholds at `vite.config.ts:179-180`), so this is omission drift, not falsehood. **Fix:** PERFORMANCE.md gains an R127 row (vendor-sentry defer + DSN-parity gate + the R127 measured numbers) + Status bump; README's perf section gains one bullet for the vendor-sentry defer and drops or re-dates the stale −30% numbers.

**D6 [P3 · conf 4] — README's CI gate list is missing the two newest gates; "every push" precision still unfixed (B9 F6, 3rd recurrence).**
`README.md:245-247`: "CI is green on every push (…: secret scan, lint, typecheck, OpenAPI parity, migration + orval drift gates, both unit suites, production build)". Missing vs `.github/workflows/ci.yml` at HEAD: the **CVE gate** (audit job, `:181-239`) and the **impeccable UI anti-pattern gate** (R127, `:302`). "on every push" remains imprecise for docs-only pushes (path filter `:111-138`) — same shape at `docs/ONBOARDING.md:78,88` and `CONTRIBUTING.md:24`. **Fix:** extend the list ("… + CVE gate on prod deps + impeccable UI-anti-pattern gate") and adopt B9-F6's wording ("on every code push — docs-only pushes skip the heavy jobs via ci.yml's `filter`") in all three files.

**D7 [P3 · conf 5] — `docs/ux/FINAL_UX_SYSTEM.md` (the UX canon) is stale in ≥6 spots — full list for the fix lane (coordinated with A1's 3xs/10px + deleted-classes findings):**
1. `:21-22` — "micro-type tokens `--text-2xs` (11px) / `--text-3xs` (10px) — no sub-10px text anywhere" → HEAD truth: **`--text-3xs: 11px`** (`frontend/src/index.css:108`; both tokens 11px). The floor is now 11px; the one surviving exception is recharts' canvas `fontSize: 10` (A3-F3, invisible to the CSS ramp).
2. `:73` — "`.card-enter` (0 consumers, kept)" → **removed in R118-B2** (`index.css:695` carries the removal comment).
3. `:73` — "IA regroup (Users/Referrals under «الكتالوج»)" → **executed R124-I5** as the «الكتالوج والعملاء» group (`frontend/src/pages/admin/layout.tsx:101-117`).
4. `:73` — "sticky-thead inside overflow wrappers" → sticky theads now exist (A3-F2 documents four table-chrome designs incl. the sticky-glass thead).
5. `:73` — "per-row refund button" debt → per-row refund shipped (orders.tsx refund flow + AlertDialog, `frontend/src/pages/admin/orders.tsx:137-264`).
6. `:30-31` — the z-index scale "nav 10 / sticky 30 / overlay 45 / modal 50 / popover 60 / toast 100" does not match code truth: Navbar is `z-50` (`Navbar.tsx:216`), MobileNav `z-50` (`MobileNav.tsx:102`), skip-link `z-[100]` (`App.tsx:858`). Either re-state the scale as aspirational or re-document the actual classes.
Verified still-true: weights 400/600/700 (`index.css:22-27`), font-medium/font-black ban (only test-file mentions remain), press-spring/page-in/float-in/slide-up all exist, `use-on-screen` on blob-drift sites (5 consumers), dead-CSS-deleted claim, admin ≥24px edge-target framing (no contradiction from A3/A5).
**Fix:** a one-commit canon truth pass: `Status: CURRENT @ R128` header + the six corrections above.

**D8 [P3 · conf 4] — on-call runbook's Redis triage step cites the dead Render stack.**
`OPERATIONS_RUNBOOK.md:100-104` (rule `#redis`, §2 — CURRENT on-call material): "2. Render Redis service status. Free tier evicts under memory pressure — see scaling thresholds (§5)." Render has been dead legacy since 2026-10 (runbook §5 itself carries the R118 correction and labels the Render pools LEGACY), and the live topology runs **Redis-optional/unset** (in-process fallbacks — README:102, source-of-truth). A 3 a.m. responder following step 2 chases a dashboard that no longer serves anything. `/api/healthz/redis` exists (`backend/src/routes/health.ts`) ✓. **Fix:** rewrite step 2: "The target topology runs with `REDIS_URL` unset (in-process fallbacks) — if this alert fires, someone set Redis; check the Coolify env table + `/api/healthz/redis` latency/failure counter, then decide whether to keep or unset it."

**D9 [P3 · conf 4] — architecture capacity row cites two dead hosts.**
`docs/architecture/PRODUCTION_ARCHITECTURE.md:209`: "subnation (Node 22, pnpm runtime) | ~250-400 MB | measured on Render free 512 MB with headroom (pre-migration evidence; re-verify on the Oracle A1 at first boot)". Both Render and Oracle A1 are dead; production is Contabo + Coolify, and the topology doc (`FINAL_PRODUCTION_TOPOLOGY.md`, the declared authority) is correct. **Fix:** one line — keep the pre-migration measurement labeled historical, replace the instruction with "re-verify via `docker stats` on the Contabo host (topology doc §8)".

### P4

**D10 [P4 · conf 4] — the R127 ledger's headline contract number is off by one vs the tree.**
CHANGELOG R127 (`CHANGELOG.md:67-69`) + commit `0b61619`'s message: "OpenAPI batch-2: 10 highest-cadence ops … admin family 52→62; contract suite 38→49". Tree truth (parsed `shared/api-spec/openapi.yaml`): admin-tagged ops **45→56 (+11)** across `6465dcb`→`f029a63` (the spec landed in `f029a63`; `0b61619` consumed it), and under the family definition B1 itself used (admin + copilot tags: 45+7=52 pre ✓) the post-batch count is **63, not 62**. The "contract suite 38→49" half **verifies** (49 `it(`/`test(` in `backend/src/__tests__/openapi-response-contracts.test.ts`). **Fix:** bracketed note in the R128 CHANGELOG entry ("R127 correction: batch-2 landed 11 ops — admin family 52→63; the 62 was a plan-time count"), per the repo's own no-retro-edit convention.

**D11 [P4 · conf 5] — GitHub-side presentation gaps (operator actions; see §2).** Topics unset, homepage unset, 0 releases, 1 stray tag, 8 stale branches.

**D12 [P4 · conf 4] — `vars.E2E_BASE_URL` still undocumented (B9-F8, open since R127).** `rg` over README/CONTRIBUTING/ONBOARDING/docs → 0 hits; the e2e job still silently defaults to `localhost:8080` on a hosted runner (`ci.yml` e2e env). **Fix:** one row in CONTRIBUTING's gates section.

**D13 [P4 · conf 3] — README "Notes" explains only `ruflo/`.** `README.md:343-346` covers the gitignored `ruflo/` dir but not the tracked AI-tooling trio at root (`.hermes.md` agent contract, `.kiro/` 44 KB spec/inspection artifacts, `.specify/feature.json`). All three are small, intentional, and self-describing — but a first-time visitor's last impression of the README is a note about a directory that isn't even there. **Fix:** one sentence covering all four, or drop the Notes section.

---

## 2. GitHub-side presentation (public, unauthenticated; API rate-limited → git + HTML page)

| Surface | State | Verdict |
|---|---|---|
| Description | **SET** — "Arabic-first (RTL) digital-subscriptions marketplace for Libya — React 19 + Express 5 + Postgres, passwordless auth, instant encrypted delivery, full admin panel. Live at subnation.ly" | ✅ accurate, keyword-rich |
| Topics | **NOT SET** (0 topic tags on the page) | ❌ the single cheapest visibility win |
| Homepage / website | **NOT SET** (no link row in the About sidebar) | ❌ should be `https://subnation.ly` |
| Default branch | `main` ✓ (matches local HEAD `7d469d5` via `git ls-remote`) | ✅ |
| Social preview | auto-generated OG image (no custom upload) | ⚠️ operator checklist: upload `frontend/public/opengraph.jpg` or a storefront shot |
| Releases / tags | **0 releases; 1 tag** (`v0.0.1-coolify-test`, 2026-10-01, an R115-era test artifact — B9 §6/R127-L4 documented its run never completed) | ❌ "ships by round" is invisible on GitHub itself |
| Branches | `main` + **8 stale spec branches** (`003-anomaly-detection` … `010-ai-admin-copilot` — the specs/ era lives on in refs) | ⚠️ clutter; safe to delete (specs/ dirs remain in-tree) |
| Branch protection | not visible unauthenticated | operator checklist: require CI on `main` (the repo's whole quality story rides on it) |

Also checked from the repo side: bug/feature issue templates ✓, PR template ✓, no FUNDING.yml (fine at this stage), no Dependabot (documented decision, `ci.yml:171-177` — the note itself says the revisit condition is now MET), gitleaks config + always-on secret scan ✓, all workflow `uses:` SHA-pinned (0 unpinned refs repo-wide — B9-F1 fix verified landed, including e2e's three refs + HUSKY/cache hygiene).

**Security scan of presentation surfaces:** `config/env.example`, `deploy/env.compose.example`, `frontend/.env.example` — no real-looking tokens/keys (placeholder patterns only); `.specify/feature.json` is a path pointer; gitleaks full-history gate runs on every push. No findings.

---

## 3. Verified-OK register (sampled, with evidence)

1. **Quickstart runs mentally end-to-end:** `pnpm install` (preinstall enforces pnpm, root `package.json`) → `cp config/env.example .env` (file exists, annotated) → `pnpm run dev` (script → `@workspace/scripts` dev; boot migrations per README schema note ✓ `backend/src/migrate.ts` exists) → `pnpm run db:seed` ✓; `build`/`start`/`lint`/`typecheck` all exist as documented; engines `node>=22`/`pnpm>=10` match the badges; `.nvmrc` = 22.
2. **e2e "40/40 (20 spec flows × 2 projects)"** — 20 flows statically verified (incl. loop-generated: auth-gates 3, mobile-390 3; 10 spec files; 2 projects in `playwright.config.ts:29-40`).
3. **46/46 relative links resolve** across README, CONTRIBUTING, docs/README, ONBOARDING, PERFORMANCE, API.md, OPERATIONS_RUNBOOK, FINAL_UX_SYSTEM (scripted check, 0 dead).
4. **Docs 4-bucket counts recount exactly:** CURRENT 50 (36 md + 13 mmd + 1 json) · HISTORY 74 (+1 bucket README) · DEPRECATED 16 (+1) · PENDING 1 (+1) — unchanged since R126; `SEO_PRODUCTS.json` still 45 entries ✓; 13 `.mmd` maps ✓.
5. **CONTRIBUTING restamp verified:** 240/168 file counts match the tree (236+4 backend, 168 frontend); round-report conventions, orval/drizzle/money-law sections accurate.
6. **Workflows post-R127 are exemplary:** `docker.yml` header rewritten as the DR-publisher truth (B9-F5 executed: dead Oracle rationale removed, arm64 leg dropped, "NOT YET VERIFIED" banner replaced by a verified status + explicit operator step); `ci.yml` quality job split into checks/unit-tests(matrix)/build (W1 executed); zizmor's 13 findings structurally closed (0 unpinned `uses:`; job-level permissions; HUSKY/cache hygiene in e2e).
7. **CHANGELOG R122-R126 entries exist** (headers at :117/:244/:360/:482/:606) and spot-check accurately (R126 counts verified by B9 at `f53a886`; R126's LICENSE/templates/files landed per `0d8980d` stat).
8. **SHA stamps in deployment docs are dated-ledger records** (signoff/command-book/restore drills — house rule: no retro-editing); the non-git hashes (`3680136b…` sha256 backup, `99771185` Neon project id, `ba6a843` openwa image tag) are correctly non-commit values.
9. **`source-of-truth.md` canonical rows** remain accurate (R125-R127 changed no topology facts); Sentry/Telegram/redirect statuses consistent across the index, runbook §11-13, and topology doc.
10. **SECURITY.md** honest (advisory channel + no-security.txt note); LICENSE MIT present and matches the badge.
11. **Repo layout table** (README:110-125) matches the tree; every directory described exists with the described role; `scripts/` is organized and self-documenting; root carries no logs/scratch/artifacts (git status clean).

---

## 4. Known-open items confirmed still open (pointers, not re-reported)

| Item | Source | State at HEAD |
|---|---|---|
| `develop` in ci.yml branch filters | R126-A12 D3 | still present (`ci.yml:5,7`), queued for a config-touching round |
| No `.editorconfig` | R126-A12 R4 | absent |
| `backend/.env.example` absent while `.gitignore:45` whitelists it | R126-A12 R7 | unchanged |
| `.hermes.md:54` "No automatic deploys" vs push-to-deploy nuance | R127-B9 F7 | un-addressed (ONBOARDING:63-64 still quotes it bare) |
| `vars.E2E_BASE_URL` undocumented | R127-B9 F8 | still 0 doc hits (→ D12) |
| `docs/NEON_MCP_SETUP.md` root placement | R126-A12 §8.2 | still at docs root, still indexed |
| "CI on every push" precision ×3 files | R127-B9 F6 | still open (→ D6) |

---

## 5. Excellence-bar upgrades — top 5, ranked by impact for THIS repo

1. **GitHub metadata + round releases (operator, ~15 min, zero commits — biggest first-impression win).** Set ~8 topics (`arabic`, `rtl`, `e-commerce`, `libya`, `react`, `express`, `typescript`, `postgres`, `drizzle`, `digital-subscriptions`); set homepage to `https://subnation.ly`; delete the 8 stale spec branches; tag each round (`r127`, `r128`, …) and cut a GitHub Release whose body is the CHANGELOG entry — the project's "ships by round, no semver" story finally gets its native GitHub surface (the Releases tab is currently empty, which reads as "inactive" to a passer-by); upload a social preview (reuse `frontend/public/opengraph.jpg`). Check branch protection while there.
2. **README truth restamp (one commit, closes D1/D2/D5/D6/D13).** Counts 240(236+4)/2,221 · 168/1,159 "recounted R128"; latest-rounds line → R127+R126; CI list + the two missing gates + "every code push" wording; perf section gains the R127 boot story; Notes covers the whole root AI-tooling set.
3. **A docs-count drift gate in CI (kills the class A12 predicted twice).** This repo already CI-gates OpenAPI↔routes, drizzle drift, and orval drift — add a 20-line check that greps the stamped counts (test files, suite sizes, admin-op family) in README/CONTRIBUTING/ONBOARDING and fails on mismatch with the tree. Would have caught D1, D3, and R127-B9's F4 — the same drift class, three rounds running.
4. **Screenshots: show the Arabic RTL product (README already embeds 3 desktop shots; A2 just banked 35 verified JPEGs).** Add two: **mobile home** (`screenshots-a2/m-home.jpg` — the 390px RTL grid is the product's differentiator) and **a money page** (`d-cart.jpg` or `m-gate-wallet.jpg` — wallet/cart honesty is the pitch) into `docs/assets/screenshots/` (≤80 KB each, same as the existing three) with a two-line mobile section. One admin shot would complete the story once A3's lane has one worth showing.
5. **Round-ledger visibility + the truth batch (closes D3/D4/D7/D8/D9).** docs/README gains an R127 round-record block + a compact round table (round → date → theme → report dir), making 35 rounds of disciplined evidence one glance for a partner; same commit carries the ONBOARDING restamp, the UX-canon truth pass (§1-D7's six spots), the runbook Redis-triage rewrite, and the architecture capacity row.

---

## 6. Next actions (ordered)

1. Operator: §5-1 (GitHub metadata + branches + release for R128 when it lands).
2. Docs commit 1: README restamp (D1/D2/D5/D6/D13) + ONBOARDING (D3) + docs/README R127 block (D4).
3. Docs commit 2: UX canon + runbook Redis + architecture row (D7/D8/D9) — the canon list is coordinate-with-A1-ready as written.
4. CI commit (next config-touching round, bundling the `develop`-filter removal): the docs-count drift gate (§5-3) + `E2E_BASE_URL` doc row (D12).
5. CHANGELOG R128 entry: the D10 bracketed correction (admin family 52→63) so the ledger self-heals per its own convention.

---

*End of report — R128-B7. Tools: git + node (built-in) + curl (public GitHub page; API rate-limited from this IP). Nothing installed into the repo; no commits; no pushes; no GitHub mutations; no test runs.*
