> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r117/merge-deploy-docs.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R117-A3 — Merge quality, deploy/config truth, and docs drift audit

> Agent: R117-A3 (read-only). Range audited: `47b304e..f10bb9b` (merge `7cee846` + follow-up `f10bb9b`), with lineage checks against `afd7c0a` (merge-base), `7376d93` (canonical-main docs side), `ca67360`+`6b4c88b` (R116 overhaul side), and current HEAD `f10bb9b` (working tree clean except this inspection dir).
>
> Method: three-file-side merge forensics (`git diff` of each parent against the merge result), deploy-chain cross-checks (Dockerfile ↔ docker-compose.yml ↔ docs/deployment/COOLIFY_FINAL_SETUP.md ↔ deploy/env.compose.example ↔ scripts/src/validate-production-env.ts), and line-level verification of every money-invariant cite against current source.

**Severity totals: P0: 0 · P1: 0 · P2: 2 · P3: 8 · plus 12 VERIFIED-OK clusters.**

---

## Part 1 — Merge quality (`7cee846`)

### The merge is a clean, lossless union (see VERIFIED-OK #1) — but two *semantic* losses exist downstream

The mechanical resolution is provably lossless: the docs side (`3a9df27..7376d93`, merge-base `afd7c0a`) touched exactly **3 files** (`docs/FINAL_MONEY_INVARIANTS.md`, `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md`, `docs/architecture/PRODUCTION_ARCHITECTURE.md`); the overhaul side touched **103 files**; the intersection is **empty**, so git could not drop a hunk. In the merge result the 3 docs files are **byte-identical to `7376d93`** (`git diff 7376d93 7cee846 -- <those files>` = 0 lines) and all 103 overhaul files are **byte-identical to `6b4c88b`** (`git diff 6b4c88b 7cee846 -- backend frontend shared render.yaml` = 0 lines). No conflict markers anywhere. The feared both-sides files (`render.yaml`, `app.ts`) were **overhaul-only** — no conflict was possible.

However, "no dropped hunks" ≠ "no lost meaning". The docs side's line-cite fixes were computed against the **pre-overhaul** tree while the merge kept the **overhaul** code — producing findings #2 and #4 below. This is the silently-invalidated-commit class this audit was asked to catch.

---

## Findings

### 1. [P2] Drizzle mirror drift: V1-M23 shipped to schema + runtime chain but the mirror chain was never re-emitted (no `0015`)

**Evidence:**
- `shared/db/src/schema/wallet_topups.ts:41` — `reviewedBy: varchar("reviewed_by", { length: 100 })` (added by the overhaul, A4-04/R116).
- `backend/src/migrate.ts:1362-1381` — `V1-M23 (R116, A4-04): wallet_topups.reviewed_by`, `ALTER TABLE wallet_topups ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100)` — the runtime chain is correct and idempotent.
- `shared/db/drizzle/` — max migration is `0014_fuzzy_jazinda.sql`; `grep -rln reviewed_by shared/db/drizzle/` → **no match**; `meta/_journal.json` ends at `idx: 14, tag: "0014_fuzzy_jazinda"`.
- `.github/workflows/ci.yml:288-296` — the drift gate: `pnpm --filter @workspace/db exec drizzle-kit generate` then fail on diff ("Drizzle migration drift detected…").
- `docs/architecture/PRODUCTION_ARCHITECTURE.md:133-136` — "the Drizzle chain **mirrors it** for the CI drift gate" (now false).

