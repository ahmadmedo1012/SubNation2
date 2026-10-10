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
> not retro-edited.
>
> Index rewritten **R122 (2026-10-07)** on top of the R118/R119 passes.
> Live baseline for every "current state" claim: `https://subnation.ly`
> 200 (Contabo VM + Coolify + Traefik + Let's Encrypt at origin, Neon
> Postgres 17 us-east-1 pooled, Cloudflare **DNS-only grey**),
> **www→apex permanent single-hop LIVE at the Traefik layer since R121**
> (`www-redirect.yml` priority 1000, path+query preserved — 301 as of
> the R124 redeploy (2026-10-09), 308 before it; the apex's own
> http→https hop is a temporary redirect, the one remaining edge polish
> item), **Sentry LIVE both sides since R121-B** (org `subnation`
> EU/de, projects `javascript-react` + `subnation-backend`),
> **Telegram ops channel LIVE since R121** — verified R122-D1 against the
> progress log R121 entries + live probes.
>
> **R128 (2026-10-10) — round record:** the appearance round
> (**المظهر وكل ما يخصه**) — **15 read-only auditors**: 7 A-lanes on
> visual dimensions (design tokens · storefront visual · admin visual ·
> Arabic typography · motion · icons/imagery · appearance tooling) + 8
> B-lanes (R127 residuals · perf/PWA · security red-team · money paths
> — the fourth full audit · test quality · Arabic SEO · docs/repo ·
> cross-surface), reports in `docs/inspection-r128/` (file:line-evidenced;
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
> `docs/inspection-r127/` (15 auditor reports + the R1 review — the
> round's headline: boot perf, `statement_timeout` made real, sockets
> scope-leak + resync, the audit-trail UI, OpenAPI batch-2, supply-chain
> hardening).
>
> **R126 (2026-10-09) — round record:** the 13-audit + 10-lane round (3 P1 +
> ~14 P2 + ~90 P3, two NEW audit dimensions — Arabic language quality +
> real-browser a11y vs live production; the live CSP P1 hotfix, stats RBAC
> scope, OpenAPI batch-1 ×17, test-inclusion widening T1-T3, settings +
> auth-settings splits, adversarial review SHIP 0 P0/P1/P2) is documented in
> `CHANGELOG.md` §Round R126 + `docs/inspection-r126/` (13 auditor reports +
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
> `docs/inspection-r125/` (A1–A12 audit reports + the R1 adversarial review)
> with the round entry at the top of `CHANGELOG.md`.

> **R124 (2026-10-09) — round record:** the 10-audit + 7-lane +
> independent-review round (93 findings, 0 P0) is documented in
> `docs/inspection-r124/` (A1–A10 audit reports + the R1 adversarial review)
> with the round entry at the top of `CHANGELOG.md`.
>
> Repo-root companions (not under `docs/`): `README.md` (intro + deployment
> status; truth-refreshed R124, restructured R126, counts + perf +
> latest-rounds restamped R128), `OPERATIONS_RUNBOOK.md`
> (on-call playbook — §11 Sentry, §12 Telegram ops, §13 edge
> canonicalization, §14 pending actions, §15 backups added R122),
> `CHANGELOG.md` (round ledger; newest entry at top), `LICENSE` (MIT) ·
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
| `operations/OPERATOR_ACTIONS_R118.md` | The ordered operator action list | status header refreshed R122; R123 added actions 11–12; R124 added the «تجربة» flash-sale deletion + replay-canary check (1 & 8 DONE; 2/3 unverified; 4–12 open) |
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
| `FINAL_MONEY_INVARIANTS.md` | M1–M17 money invariants | CURRENT (R128: M1/M2/M3 re-cited at HEAD, M15–M17 folded in, suite index re-verified — R128-B4's fourth full money audit) |
| `ONBOARDING.md` | The ordered developer path (repo map → setup → law docs → gates → round records) | CURRENT (added R126 — the missing developer journey; suite-size counts restamped R128) |
| `PERFORMANCE.md` | The performance record — budget gates, measured numbers, round history | CURRENT (added R126; extracted from the README perf section; R127 boot row + R128-B2 Lighthouse re-measure added R128) |
| `NEON_MCP_SETUP.md` | Neon MCP probe endpoint | CURRENT |
| `SEO_PRODUCTS.json` | The 45 curated Arabic product entries (8 original + 37 added R116) | CURRENT |
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
| **HISTORY** | 74 (incl. the 2 root snapshots `PLATFORM.md` / `PROJECT_OVERVIEW.md`) | `docs/history/` — inspection rounds r94–r118, round reports/repair plans, dated audits/plans, UX audits, catalog/SEO records, `RENDER_LEGACY_FALLBACK`, `wave-345-audit` |
| **DEPRECATED** | 16 | `docs/deprecated/` — 6 migration-era guides + the executed `project-plan/00–09` set |
| **PENDING** | 1 | `docs/pending/embronic-adapter-design.md` (Embronic provider-sync design; `FINAL_INVENTORY_LOADING.md` stays CURRENT until Embronic lands) |

Move map for dated ledger entries: `docs/history/README.md`.

## House rules (from A7 §5, binding for new docs)

1. `FINAL_*` is the only naming pattern for CURRENT operator docs.
2. Dated files get an `ARCHIVED (date)` first line instead of deletion —
   now enforced by the R122 banners on every moved file.
3. Every "for current state see X" pointer lands on **this index**.
4. New docs carry `Status: CURRENT @ <date>` and the change that
   invalidates them must touch that line.
