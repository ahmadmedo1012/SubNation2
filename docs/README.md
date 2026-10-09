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
> **www→apex 308 (permanent) LIVE at the Traefik layer since R121**
> (`www-redirect.yml` priority 1000, path+query preserved — re-verified
> by direct curl in R124; the apex's own http→https hop is a temporary
> 307, the one remaining edge polish item), **Sentry LIVE both sides since R121-B** (org `subnation`
> EU/de, projects `javascript-react` + `subnation-backend`),
> **Telegram ops channel LIVE since R121** — verified R122-D1 against the
> progress log R121 entries + live probes.
>
> **R124 (2026-10-09) — round record:** the 10-audit + 7-lane +
> independent-review round (93 findings, 0 P0) is documented in
> `docs/inspection-r124/` (A1–A10 audit reports + the R1 adversarial review)
> with the round entry at the top of `CHANGELOG.md`.
>
> Repo-root companions (not under `docs/`): `README.md` (intro + deployment
> status; truth-refreshed R124), `OPERATIONS_RUNBOOK.md` (on-call playbook —
> §11 Sentry, §12 Telegram ops, §13 edge canonicalization, §14 pending
> actions, §15 backups added R122), `CHANGELOG.md` (round ledger; R124 entry
> at top, 2026-10-09). The old root snapshots `PLATFORM.md` + `PROJECT_OVERVIEW.md`
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
actions 1 & 8 DONE — 8 executed as the 308; 2/3 unverified; 4–7, 9–10
open).

## Pointer hierarchy (of record)

`docs/README.md` (this index) = the front door →
`docs/project-state/source-of-truth.md` = current live state →
`docs/architecture/FINAL_*` = topology/capacity records.
`OPERATIONS_RUNBOOK.md` owns on-call ops; `CHANGELOG.md` owns the round
ledger; `docs/API.md` owns the API surface.

## CURRENT (operator-facing) — 48 files in place

### operations/ (the runbooks you actually open)

| File | What it covers | Status |
|---|---|---|
| `operations/OPERATOR_ACTIONS_R118.md` | The ordered operator action list | status header refreshed R122 (1 & 8 DONE; 2/3 unverified; 4–7, 9–10 open) |
| `operations/CONTABO_COOLIFY_OPERATIONS.md` | Day-2 ops for the live Contabo host + Coolify + Traefik | §5 updated R122 (www→apex 308 LIVE); Oracle-guide refs repointed to `docs/deprecated/` |
| `operations/NEON_COLD_START_RUNBOOK.md` | Neon auto-suspend: symptoms, checks, when to panic, mitigation menu | §6 updated R122 (live 308, not planned 301) |
| `operations/WWW_TO_APEX_301.md` | The canonical-host change | **EXECUTED 2026-10-07 (R121)** — live as a **308** via `www-redirect.yml`; preserved as the design + rollback record |
| `operations/FINAL_INVENTORY_LOADING.md` | How sellable stock is loaded/verified/rolled back — the #1 operator runbook | CURRENT (stock items 2/3 still open — see OPERATOR_ACTIONS) |
| `operations/FINAL_ADMIN_TOTP_SETUP.md` | TOTP enrollment on `ahmadmedo` | CURRENT (enrollment still unverified through R121) |
| `operations/FINAL_MONITORING.md` | What to watch, cron slots, healthz family, alerting | CURRENT (Oracle refs repointed to `docs/deprecated/` R122) |
| `operations/LOGGING_AND_RETENTION_FINAL.md` | Retention windows + log rotation | CURRENT |

### architecture/

| File | Covers | Status |
|---|---|---|
| `architecture/FINAL_PRODUCTION_TOPOLOGY.md` | THE topology source of truth | §1 diagram updated R122 (www 308 at Traefik) |
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
| `DISASTER_RECOVERY.md` | THE DR source of truth | canonical-host line updated R122 (www 308→apex) |
| `WHATSAPP_OPERATIONS.md` | WhatsApp gateway ops | CURRENT (R117 rewrite verified) |
| `API.md` | Rate limits + surface (operator reference) | CURRENT |
| `COMPLIANCE.md` | Data-retention/backup compliance claims | CURRENT (R118-B4a corrections) |
| `FINAL_MONEY_INVARIANTS.md` | M1–M14 money invariants | CURRENT |
| `NEON_MCP_SETUP.md` | Neon MCP probe endpoint | CURRENT |
| `SEO_PRODUCTS.json` | The 37 curated Arabic product entries (R116) | CURRENT |
| `loyalty/FINAL_LOYALTY_POLICY.md` · `loyalty/LOYALTY_ECONOMICS.md` | Loyalty policy + economics | CURRENT |
| `pricing/PRICING_ECONOMICS.md` | Pricing/margin model | CURRENT |
| `ux/FINAL_UX_SYSTEM.md` | UX/design-system policy | CURRENT |

### project-plan/ + project-state/ + project-graph/ (mission-era trees)

| Tree | Files | What it is |
|---|---|---|
| `project-plan/` | `10-progress-log.md` (append-only; R121+ still writes to it) | THE progress ledger — 00–09 moved to `docs/deprecated/project-plan/` (all waves DONE 2026-10-05) |
| `project-state/` | `source-of-truth.md` (current live state — part of the pointer hierarchy; R121 reconciliation + reorg note added R122), `external-integrations-final.md` | Live-state records; `wave-345-audit.md` → `docs/history/`, `embronic-adapter-design.md` → `docs/pending/` |
| `project-graph/` | 13 `.mmd` (00–12) | Mermaid truth maps (CURRENT deployment map = `03-deployment-target.mmd`) |

## The 4-bucket layout (R122, 2026-10-07)

| Bucket | Files | Location |
|---|---|---|
| **CURRENT** | 48 (33 md + 13 mmd + 1 json) | in place (this index's tables above) |
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
