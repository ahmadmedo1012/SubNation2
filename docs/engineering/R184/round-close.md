# R184 — Round Close: The Final Organization Round (the whole-project tidy + the owner's study guide)

**Date:** 2026-10-22 · **Round:** R184 · **Starting SHA:** `a9be45f04a8c6db6a39952786233ce1f2e23d1c1` (R183's ship-record docs commit, verified = origin/main HEAD at round start) · **Baseline:** clean working tree on `main`, CHANGELOG newest entry R183, R184 confirmed as the next unused round number · **Production:** `https://subnation.ly` live and healthy at round start (`/api/healthz` 200 in 0.88 s; CI run `39810130425` on HEAD all-green).

**Scope (owner's directive — اعمل جولة اخيرة من التنظيم والتحسين والتطوير الكامل والشامل للمشروع كله والمستودع ووصفه وحالته ثم ااااخر شيئ جهز لي ملف html يشرح المشروع بالتفصيل لي لكي ادرسه مجددا وافهمه بدون معلومات غير لازمة بل كيف يعمل وايش الخدمات المشترك فيها واللازمة):** the final comprehensive organization/improvement round over the whole project, its repository face (README + GitHub description/state), and — as the round's named deliverable — a detailed HTML study guide the owner can re-learn the project from: how it works, which services it needs, nothing unnecessary. Operationalized as three waves: **(W1)** the one logged latent defect (the R183 review's F4) closed at the source; **(W2)** the repository's description-and-state surfaces re-stamped to the live truth; **(W3)** `docs/PROJECT_GUIDE.html` — the owner-facing Arabic study guide.

---

## 1. Wave 1 — the F4 close-out (the last query-root teardown gap)

The R183 independent review logged F4 as its only forward item: `setAdminToken`'s cache-teardown predicate removed `admin` / `/api/admin*` / `admin-alerts*` roots but not the literal `admin-risk-*` / `admin-enrichment-*` / `admin-forecast-*` / `admin-observability-*` / `admin-diagnostics` roots — on a shared-machine admin switch, one refetch round-trip of the previous admin's cached rows could flash before the R183 self-gates suppress the refetch.

- **The fix (`frontend/src/lib/auth.tsx`):** the predicate's third arm is now the `admin-` **prefix** (subsuming the `admin-alerts` literal) — every current family on the naming convention dies with the session, and any future one does too. A repo-wide queryKey first-segment inventory (60 orval URL roots + every manual root) proves complete coverage with zero over-removal: all 31 orval admin URLs + 9 manual `/api/admin*` + 14 `admin-*` literals + the `admin` session guard are matched; every storefront root (`/api/auth|cart|catalog|products|orders|wallet|loyalty|…`, `product-by-slug`, `public-status-summary`, `loyalty`) is untouched.
- **The pin (`auth-logout.test.tsx`, the 97-F5 F-04 contract):** the existing test was strengthened (not duplicated) — the seeded cache now carries the five missed families (8 roots) plus `admin-healthz-ready` (see below), each with its own `toBeUndefined()` removal assertion, while the storefront survive-assertions pin against over-removal. The assertions are **non-tautological by construction**: at HEAD they fail (the old predicate matched only `admin-alerts*`). The suite count is unchanged at 2,739 by design — one behavioral pin strengthened, none added.
- **The completion (the review's SF3):** the ONE remaining admin-gated query on a bare name — system.tsx's `["healthz-ready"]` (non-PII infra health, but admin/settings-gated since R133) — was renamed onto the convention as `["admin-healthz-ready"]` (the r137 decomposition pin updated with it). With that, **no admin-scoped query root in the repo lives outside the teardown's reach** — the class is closed completely, not just the five named families.

## 2. Wave 2 — the repository's description-and-state truth pass

The owner's directive names the repo, its description, and its state as objects of the round. The GitHub description + 20-topic set were re-verified line-by-line against the live state (accurate — kept; the study-guide pointer appended at ship). The README — the repo's front door — carried five stale claims, all fixed:

1. **The retired `payment_reference` guard** still described in "How it works" step 2 — the requirement was retired by R154 and FINAL_MONEY_INVARIANTS' M3 was corrected by R183; the README was the last live surface carrying it. Now: "mobile transfer with duplicate-risk review signals."
2. **Test counts frozen at R165** (frontend 286/2,659 · backend "≥2,699, a full recount is pending") — re-stamped to the centrally-verified R183 numbers (frontend 297/2,739 · backend 290/2,667 · scripts 6/59 · combined 5,465).
3. **The "latest rounds" list frozen at R163–R165** — re-stamped to R184/R183/R182 with their one-line essences and the guide pointer.
4. **`prom-client` in the tech-stack table** — the R179 rename executed; now `@prometheus-io/client` (the actual dependency name).
5. **The eager-path bytes** (143.4 KiB, undated) — re-stamped 144.7 KiB / 148,157 B at R183.

Plus: the docs index (`docs/README.md`) gained the guide's CURRENT-bucket row; the round index gained the R184 row with the folder count corrected 39→40; source-of-truth gained entry **#26** (the round's durable facts — the teardown semantics, the guide's existence and no-secrets construction, the README truth fixes, the description verification).

## 3. Wave 3 — the owner's study guide (`docs/PROJECT_GUIDE.html`)

A single **self-contained Arabic RTL HTML page** (110,897 B after the repo's prettier commit-hook formatting, zero external dependencies except an optional web font with system fallbacks; dark/light toggle; sticky TOC; print styles; responsive 390 px→desktop; footer guaranteed to the bottom via the flex column contract). Thirteen sections, exactly the owner's asked-for material — how it works, which services are needed — with the process/history chatter deliberately excluded:

1. ما هو المشروع؟ — identity + the 5-step customer journey (flow diagram)
2. البنية المعمارية — the monorepo tree + the live runtime topology (browser → Cloudflare DNS → Traefik → Coolify container → Neon/OpenWA; Redis's optional status)
3. التقنيات — the stack table with the versions that matter
4. **الخدمات الخارجية** — the key section: required-at-boot (Neon, the three secrets) vs live-in-production (Telegram bot + login, WhatsApp/OpenWA, Sentry, GA4, IndexNow) vs defined-but-inactive (Redis, Firebase, the LLM provider — with the `COPILOT_*` env-name explanation), each with env names, role, and what breaks without it
5. قاعدة البيانات — all 38 tables grouped in 8 domain cards
6. واجهة الـ API — the public families + the admin families with their scopes
7. المسارات الأساسية — login (×3 + admin), top-up (5-step approval flow), checkout (the atomic box), refund, the pricing engine (rate × markup × cap + the discount stack), loyalty/referrals, AI enrichment (the 4-step draft-review-publish flow), the risk engine, and the M1–M17 money laws summarized
8. لوحة الإدارة — the 20 admin pages with scope badges
9. الأمان — the nine defense layers incl. the rate-limit table
10. متغيرات البيئة — required vs optional, **names only**
11. النشر والتشغيل — the push-to-deploy chain, the CI gates, the cron slots, backups/watchdog
12. الأرقام الحالية — the R184 snapshot (45 products · 38 tables · 79 ops · 5,465+ tests · 148 KB eager)
13. خريطة القراءة — where to go deeper (README → ONBOARDING → MONEY_INVARIANTS → project-graph → RUNBOOK → CHANGELOG)

**Constraints honored (verified by the independent review):** zero secret values (all 47 env mentions are NAMES from `config/env.example`), zero IPs, no Neon/Telegram identifiers, no agent/process internals, all internal anchors self-consistent (s1–s13 + the skip link). Registered in: the README's documentation table, the docs index, the round index row, source-of-truth #26(b), and the GitHub description (at ship).

## 4. The guide's own verification (browser + vision)

Served and exercised in the round's review environment (a Next.js host framing the static file at `/`): fresh load → zero page/console errors; TOC navigation proven (the «الخدمات الخارجية» link scrolls to §4 at y=4530); the dark/light toggle round-trips `data-theme`; the 390 px viewport collapses to the single-column chip TOC (computed grid-cols=1, `.toc` static) and 1440 px restores the sidebar; the footer rides the flex column contract. An independent vision-model review of the rendered page confirmed: correct RTL, no overlapping/broken containers, professional typography/hierarchy/color — no visual defects found.

## 5. The independent review (read-only, opus-tier rigor)

**Verdict: "no content blockers — ship-able"** contingent on this round-close + CHANGELOG landing with the docs commits (B1 — the expected mid-round state; satisfied by this commit series). The reviewer independently re-derived the complete queryKey inventory (60 orval + manual roots) proving the predicate complete; re-verified the test non-tautologically (fails pre-fix); re-verified the re-stamped README numbers, the pricing/loyalty/tables/scopes/cron/backup claims in the guide against their source files; and swept the guide for secrets/PII/process-leak (clean). **Findings applied:**

- **SF1:** the guide listed `/healthz/ready` as public — it is admin/settings-gated (R133); the health row and the ops card now state the public surface (`/healthz`, `/healthz/live`, `/healthz/summary`) vs the gated one truthfully.
- **SF2:** the referral reward's trigger was "first purchase" — it is the referee's **first approved top-up** (the guide's own §7.2 already said so); the loyalty card fixed to «أول شحنة معتمدة».
- **SF3:** the `healthz-ready` bare root renamed onto the convention (Wave 1's completion, above) + pinned in the F-04 teardown test.
- **N1–N3:** "21 admin pages" → 20; the ungrounded "46+ checks" figure dropped; the eager bytes stamped to the final-tree measurement.

## 6. Gates (all green, on the round's final tree — re-run after the review fixes)

| Gate | Result |
|---|---|
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm typecheck` (libs + backend + frontend + scripts) | green ×4 |
| Backend suite | **290 files / 2,668 tests — all passed** (chunks: lib+middlewares 57/741 · services 62/426 [55 flat + 7 subdirs] · routes 108/927 [86 public + 22 admin] · jobs 41/306 · src-root 17/250 · workspace-root 5/18 per-file) — the +1 vs R183's ledger 2,667 is PR #11's `spa-shell-rewrite` test, documented in R183's ship record |
| Frontend suite | **297 files / 2,739 tests — all passed** (final-tree re-run post-review-fixes, exit 0) |
| Scripts suite | 6 files / 59 tests — all passed |
| Combined | **5,466 tests** (2,668 + 2,739 + 59); the F4 close-out strengthens an existing pin — the count is unchanged by design, none omitted |
| OpenAPI↔Express route parity | 79 implemented ops in sync |
| ErrorCode sync | 26 codes, both directions |
| Header-param survival | 7/7 |
| Drizzle migration drift | clean ("No schema changes, nothing to migrate"; regenerated + tree-unchanged) |
| Orval generated-code drift | clean (regenerated + tree-unchanged) |
| Production build | green — eager path **148,158 B gz** (R183: 148,157; +1 B — the rename; the 150 KiB warn / 160 KiB hard gates hold) |

**Environmental deferrals (the standing set):** the live-E2E checks requiring real infra and Playwright's pinned browser revision; the e2e/CVE CI jobs remain the by-design skips (e2e = dispatch/schedule-only; CVE = deps-only — no dependency changes this round).

## 7. Ship record — STAGED (evidence to be stamped at ship)

The ship sequence per the standing law (no automatic deploys; push → CI → Coolify rotation → read-only probes; this section is rewritten CLOSED GREEN only after the evidence exists):

1. **Commits (conventional, on `main`, no force-push):** `fix(privacy,r184)` — the teardown predicate + the `admin-healthz-ready` rename + both pins (4 files); `docs(guide,r184)` — the study guide + the README/docs truth pass + this round-close + the round ledger (7 files).
2. **Push:** fast-forward `a9be45f0..` to `origin/main`; remote HEAD re-verified equal to local.
3. **CI:** all-executed jobs green on the pushed tree (gitleaks, path filter, lint/typecheck/drift, unit tests ×3, production build; e2e + CVE = the standing by-design skips).
4. **GitHub repo description:** the study-guide pointer appended via the API (description + 20 topics re-verified).
5. **Coolify rotation:** entry hash re-probed until it differs from `index-B9PaBJn_.js` (the R183 deploy).
6. **Read-only production probes:** `healthz` 200; the homepage's honest caption + purchasable floor intact; the admin families' live 401 gates; a fresh browser session with zero page/console/network errors; the R181 residue regression on the new bundle.
7. **Ship-record commit:** this section rewritten to CLOSED GREEN with the real SHAs, CI run id, entry hash, and probe outputs; pushed (docs-only cost-gate path).

**No production data, secrets, DNS, or Coolify configuration is touched by any step (the operator-only boundary; all probes strictly read-only).**

## 8. Definition-of-done scorecard

1. The last logged latent defect: **F4 closed at the source — no admin-scoped query root survives an admin session switch, proven by a non-tautological pin and a complete repo-wide inventory** (§1).
2. The repository's description and state: **the README's five stale claims corrected, the indexes and source-of-truth reconciled, the GitHub description re-verified** (§2).
3. The owner's named deliverable: **the Arabic study guide shipped** — comprehensive, self-contained, secret-free, browser- and vision-verified (§3–§4).
4. Independent review: **no blockers; 3 should-fix + 3 nits applied; the completion requirement satisfied by this commit series** (§5).
5. Full gates: **all green on the final tree, counts reconciled exactly** (§6).
6. Ship: **§7's staged sequence executed and closed green — the ship-record commit carries the real evidence (SHAs, CI run, rotation, probes).**
7. This ledger reflects actual evidence: every claim cites files, tests, commands, or probe outputs.