**Impact:** The documented mirror invariant is broken. The moment GitHub Actions billing is restored (CI is currently dead — see VERIFIED-OK #6), the drift gate fails loudly; until then, any local `drizzle-kit generate` emits a confusing "new" 0015 that only re-states V1-M23. R110 (`0013`) and R115 (`0014`) both re-emitted the mirror precisely to keep this green — R116 (and the merge) skipped the step. Production DB is **not** at risk (the boot reconciler owns the live schema; `README.md` documents no-`db:push`), which is why this is P2, not P1.

**Fix:** Run `pnpm --filter @workspace/db exec drizzle-kit generate`, commit the resulting `0015` + journal update (r110/r115 precedent), and update `PRODUCTION_ARCHITECTURE.md` §3 (see finding #4).

---

### 2. [P2] FINAL_MONEY_INVARIANTS.md M3 line-cite "fix" was invalidated by the merge itself — `wallet.ts:349` is a stray `);`; the guard is at `:365`

**Evidence:**
- The fix commit `38d510a` (docs side, on the pre-overhaul tree) changed M3 `wallet.ts:301` → `wallet.ts:349`. At the merge-base `afd7c0a` the guard indeed sat at line 349 (`git show afd7c0a:backend/src/routes/wallet.ts` → `349: if (method === "mobile_transfer" && paymentReference === null) {`) — the fix was correct **for the wrong side of the merge**.
- The overhaul then changed `wallet.ts` (58 lines) and the merge kept the overhaul version; at HEAD the guard is at **`wallet.ts:365`**: `365: if (method === "mobile_transfer" && paymentReference === null) {`.
- Current doc `docs/FINAL_MONEY_INVARIANTS.md:14` — "`wallet.ts:349` rejects `mobile_transfer` with a null `payment_reference`". Actual line 349 is `          );` (the tail of the sender-phone length error). The B4-R1 comment block starts at :353.
- Trace across the range: guard at `301` (R112 `521234f`) → `349` (`47b304e`/`afd7c0a`, r113–r115 growth) → `365` (HEAD).

**Impact:** The money contract of record — the doc every future auditor is told to "start from" — points at a no-op line for the exact invariant (M3) this range's own commit claimed to fix. The invariant itself and its regression suite (`wallet-topups-payment-reference.test.ts`) are intact; this is a cite-only defect, but it silently undid the entire purpose of `38d510a`.

**Fix:** `wallet.ts:349` → `wallet.ts:365` in `docs/FINAL_MONEY_INVARIANTS.md` (one-line edit; consider a note that line cites are pinned per-HEAD and re-check on every code merge that touches wallet.ts).

---

### 3. [P3] FINAL_MONEY_INVARIANTS.md M2 cites are also stale (pre-existing drift the R116 fix pass missed)

**Evidence:** `docs/FINAL_MONEY_INVARIANTS.md:13` — "`wallet.ts:383-406` — `eq(paymentReference, …)` inside the tx; `MAX_PENDING = 3` at `wallet.ts:365`". At HEAD: `const MAX_PENDING = 3;` is at **`wallet.ts:429`**, the creation `db.transaction` at **`:430`**, and `eq(walletTopupsTable.paymentReference, paymentReference)` at **`:454`** (in-tx dedup block ≈ `:447-470`). These cites were already stale at `47b304e` (guard era: MAX_PENDING at 413) — stale since the r113–r115 rounds, never fixed. Hazard bonus: line **365 today contains the M3 guard**, so a reader chasing the M2 "MAX_PENDING at :365" cite lands on the wrong invariant.

**Fix:** Update M2 to `wallet.ts:430-470` (tx) and `MAX_PENDING = 3 at wallet.ts:429` in the same edit as finding #2.

---

### 4. [P3] PRODUCTION_ARCHITECTURE.md (the 3a9df27 consolidation) kept pre-overhaul facts that now contradict merged code

**Evidence** (`docs/architecture/PRODUCTION_ARCHITECTURE.md`):
- `:61` — "business schema (boot reconciler, **V1-M6…V1-M22**)" and `:134` — "labeled stages **V1-M6 … V1-M22** — the current chain" and `:144` — "Current max stage is **V1-M22**" → actual chain max is **V1-M23** (`migrate.ts:1362`).
- `:138-139` — "Drizzle chain … **0000–0014** at HEAD `6caa63b` (r115…)" → schema source is now ahead of the chain (finding #1); the "current" pin is two rounds old.
- `:169` — "`mobile_transfer` requires a payment reference M3 — `wallet.ts:301`" → a *third* M3 cite (301, not even the 349 the docs side fixed elsewhere, nor the true 365).

**Impact:** The consolidated deep-reference doc — written on the docs branch against `afd7c0a`-era code and kept verbatim by the merge — now misstates the migration chain and repeats the stale M3 cite. Topology content (Coolify/Neon/Cloudflare) is accurate; these are the stale claims it kept.

**Fix:** Update :61, :134, :138-139, :144 to V1-M23 / 0000–0015 (after finding #1's re-emit) and :169 to `wallet.ts:365` (or drop the inline line number and point at FINAL_MONEY_INVARIANTS.md as the single cite-owner).

---

### 5. [P3] `f10bb9b` collateral: the A7-2 boot warning was deleted along with the www redirect — dead export + two stale doc claims

**Evidence:**
- `git show f10bb9b -- backend/src/app.ts`: the commit that "remove[s] www→non-www redirect" also deleted `import { warnLegacySplitOriginEnvAtBoot }` and its call — nothing in the message mentions the warning.
- `backend/src/lib/origins.ts:34-38` — the export survives with a docstring still claiming "Called from app.ts module scope"; repo-wide grep: **zero call sites** (dead code).
- `render.yaml:76-83` (A7-2 comment, added by the overhaul) — "the backend folds it into CORS/CSRF/Socket.IO and **warns at boot** while it is set" → the folding still happens (`origins.ts:11-21` reads FRONTEND_ORIGINS/VERCEL_FRONTEND_ORIGIN) but the boot warn no longer exists.

**Impact:** The split-era-origin hygiene signal R116 added is silently gone; the docstring and the render.yaml comment now document behavior that doesn't exist. (Corroborates R117-A1 finding #2 — same defect found from the backend side; listed here because the render.yaml/doc-claim half belongs to this audit.)

**Fix:** Either restore the one-line call in `app.ts` (preferred — it was a names-only, never-throws warn) or delete the export and amend the render.yaml comment + origins.ts docstring. One commit, three lines.

---

### 6. [P3] `.specify/feature.json` is invalid JSON — stray `j` committed after the closing brace

**Evidence:** `cat .specify/feature.json` → `{ "feature_directory": "specs/010-ai-admin-copilot" }` followed by two blank lines and a lone `j`. `node JSON.parse` → "Unexpected non-whitespace character after JSON at position 58". The stray `j` came in with `919ad39` ("Add feature directory to feature.json") — looks like an accidental keystroke.

**Impact:** Content is harmless (a feature-directory pointer; nothing in the app reads it), but the file is malformed and will confuse any tooling that parses `.specify/` state.

**Fix:** Delete the trailing `j` (+ blank lines) in a housekeeping commit.

---

### 7. [P3] README.md's new schema-workflow note cites a script deleted a week earlier (`scripts/post-merge.sh`)

**Evidence:** `README.md` (added in `afd7c0a`, +27/−4): "The `drizzle-kit push` script is intentionally not part of the workflow — it generates SQL this schema rejects and can drop tables that exist only in production (see `scripts/post-merge.sh` and `docs/deep-audit-2026-09-06.md`)." — `scripts/post-merge.sh` does not exist at HEAD; `git log --diff-filter=D` shows it was **deleted in `c73e6f9` (r113, 2026-09-25)**, eight days before the README edit. Only `.husky/_/post-merge` (husky's internal shim) remains.

**Fix:** Drop the `scripts/post-merge.sh` reference (the deep-audit doc reference is valid) or replace with the actual r113-era explanation wherever it lives.

---

### 8. [P3] docs/deployment/FINAL_PRODUCTION_ENV.md still says render.yaml pins the Vercel origin — removed by A7-2 in this range

**Evidence:** `docs/deployment/FINAL_PRODUCTION_ENV.md:157` — "`VERCEL_FRONTEND_ORIGIN` | render.yaml pins `https://subnation-seven.vercel.app` — Vercel→Render split remnant…". The range's `render.yaml` diff removes exactly that pin (A7-2 comment block, lines 76-83). The operational advice ("DO NOT SET — single-origin stack") remains correct, and `docs/deployment/ENVIRONMENT_MATRIX.md:54` is already accurate ("leave unset on the single-origin stack"), but the factual claim about render.yaml is now false.

**Fix:** Update the row to "render.yaml pin REMOVED (R116 A7-2); code still reads it in `lib/origins.ts` for rollback compat — leave unset".

---

### 9. [P3] r116-round-report.md "known follow-ups": "A4-05 server-side product search — not started" contradicts the code

**Evidence:**
- `docs/r116-round-report.md:97-98` — "A4-03 wallet-history admin tab + A4-05 server-side product search — not started (stretch scope)."
- Server-side product search **exists and is wired**: `backend/src/routes/products.ts:236-243` — `sql`${productsTable.name} ILIKE ${"%" + escapeLikeTerm(search.trim()) + "%"}`` (SQL-side pushdown, live for search requests per :221-228); existed at `47b304e` unchanged in shape; **R116 itself hardened it** (A6-9 LIKE-escape, :237-239). The storefront wires it: `frontend/src/pages/home.tsx:242` — `if (search) params.search = search;` feeding `getListProductsQueryKey(params)`.

**Impact:** The follow-up list entry is inaccurate as written (it may have meant a *narrower* enhancement — e.g. beyond-name/full-text search — but the report doesn't scope it), and it undersells this round's own A6-9 work. The other follow-up claims check out (see VERIFIED-OK #9).

**Fix:** Reword to the actual remaining gap (e.g. "search covers `name` only — description/variant/typo-tolerant search not started") or drop the entry.

---

### 10. [P3] Canonical-host direction is now undocumented and self-inconsistent after `f10bb9b` — SEO canonical/og URLs point at the redirecting apex

**Evidence:**
- `f10bb9b` app.ts comment: "Cloudflare/Traefik already issues **non-www→www** (307), so the old 301 created a bidirectional loop. The canonical host is now enforced solely by the external proxy layer." → www is the serving host.
- But every canonical-URL source still points at the apex: `backend/src/routes/seo.ts:18` — `APP_ORIGIN = process.env.APP_URL || "https://subnation.ly"` (sitemap/robots); `frontend/src/components/seo/MetaTags.tsx:62-68` — `getAppOrigin()` prefers `VITE_APP_ORIGIN` (Coolify §2.2 pins `VITE_APP_ORIGIN=https://subnation.ly`) over `window.location.origin`; `render.yaml:73-75` — "Canonical apex + www"; `deploy/env.compose.example:24` — `APP_URL=https://subnation.ly`.
- `docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md:20,37` documents `www CNAME → apex` (DNS alias) but **no apex→www 307 rule** — the redirect that motivated f10bb9b exists only in the code comment.

**Impact:** Canonical tags, sitemap URLs and og URLs all reference a host that 307s elsewhere. Not fatal (search engines follow redirects) but it defeats the "wrong origin in prod means Google indexes the wrong canonical" discipline `seo.ts:14-16` documents, and no doc records the direction flip.

**Fix:** Decide the canonical host (likely www, since the proxy enforces it), then align `APP_URL`/`VITE_APP_ORIGIN`/`APP_ORIGINS` docs + render.yaml comment + a one-paragraph note in CLOUDFLARE_FINAL_CUTOVER.md or FINAL_PRODUCTION_TOPOLOGY.md recording the 307 rule and why the in-app redirect was removed.

---

## VERIFIED-OK

1. **Merge `7cee846` is mechanically lossless.** Merge-base `afd7c0a`; docs side changed 3 files, overhaul side 103, intersection ∅ → no conflicts possible. `git diff 7376d93 7cee846 -- docs/FINAL_MONEY_INVARIANTS.md docs/architecture/*` = 0 lines (docs consolidation preserved byte-exact); `git diff 6b4c88b 7cee846 -- backend frontend shared render.yaml` = 0 lines (entire overhaul preserved byte-exact, incl. `render.yaml` and `app.ts` — both overhaul-only files, so neither could be reverted by the docs side). No `<<<<<<<`/`>>>>>>>` markers anywhere. Commit message accurately describes the resolution.
2. **M4 money-invariant cite fix is correct at HEAD.** `docs/FINAL_MONEY_INVARIANTS.md:15` cites `checkout.service.ts:294` (`.transaction(async (tx) => {` — exact) and `INSUFFICIENT_BALANCE` at `:253` (exact, `checkout.service.ts:253`). The overhaul did not touch checkout.service.ts, so the 7376d93 fix survived the merge. (":255 race-free selection" is the fast-fail comment that points into the tx — acceptable.)
3. **Other money cites still hold at HEAD:** M1 `topup.service.ts:82-127` (tx at :83, optimistic-lock UPDATE comment at :126-128); M5/M6 `checkout.service.ts:141-166` (F10 pre-tx replay block); M7 `refund.service.ts:271` (post-commit emission principle); M12 `migrate.ts:1099` (V1-M20 header still exactly at :1099 — V1-M23 was appended below, no shift).
4. **render.yaml is internally consistent *as a frozen legacy file*.** Header (lines 1-11) declares it LEGACY/FROZEN rollback-only, explains the baked-in `subnation2.onrender.com` VITE pins, and forbids re-apply; the A7-2 edit removed `VERCEL_FRONTEND_ORIGIN` exactly as R116 claimed (diff `47b304e..f10bb9b -- render.yaml`: -10 legacy lines, +8 explanation lines) and the remaining APP_ORIGINS/`lax` cookie posture match the Coolify shape. `VERCEL_FRONTEND_ORIGIN` remains read by `lib/origins.ts:14` for rollback compat — consistent with the A7-2 comment's FRONTEND_ORIGINS escape hatch.
5. **Deploy source of truth + env coverage are consistent across the whole chain.** Coolify/Docker is the production path (render.yaml's own header says so). Dockerfile ARG/ENV list (Dockerfile:53-113) ↔ docker-compose.yml build args (lines 82-99) ↔ `docs/deployment/COOLIFY_FINAL_SETUP.md` §2.2 build-args panel match **exactly**, including the intentional single-origin empties (`VITE_API_BASE_URL`/`VITE_SOCKET_URL`/`VITE_API_URL` left unset — documented as CRITICAL in §2.2 and in the compose header contract). Runtime env: `scripts/src/validate-production-env.ts:317-339` required set ⊆ `deploy/env.compose.example` + COOLIFY §2.3 (compose profile adds the OPENWA_*/PERSISTENCE_URL block — all present). The openwa service carries only its documented minimal read-set.
6. **CI workflows exist and were untouched in the range** (`ci.yml`, `deploy.yml`, `docker.yml`; `git diff 47b304e..f10bb9b -- .github/` = empty). The CI-dead reality (Actions billing suspended) is honestly documented in the compose header (r113 note: GHCR package "NOT published yet… until then redeploy-from-git is the only path") and COOLIFY_FINAL_SETUP.md §2.3's PENDING note.
7. **r99 ARG fix retained + healthchecks/start match the docs' promises.** `Dockerfile:59-61` declares `VITE_API_BASE_URL`/`VITE_SOCKET_URL`/`VITE_GA_TRACKING_ID` (re-exposed as ENV at :98-100); `HEALTHCHECK … /api/healthz` with 150 s start-period (Dockerfile:188-189) mirrored in compose (:125-130) and matching COOLIFY §2.1; `CMD ["node", …, "backend/dist/index.mjs"]` (PID 1) + `FRONTEND_DIST=/app/frontend/dist/public` (Dockerfile:138) matches `app.ts` `resolveFrontendDist()` (reads FRONTEND_DIST first) and the documented single-origin "backend serves the SPA" contract. `frontend/dist/public/index.html` exists at HEAD.
8. **SEO_PRODUCTS.json: valid JSON, 45 entries, honest growth.** `node` parse OK (array of 45); 8 entries at `47b304e` → 45 at HEAD (+37, exactly as `r116-round-report.md:87` and `seo-enrichment-r116.md` claim); the range diff is **2369 pure insertions, 0 deletions**; the old 8 entries are preserved in place (first 510 lines byte-identical; the only old byte touched is the array terminator `}` → `},`). Minor wording nit: `seo-enrichment-r116.md` §1/§6 claims the old file is a "literal prefix" of the new — true for the entry content, off by the terminator byte.
9. **seo-enrichment-r116.md operator command references a real script.** `scripts/src/import-seo.ts` exists, with dry-run default and `--apply` / `--apply --force` / `IMPORT_SEO_APPLY=true` semantics exactly as documented (`import-seo.ts:21-23`, `scripts/package.json:10` alias `import-seo`), matching the doc §5 commands.
10. **r116-round-report.md claims spot-verified TRUE:** "Render blueprint Vercel-origin pin removed" ✓ (see #4); `reviewed_by` V1-M23 ✓ (migrate.ts:1362-1381); `statusColor()` fully retired ✓ (only deprecation comments remain — no definition/call sites); backend **163** test files ✓ (159 in `backend/src/**` + 4 in `backend/tests/`); frontend **108** ✓ (independently confirmed by R117-A2's full-suite run: 108 files / 747 tests PASS); TOTP absent ✓ (no `totp` in `routes/auth.ts`); A4-03 wallet-history admin tab absent ✓; "Admin local CopyButton still separate" ✓ (`admin/topups.tsx:323` local function vs `admin/orders.tsx:3` importing the shared `@/components/CopyButton`).
11. **PRODUCTION_ARCHITECTURE.md topology core matches the real final topology:** Oracle VM → Coolify/Traefik → subnation :8080 (API+Socket.IO+SPA, single image) + openwa :2785 internal → external Neon + Cloudflare front (§0/§1, lines 28-73); no Render/Vercel anywhere in the runtime path (§5-§8 keep them as history only); the single-origin contract text matches compose/COOLIFY docs. `FINAL_PRODUCTION_TOPOLOGY.md`'s only range change is a pointer-edit describing PRODUCTION_ARCHITECTURE.md as the deep reference — accurate.
12. **README migration-workflow doc (afd7c0a) matches code reality:** no `db:push` step; boot migrations in `backend/src/migrate.ts` run on every cold start (V1-M23 follows the documented discipline: `ADD COLUMN IF NOT EXISTS`, probe-free/idempotent); local Docker Postgres snippet is sound; `db:seed` idempotence claim consistent with the seed script's stated design. (`VITE_APP_VERSION` is ARG-declared in the Dockerfile but not passed by compose/Coolify — harmless: `frontend/src/instrument.ts:41-44` falls back to `VITE_RELEASE_SHA` → `"production"`.)

---

## Next actions (priority order)

1. **Drizzle re-emit for V1-M23** (finding #1) — one command + commit; keeps the documented mirror invariant and unfuses a future CI failure.
2. **One docs commit for the money cites** (findings #2, #3, #4): M3 → `wallet.ts:365`, M2 → `:429-470`, PRODUCTION_ARCHITECTURE.md stage/chain/M3 mentions → V1-M23 / 0000–0015 / `:365`.
3. **Restore or delete the A7-2 boot warn** (finding #5) + amend the render.yaml comment and origins.ts docstring to match reality.
4. **Canonical-host decision** (finding #10): pick www (proxy-enforced) or apex, align APP_URL/VITE_APP_ORIGIN, and document the 307 rule in the Cloudflare/topology docs.
5. Housekeeping batch (findings #6-#9): feature.json trailing `j`, README post-merge.sh reference, FINAL_PRODUCTION_ENV.md render.yaml row, r116 report A4-05 wording.

*No repo files were modified by this audit; the only file created is this report (plus the worklog entry outside the repo).*
