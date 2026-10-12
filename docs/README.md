# SubNation2 — Docs Index

> Status legend: **CURRENT** = verified against code/live state, safe to
> act on · **HISTORY** = dated historical artifact, now under
> `docs/history/` · **DEPRECATED** = superseded/executed plan or
> migration-era guide, now under `docs/deprecated/` · **PENDING** =
> designed-but-deferred work, now under `docs/pending/`.
>
> **R122 docs reorganization (2026-10-07) — EXECUTED.** The R118-era
> "proposed move to `docs/archive/`" was superseded and executed by the
> R122-D1 round as the 4-bucket layout (CURRENT in place · HISTORY ·
> DEPRECATED · PENDING — see the bucket table below). All moves used
> `git mv`; every moved file carries a one-line banner with its old path;
> `docs/history/README.md` is the move map. Dated ledger entries that cite
> pre-move paths (CHANGELOG rounds, the progress log) are intentionally
> not retro-edited (R122 posture — the R135 sweep noted below repointed
> the live surfaces instead; archived files keep their dated citations).
>
> Index rewritten **R122 (2026-10-07)** on top of the R118/R119 passes.
> Live baseline for every "current state" claim: `https://subnation.ly`
> 200 (Contabo VM + Coolify + Traefik + Let's Encrypt at origin, Neon
> Postgres 17 us-east-1 pooled, Cloudflare **DNS-only grey**),
> **www→apex permanent single-hop LIVE at the Traefik layer since R121**
> (`www-redirect.yml` priority 1000, path+query preserved — 301 as of
> the R124 redeploy (2026-10-09), 308 before it; the apex's own
> http→https hop is a **permanent 301 since R130** — live-probed both
> hosts, runbook §14 "✅ RESOLVED R130"; no edge polish item remains), **Sentry LIVE both sides since R121-B** (org `subnation`
> EU/de, projects `javascript-react` + `subnation-backend`),
> **Telegram ops channel LIVE since R121** — verified R122-D1 against the
> progress log R121 entries + live probes.
>
> **R135 (2026-10-12) — docs 4-bucket sweep (the repo's own hygiene items
> #2/#4/#7):** the executed post-R122 inspection rounds left the CURRENT
> bucket — `inspection-r124/ r125/ r126/ r127/ r128/ r129/ r130/ r134/`
> (129 files: 90 reports + 39 banked JPEGs) moved to
> `docs/history/inspection-*/` with ARCHIVED banners (`git mv`, move map in
> `docs/history/README.md`); the round ledger split — the CHANGELOG
> R116–R126 entries (plus the mission-waves/merge records of that span)
> cut verbatim to `docs/history/CHANGELOG-rounds-r116-r126.md`, the front
> door keeping R127+ and the pre-R116 compact summary; every live-surface
> citation repointed at the new homes (CHANGELOG R127+, the progress log,
> the runbook, the READMEs, PERFORMANCE, OPERATOR_ACTIONS — this index
> included; archived files keep their dated in-report citations as
> records, `docs/project-state/` deliberately untouched). Truth fixes:
> the R134 "push blocked" note below re-stamped resolved (live wins),
> and the stale `.specify/feature.json` pointer (nothing in the tree
> read it) deleted — the README Notes section updated with it.
>
> **R134 (2026-10-12) — round record:** the fleet-audit fix wave — seven
> read-only auditors (A1–A8) swept the whole tree at `5d5227c` and the
> round landed the fixes: path-scoped RBAC mounts (A5-F1 P2 — scoped
> grants work at runtime for the first time since R122), the durable
> idempotency body-hash (A7-F4 — the R122 409 defense finally fires in
> production), the DESC-index regen wave + zero-consumer index drop
> (A8-F1/F2, chain 0022 + boot V1-M33), the A1 contract-honesty batch,
> the admin scope-gate + dialog-contract wave (A3-F1..F5 — all 14 pages
> honest-reason gated, the CopilotPanel dialog contract, the socket-
> resync close-out), the storefront one-concept-one-word batch (A2-F1..F9
> — category labels derive from one source, نقطة agreement, combobox
> semantics, honest stock pills, the PDP 404 re-quote abort), the cart
> half-cent pin + invariants re-anchor (A4, the fifth full money audit),
> the artifact-pinned impeccable gate (A5-F3) + main-only CI filters
> (A7-F9), the shell 404 noindex parity (A7-F6), and the A7 docs truth
> batch. Gates: backend 2,396/2,396 · frontend 1,279/1,279 · lint 0
> errors · typecheck green · build green · drift gates CLEAN ·
> impeccable exit 0. Push: the PAT was dead at push time (401
> git-receive) and the round first recorded the nine R134 commits as
> sitting local — **push CONFIRMED (re-stamped R135, 2026-10-12, live
> wins): `origin/main` = local `main` = `dff50ad`** — the R134 wave
> landed on GitHub; the "blocked" note that stood here was stale.
>
> **R133 (2026-10-12) — round record:** the R132 delivery executed (live
> PAT from the operator; `56b8bf9..6a77590` pushed, CI run #468 green,
> Coolify webhook deployed, live-verified: the arabic-search round-2
> behaviors + the desktop-categories disclosure live on production) +
> the R130 open-findings close-out. Shipped: the admin state-truth trio
> (A3-F2 risk-dashboard skeleton/error/stale triad, A3-F4 the system
> page's settings gate + honest healthz failures — no more
> authorization-as-«أداء متدنٍ», A3-F5 risk-event's users gate +
> 404-vs-outage fork), the A4 a11y tail (44px password reveals,
> NotificationBell aria-modal + focus return + Tab trap, label/name
> wiring across provider-card + 4 textareas + the ⌘K combobox), and
> cart.ts GET/PATCH variant-pricing parity (A7-F2).
> `adminFetchJson` errors now carry the HTTP status (additive). Gates:
> backend 2,305/2,305 · frontend 1,270/1,270 · lint 0 errors ·
> typecheck green · build + budget PASS. Full detail: the CHANGELOG
> R133 entry.
>
> **R132 (2026-10-12) — round record:** arabic-search round 2 + the
> load-flaky class killed at the root + the desktop categories entry.
> Starting truth: local was R117's `ef3d0c3`; the other agent's
> R118–R130 waves (111 commits) were fetched and reviewed and R131's
> reported commit `858aa80` confirmed NEVER pushed — this round built
> on the latest PUSHED tree (`56b8bf9`) and re-derived R131's
> remaining list against the actual code. Shipped: the 3+1 load-flaky
> failures root-caused and made deterministic by construction (fake
> clocks, the 3 unmocked boot-one-shot roster jobs, suite-wide
> waitFor patience), the four arabic-search gaps (category intent,
> mixed-script, duration/tier compounds with digit-boundary
> refinement, exact-match-first ranking) with +64 backend evaluation
> cases + 2 deploy-race-safe e2e journeys, the desktop «الأقسام»
> disclosure (L2-F4), measured closures for L2-F8 (verified good),
> L4-F1 (DB is the NEWER truth — importer extended, keep-unless-force
> load-bearing), L4-F6 (TTFB tail = client↔origin RTT, server ≲30 ms,
> CDN stays the O1 operator item) and L4-F9 (all 45 assets are 450×450
> — declarations truth-fixed to intrinsic). Gates: backend 2,302/2,302
> · frontend 1,259/1,259 · lint 0 errors · typecheck green · build +
> budget PASS. Full detail: the CHANGELOG R132 entry.
>
> **R130 (2026-10-10) — round record:** the verification round that had
> to verify itself. Ground truth: local HEAD = GitHub main = live
> Coolify container = `fd702d6`, healthz ok. Headline discovery: the
> R129 tree had NO green CI evidence (43-second push burst + docs-only
> path filters skipped every heavy job at the deployed SHA) — every
> skipped gate re-run LOCALLY at that SHA (typecheck, lint, both suites,
> builds, budget, `pnpm audit --prod` = 0 critical, and the 40-test
> guest e2e suite against LIVE production 40/40). 9 specialist audit
> lanes + 4 parent lanes (`docs/history/inspection-r130/`): 0 P0/P1 — the one
> real defect family (variant-AVAILABILITY pricing: display min, grid
> quick-add, and the B-11 product-level snapshot were all
> availability-blind; the feared mischarge structurally impossible per
> A7's pool proof; the cost was a latent buyer dead-end) fixed at all
> layers with 13 new regression tests; money-UX honesty (ceiling-aware
> toasts + stepper), roundLyd residue ×7, edge http→https → **301**
> (runbook §13), web-vitals off the eager path, Toaster ErrorBoundary,
> post-purchase stock invalidation, contrast/a11y batch, gitleaks
> scan-scope fix (push=single-commit vs dispatch=full-history; the 3
> historical key patches commit-allowlisted). Landed on `github/main` the
> same evening after the operator restored push credentials; the full
> workflow ran natively (e2e 40/40 vs live prod + CVE 0-critical) and
> `E2E_BASE_URL` is set (weekly heartbeat armed).
>
> **R129 (2026-10-11) — round record:** the verification fleet over
> R128's own output — 5 read-only lanes (adversarial review of the five
> commits · WCAG 2.2 AA contrast census of the palette migration ·
> design-token integrity incl. a 65-entry DESIGN.md hex audit · security
> delta over the 9 new surfaces · test-truth with 12/12 physical
> mutation checks), reports in `docs/history/inspection-r129/`. Findings: 2 P1s
> (the B-11 stock-honest-cart lib was unwired dead code — corroborated
> by two lanes independently; the CI impeccable gate had exited 2 on
> both post-R128 pushes) + 1 P2 + ~10 P3 + ~15 P4 — all P1/P2 and the
> high-value tail closed in-round (3 commits): the cart feature wired
> end-to-end (snapshot at add + re-quote refresh + honest per-line
> verdicts + CTA gates), the CI gate repaired (verified EXIT 0),
> `--primary-text` light 43% + 15 AA closes, DESIGN.md fully published
> (light twins, error split), the missing /products + copilot-trace
> pins, provider chips tokenized. Frontend suite 178 files / 1,248
> tests green; backend untouched.
>
> **R128 (2026-10-10) — round record:** the appearance round
> (**المظهر وكل ما يخصه**) — **15 read-only auditors**: 7 A-lanes on
> visual dimensions (design tokens · storefront visual · admin visual ·
> Arabic typography · motion · icons/imagery · appearance tooling) + 8
> B-lanes (R127 residuals · perf/PWA · security red-team · money paths
> — the fourth full audit · test quality · Arabic SEO · docs/repo ·
> cross-surface), reports in `docs/history/inspection-r128/` (file:line-evidenced;
> the A2 storefront pass banked 35 verified live screenshots in
> `screenshots-a2/`). Findings 0 P0 · 0 P1. **9 implementation lanes +
> parent closes**: admin palette unification (227 raw-hue hits → 0, new
> `--status-success-surface`/`--status-purple`/`--tier-*`/`--cat-*`
> tokens), the coherent one-mark brand-asset suite (favicon/PWA
> maskable/apple-touch/1200×630 og), motion fill-mode + typography
> leading closes, the /products alias, cart-badge live region +
> footer heading fixes, both live-verified PWA leaks killed
> (`/sw.js.map` + `/assets` soft-200), the hard e2e assertion + weekly
> heartbeat, `formatLyd` cross-surface money truth + the share card's
> curated SEO fields, cart-stock honesty, support 25 s poll + the
> notifications page, and the docs-truth batch (this index, README,
> canon re-cites). CHANGELOG entry: top of `CHANGELOG.md`.
>
> **R127 (2026-10-09) — round record:** the deepest fleet yet — 17 read-only
> agents (2 tool-research + **15 auditors**, seven dimensions no prior round
> ran: live Lighthouse · PWA/service-worker update-flow · socket.io
> full-stack · cron/scheduler · database live-read-only · CI/CD
> supply-chain (zizmor/actionlint) · Docker/build shadow-surface, plus git
> history archaeology, SEO live, impeccable UI detection, admin
> full-journey) + 12 implementation lanes. Findings 0 P0 · 0 P1 · ~12 P2 ·
> ~40 P3, all closed; adversarial reviewer R127-R1: **SHIP — 0
> P0/P1/P2**. Documented in `CHANGELOG.md` §Round R127 +
> `docs/history/inspection-r127/` (15 auditor reports + the R1 review — the
> round's headline: boot perf, `statement_timeout` made real, sockets
> scope-leak + resync, the audit-trail UI, OpenAPI batch-2, supply-chain
> hardening).
>
> **R126 (2026-10-09) — round record:** the 13-audit + 10-lane round (3 P1 +
> ~14 P2 + ~90 P3, two NEW audit dimensions — Arabic language quality +
> real-browser a11y vs live production; the live CSP P1 hotfix, stats RBAC
> scope, OpenAPI batch-1 ×17, test-inclusion widening T1-T3, settings +
> auth-settings splits, adversarial review SHIP 0 P0/P1/P2) is documented in
> `CHANGELOG.md` §Round R126 + `docs/history/inspection-r126/` (13 auditor reports +
> the independent review). Docs-presentation lanes: this index gained the
> developer onboarding layer (`docs/ONBOARDING.md`), the performance record
> (`docs/PERFORMANCE.md`), and a `specs/` visibility row; `project-graph/` 00
> + 12 were refreshed (00 drew the deleted app-2, 12 named a machine-specific
> clone path). Repo root gained the OSS trust surface: `LICENSE` (MIT),
> `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/` + PR template,
> CI badge in the README. (`ONBOARDING` / `PERFORMANCE` intentionally sit
> outside the `FINAL_*` pattern — front-door entry docs in the `API.md`
> family.)

> **R125 (2026-10-09) — round record:** the 12-audit + 8-lane + adversarial-review
> round (3 P1 + ~30 P2 + ~85 P3; admin console focus, strictFunctionTypes
> enabled, live guest-e2e executed) is documented in
> `docs/history/inspection-r125/` (A1–A12 audit reports + the R1 adversarial review)
> with the round entry at the top of `CHANGELOG.md`.

> **R124 (2026-10-09) — round record:** the 10-audit + 7-lane +
> independent-review round (93 findings, 0 P0) is documented in
> `docs/history/inspection-r124/` (A1–A10 audit reports + the R1 adversarial review)
> with the round entry at the top of `CHANGELOG.md`.
>
> Repo-root companions (not under `docs/`): `README.md` (intro + deployment
> status; truth-refreshed R124, restructured R126, counts + perf +
> latest-rounds restamped R128), `OPERATIONS_RUNBOOK.md`
> (on-call playbook — §11 Sentry, §12 Telegram ops, §13 edge
> canonicalization, §14 pending actions, §15 backups added R122),
> `CHANGELOG.md` (round ledger; newest entry at top; R116–R126 split to
> `docs/history/CHANGELOG-rounds-r116-r126.md` — R135), `LICENSE` (MIT) ·
> `CONTRIBUTING.md` · `SECURITY.md` (added R126),
> `.github/ISSUE_TEMPLATE/` + `PULL_REQUEST_TEMPLATE.md` (added R126),
> `docs/assets/screenshots/` (live storefront JPEGs for the README — desktop
> trio R126, mobile home + cart pair R128).
> The old root snapshots `PLATFORM.md` + `PROJECT_OVERVIEW.md`
> moved to `docs/history/`.

## Start here — for incidents

1. **`docs/DISASTER_RECOVERY.md`** — is data at risk? (RTO/RPO, backup
   inventory, recovery scenarios; two PASS restore drills on record in
   `docs/deployment/FINAL_RESTORE_DRILL.md`.)
2. **`OPERATIONS_RUNBOOK.md`** (repo root) — §2 alert-triage anchors,
   §4 Coolify deploy/rollback, §11–§15 the R121+ operator sections
   (Sentry pipeline, Telegram ops, edge canonicalization, pending
   actions, backups).
3. **`docs/operations/FINAL_MONITORING.md`** — healthz family, cron slots,
   alerting channels, weekly checklist.

Not an incident but "what do I do next?" →
**`docs/operations/OPERATOR_ACTIONS_R118.md`** (status refreshed R122:
actions 1 & 8 DONE — 8: permanent redirect live, **301 since the R124
redeploy, was 308**; 2/3 unverified; 4–7, 9–12 open).

New developer? → **[`docs/ONBOARDING.md`](./ONBOARDING.md)** — the ordered
path: repo map → setup → the law docs (money invariants, no-`db:push`,
orval workflow) → gates → where rounds are recorded. (Added R126 — the
missing third journey, after incidents + auditing.)

## Pointer hierarchy (of record)

`docs/README.md` (this index) = the front door →
`docs/project-state/source-of-truth.md` = current live state →
`docs/architecture/FINAL_*` = topology/capacity records.
`OPERATIONS_RUNBOOK.md` owns on-call ops; `CHANGELOG.md` owns the round
ledger; `docs/API.md` owns the API surface.

## CURRENT (operator-facing) — 50 files in place

### operations/ (the runbooks you actually open)

| File | What it covers | Status |
|---|---|---|
| `operations/OPERATOR_ACTIONS_R118.md` | The ordered operator action list | status header refreshed R122; R123 added actions 11–12; R124 added the «تجربة» flash-sale deletion + replay-canary check; R134 re-stamped the open set — 1, 8 & 11 DONE · 2/3 unverified · **open: 4–7, 9–10, 12** |
| `operations/CONTABO_COOLIFY_OPERATIONS.md` | Day-2 ops for the live Contabo host + Coolify + Traefik | §5 updated R125 (www→apex permanent single-hop — 301 since the R124 redeploy, was 308); Oracle-guide refs repointed to `docs/deprecated/` |
| `operations/NEON_COLD_START_RUNBOOK.md` | Neon auto-suspend: symptoms, checks, when to panic, mitigation menu | §6 updated R125 (live permanent redirect; digit regen-dependent — 301 since the R124 redeploy, was 308) |
| `operations/WWW_TO_APEX_301.md` | The canonical-host change | **EXECUTED 2026-10-07 (R121)** — live via `www-redirect.yml` (301 since the R124 redeploy 2026-10-09, 308 before it); preserved as the design + rollback record |
| `operations/FINAL_INVENTORY_LOADING.md` | How sellable stock is loaded/verified/rolled back — the #1 operator runbook | CURRENT (stock items 2/3 still open — see OPERATOR_ACTIONS) |
| `operations/FINAL_ADMIN_TOTP_SETUP.md` | TOTP enrollment on `ahmadmedo` | CURRENT (enrollment still unverified through R121) |
| `operations/FINAL_MONITORING.md` | What to watch, cron slots, healthz family, alerting | CURRENT (Oracle refs repointed to `docs/deprecated/` R122) |
| `operations/LOGGING_AND_RETENTION_FINAL.md` | Retention windows + log rotation | CURRENT |

### architecture/

| File | Covers | Status |
|---|---|---|
| `architecture/FINAL_PRODUCTION_TOPOLOGY.md` | THE topology source of truth | §1 diagram updated R125 (www permanent→apex at Traefik; 301 since the R124 redeploy, was 308) |
| `architecture/PRODUCTION_ARCHITECTURE.md` | Data-path + migration-chain detail | CURRENT (history refs repointed to `docs/history/` R122) |

### deployment/

| File | Covers | Status |
|---|---|---|
| `deployment/CLOUDFLARE_FINAL_CUTOVER.md` | DNS/cutover history | §8 carries the R121 EXECUTED update note (R122); §1–§7 are the dated r112 design record |
| `deployment/COOLIFY_FINAL_SETUP.md` | The two Coolify resources + domains + healthchecks | CURRENT |
| `deployment/FINAL_COMMAND_BOOK.md` | Copy-paste command book | CURRENT |
| `deployment/FINAL_PRODUCTION_ENV.md` | The env contract (per-variable authority) | Sentry token row updated R122 (Coolify build-time since R121-B) |
| `deployment/FINAL_ROLLBACK_RUNBOOK.md` | Redeploy-rollback choreography | CI gate note updated R122 (repo public, Actions on push) |
| `deployment/FINAL_RESTORE_DRILL.md` | Restore-drill procedure + ledger (2 PASS drills) | CURRENT |
| `deployment/FINAL_SIGNOFF.md` | Dated R115 release ledger | cutover-executed note added R122 |
| `deployment/SECRET_HANDLING_FINAL.md` | Secret map for the two Coolify resources | CURRENT |
| `deployment/NEON_IDLE_ECONOMICS.md` | Neon free-tier CU math, suspend policy | CURRENT |
| `deployment/ENVIRONMENT_MATRIX.md` | r108-era env matrix | CURRENT (rows verified) |

### docs/ root + topic dirs

| File | Covers | Status |
|---|---|---|
| `DISASTER_RECOVERY.md` | THE DR source of truth | canonical-host line updated R125 (www permanently→apex; 301 since the R124 redeploy, was 308) |
| `WHATSAPP_OPERATIONS.md` | WhatsApp gateway ops | CURRENT (R117 rewrite verified) |
| `API.md` | Rate limits + surface (operator reference) | CURRENT (R126: `?fields=list` light projection + `variant_count` documented — was missing the R124-public surface) |
| `COMPLIANCE.md` | Data-retention/backup compliance claims | CURRENT (R118-B4a corrections) |
| `FINAL_MONEY_INVARIANTS.md` | M1–M17 money invariants | CURRENT (R134: cites re-derived after the A7-F4 body-hash + A8-F1 schema waves — M1/M2/M3/M4/M5/M6/M7/M16 re-anchored, suite index 43→45 with cart + variant-availability-pricing; fifth full money audit) |
| `ONBOARDING.md` | The ordered developer path (repo map → setup → law docs → gates → round records) | CURRENT (added R126 — the missing developer journey; suite-size counts restamped R128) |
| `PERFORMANCE.md` | The performance record — budget gates, measured numbers, round history | CURRENT (added R126; extracted from the README perf section; R127 boot row + R128-B2 Lighthouse re-measure added R128) |
| `NEON_MCP_SETUP.md` | Neon MCP probe endpoint | CURRENT |
| `SEO_PRODUCTS.json` | The 45 curated Arabic product entries (8 original + 37 added R116) | STALE vs live DB (R132 L4-F1: 41/41 seeded rows differ — the live DB is the NEWER truth after the operator's R132 curation pass; the importer is keep-unless-force, so this file is a snapshot, not the source of truth — re-export before bulk edits) |
| `loyalty/FINAL_LOYALTY_POLICY.md` · `loyalty/LOYALTY_ECONOMICS.md` | Loyalty policy + economics | CURRENT |
| `pricing/PRICING_ECONOMICS.md` | Pricing/margin model | CURRENT |
| `ux/FINAL_UX_SYSTEM.md` | UX/design-system policy | CURRENT (R128: 11px type floor + z-index code truth + icon-direction contract + cross-surface conventions sections added) |

### project-plan/ + project-state/ + project-graph/ (mission-era trees)

| Tree | Files | What it is |
|---|---|---|
| `project-plan/` | `10-progress-log.md` (append-only; R121+ still writes to it) | THE progress ledger — 00–09 moved to `docs/deprecated/project-plan/` (all waves DONE 2026-10-05) |
| `project-state/` | `source-of-truth.md` (current live state — part of the pointer hierarchy; R121 reconciliation + reorg note added R122), `external-integrations-final.md` | Live-state records; `wave-345-audit.md` → `docs/history/`, `embronic-adapter-design.md` → `docs/pending/` |
| `project-graph/` | 13 `.mmd` (00–12) | Mermaid truth maps (CURRENT deployment map = `03-deployment-target.mmd`; 00 + 12 refreshed R126 — 00 still drew the deleted app-2 container, 12 named a machine-specific clone path) |

### specs/ (repo root — outside the docs tree, now visible from this index)

| Tree | What it is |
|---|---|
| `specs/003-anomaly-detection` · `specs/004-security-audit` · `specs/008-audit-coverage-gaps` · `specs/010-ai-admin-copilot` · `specs/011-inventory-demand-forecast` · `specs/012-arabic-catalog-enrichment` | Dated spec-driven working directories (spec / plan / research / checklists / contracts per dir) — evidence records of executed work (e.g. the risk engine, the admin copilot, the forecast panel), not maintained docs. Read as history with a date, not as CURRENT guidance. |

## The 4-bucket layout (R122, 2026-10-07)

| Bucket | Files | Location |
|---|---|---|
| **CURRENT** | 50 (36 md incl. this index + 13 mmd + 1 json) | in place (this index's tables above) |
| **HISTORY** | 204 files — 165 md + 39 jpg (74 md from R122 + the R135 wave: 90 md / 39 jpg of inspection evidence r124–r130 + r134 + the ledger split; incl. the 2 root snapshots `PLATFORM.md` / `PROJECT_OVERVIEW.md`) | `docs/history/` — inspection rounds r94–r130 + r134, round reports/repair plans, dated audits/plans, UX audits, catalog/SEO records, `RENDER_LEGACY_FALLBACK`, `wave-345-audit`, `CHANGELOG-rounds-r116-r126.md` |
| **DEPRECATED** | 16 | `docs/deprecated/` — 6 migration-era guides + the executed `project-plan/00–09` set |
| **PENDING** | 1 | `docs/pending/embronic-adapter-design.md` (Embronic provider-sync design; `FINAL_INVENTORY_LOADING.md` stays CURRENT until Embronic lands) |

Move map for dated ledger entries: `docs/history/README.md`.

## House rules (from A7 §5, binding for new docs)

1. `FINAL_*` is the only naming pattern for CURRENT operator docs.
2. Dated files get an `ARCHIVED (date)` first line instead of deletion —
   now enforced by the R122 banners on every moved file (and the R135
   banners on the eight post-R122 inspection rounds).
3. Every "for current state see X" pointer lands on **this index**.
4. New docs carry `Status: CURRENT @ <date>` and the change that
   invalidates them must touch that line.
