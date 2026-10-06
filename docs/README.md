# SubNation2 — Docs Index

> Status legend: **CURRENT** = verified against code/live state, safe to act on
> (open-fix notes inline where a section is stale) · **STALE** = truth-pass or
> re-scope before trusting · **ARCHIVED** = dated historical artifact (proposed
> move to `docs/archive/` — moves are NOT executed; this index is the record).
>
> Index written **R118 (2026-10-06)**, executing the proposal in
> `docs/inspection-r118/R118-A7-docs.md` §5 (96 files inventoried at `ef3d0c3`;
> this index reconciles it against the live tree: +7 `inspection-r118/` reports
> + 4 new operations docs + this file = **108 markdown files** under `docs/`).
> Live baseline for every "current state" claim: `https://subnation.ly` 200,
> Contabo VM + Coolify + Traefik + Let's Encrypt at origin, Neon Postgres 17
> (us-east-1, pooled endpoint), Cloudflare **DNS-only (grey)** — verified
> R118 (2026-10-06), evidence in `R118-A7-docs.md` §1.
>
> Repo-root companions (not under `docs/`): `README.md` and
> `OPERATIONS_RUNBOOK.md` were **FALSE** at R118-Audit (A7 F1–F3: they describe
> the pre-2026-10 Render/Vercel stack as production) — **corrected 2026-10-06
> by the R118-B4a truth pass** (live Contabo/Coolify stack recorded; Render/
> Vercel demoted to LEGACY).

## Start here — for incidents

1. **`docs/DISASTER_RECOVERY.md`** — is data at risk? (RTO/RPO, backup
   inventory, recovery scenarios; two PASS restore drills on record in
   `docs/deployment/FINAL_RESTORE_DRILL.md`.)
2. **`OPERATIONS_RUNBOOK.md`** (repo root) — §2 alert-triage anchors are
   verified accurate (A7 §3e); §5/§9 rewritten to the live single-origin
   stack (R118-B4a, 2026-10-06).
3. **`docs/operations/FINAL_MONITORING.md`** — healthz family, cron slots,
   alerting channels, weekly checklist (retitled "self-hosted VM + Coolify"
   with the observed-Contabo-host note — R118-B4a; A7 F7).

Not an incident but "what do I do next?" →
**`docs/operations/OPERATOR_ACTIONS_R118.md`** (the ordered, dated operator
action list for this round — deploy, stock, TOTP are launch-blocking).

## CURRENT (operator-facing) — 38 files

### operations/ (the runbooks you actually open)

| File | What it covers | R118-B4a status (2026-10-06) |
|---|---|---|
| `operations/OPERATOR_ACTIONS_R118.md` | **NEW R118** — the ordered operator action list (deploy / stock / TOTP / region / proxy decisions) | — |
| `operations/CONTABO_COOLIFY_OPERATIONS.md` | **NEW R118** — day-2 ops for the live Contabo host + Coolify + Traefik | — |
| `operations/NEON_COLD_START_RUNBOOK.md` | **NEW R118** — Neon auto-suspend: symptoms, checks, when to panic, mitigation menu | — |
| `operations/WWW_TO_APEX_301.md` | **NEW R118** — the paste-able Traefik 301 for the canonical-host decision | — |
| `operations/FINAL_INVENTORY_LOADING.md` | How sellable stock is loaded/verified/rolled back — the #1 operator runbook | §8 refreshed to the R118 snapshot (3 active-product units, ids 79/80/81 pending operator verify-or-delete; §4 SQL named the truth); stamp + drifted cites fixed |
| `operations/FINAL_ADMIN_TOTP_SETUP.md` | TOTP enrollment on `ahmadmedo` (implemented, not yet enrolled) | stamp re-verified R118 (the F21 test-filename quote was stale — `.tsx` already on disk) |
| `operations/FINAL_MONITORING.md` | What to watch, cron slots, healthz family, alerting | retitled + observed-host note (F7); CF-WebSocket triage re-routed to Traefik/origin with the DNS-only caveat (F8) |
| `operations/LOGGING_AND_RETENTION_FINAL.md` | Retention windows + log rotation — **best doc in the set** (A7 §3d: all 13 rows exact) | openwa cites labeled as sibling-repo (F30) |

### architecture/

| File | Covers | Notes |
|---|---|---|
| `architecture/FINAL_PRODUCTION_TOPOLOGY.md` | THE topology source of truth | §1 diagram redrawn (DNS-only + self-hosted VM), capacity model genericized, chain → V1-M23 + drizzle 0015/0016 note (F9/F10/F20) |
| `architecture/PRODUCTION_ARCHITECTURE.md` | Data-path + migration-chain detail | R117-C1 fixes verified; the "Cloudflare →" diagram + stack-one-line now carry the DNS-only/self-hosted correction (F9 class) |

### deployment/

| File | Covers | Notes |
|---|---|---|
| `deployment/CLOUDFLARE_FINAL_CUTOVER.md` | DNS/cutover history | §1 now annotated "as DESIGNED at r112 — OBSERVED LIVE = DNS-only grey, see §8" (F18); **§8 addendum remains the truth** |
| `deployment/COOLIFY_FINAL_SETUP.md` | The two Coolify resources + domains + healthchecks | host-neutral, accurate (A7 verdict) |
| `deployment/FINAL_COMMAND_BOOK.md` | Copy-paste command book | VM section retitled (originally Oracle ARM64; CURRENT HOST = Contabo, native arch; `--arm64` conditional) + DNS-state warning (F17/F18) — see also `operations/CONTABO_COOLIFY_OPERATIONS.md` |
| `deployment/FINAL_PRODUCTION_ENV.md` | The env contract (per-variable authority) | stamp re-verified at ef3d0c3 (R118-A7) |
| `deployment/FINAL_ROLLBACK_RUNBOOK.md` | Redeploy-rollback choreography | subtitle corrected to self-hosted VM (host-neutral content) |
| `deployment/FINAL_RESTORE_DRILL.md` | Restore-drill procedure + ledger (2 PASS drills) | accurate (A7 verdict) |
| `deployment/FINAL_SIGNOFF.md` | Dated release ledger (R115 = cutover release) | accurate as a dated record |
| `deployment/SECRET_HANDLING_FINAL.md` | Secret map for the two Coolify resources | accurate (A7 verdict) |
| `deployment/NEON_IDLE_ECONOMICS.md` | Neon free-tier CU math, suspend policy | stamp re-verified R118 + the R117 OTP `lockPool` note added (F19) |
| `deployment/ENVIRONMENT_MATRIX.md` | r108-era env matrix | "Oracle single-container shape" wording genericized (rows verified) |
| `deployment/RENDER_LEGACY_FALLBACK.md` | Render legacy record | `:4-5` "Production = Cloudflare → Oracle VM" corrected to the live DNS-only/Contabo path (F9/F11 class) |

### docs/ root + topic dirs

| File | Covers | Notes |
|---|---|---|
| `DISASTER_RECOVERY.md` | THE DR source of truth | host references genericized to the self-hosted (Contabo) VM; drill ledger now mirrors the 2 PASS drills + the honest on-VM gap (F11/F12) |
| `WHATSAPP_OPERATIONS.md` | WhatsApp gateway ops | R117-C1 rewrite verified accurate |
| `API.md` | Rate limits + surface (operator reference) | accurate (A7 verdict) |
| `COMPLIANCE.md` | Data-retention/backup compliance claims | **corrected R118-B4a** (F13/F14): audit_logs 180-day purge documented; nightly automated backups + the 2 PASS restore drills recorded |
| `FINAL_MONEY_INVARIANTS.md` | M1–M14 money invariants | header stamp re-verified R118 (prior proofs 521234f/ef3d0c3); M1/M4/M7 cites + M10 suite + index locations corrected (A1 F-2/F-8, A5 infra-6) |
| `NEON_MCP_SETUP.md` | Neon MCP probe endpoint | accurate — endpoint matches live probe URL (A7 verdict) |
| `loyalty/FINAL_LOYALTY_POLICY.md` · `loyalty/LOYALTY_ECONOMICS.md` | Loyalty policy + economics | accurate (A7 verdict) |
| `pricing/PRICING_ECONOMICS.md` | Pricing/margin model | accurate (A7 verdict) |
| `ux/FINAL_UX_SYSTEM.md` | UX/design-system policy | accurate (A7 verdict) |

### inspection-r118/ (this round's evidence — read alongside the docs above)

`R118-A1-backend.md` (backend correctness) · `R118-A2-frontend.md` (frontend/a11y)
· `R118-A3-database.md` (live DB census + the F1 stock finding) ·
`R118-A4-security.md` (security; F-1 TOTP-not-enrolled) ·
`R118-A5-tests.md` (test quality + coverage gaps) ·
`R118-A6-performance.md` (latency census, plans, pool math) ·
`R118-A7-docs.md` (this docs audit + the index proposal this file executes).

## STALE (truth-pass or re-scope before trusting) — 6 files under docs/

> The **R118-B4a truth pass landed 2026-10-06**: the two repo-root historical
> snapshots below were corrected in place (false-present-tense claims flipped,
> "current state" pointers repointed to this index); the `deployment/`
> migration-era files remain historical records — check each file's own header
> stamp before trusting it.

- `PLATFORM.md` (repo root, bannered historical) — false-present-tense claims
  inside the banner corrected R118-B4a (A7 F6); still a dated snapshot.
- `PROJECT_OVERVIEW.md` (repo root, bannered historical, Arabic) — "current
  state" pointers repointed to this index + the runbook, and the live
  Contabo/Coolify stack recorded (A7 F35; R118-B4a).
- `deployment/MIGRATION_RUNBOOK.md` — Render/Vercel→Oracle checklist;
  migration complete.
- `deployment/COOLIFY_ORACLE_MIGRATION.md` — r107 migration guide; historical.
- `deployment/ORACLE_FINAL_SETUP.md` — complete **Oracle Cloud** provisioning
  guide for a host that is not the live one (live = Contabo; A7 F17). Keep for
  its host-neutral VM-hardening sections until folded into
  `operations/CONTABO_COOLIFY_OPERATIONS.md`, then archive.
- `deployment/FINAL_MIGRATION_READINESS.md`, `FINAL_OPERATOR_INPUTS.md`,
  `FINAL_CUTOVER_CHECKLIST.md` — migration-era "pending" docs; the cutover
  executed 2026-10-01/02 (A7 F32 — the checklist now carries an EXECUTED
  banner, R118-B4a).

## ARCHIVED (proposed `docs/archive/` moves — NOT executed; 63 files)

All are dated audit/round artifacts — valuable as history, wrong as "current
state". Proposal: `git mv` into `docs/archive/` (keeps history) + add an
`ARCHIVED (date)` first line. Nothing is moved by R118; this list is the
proposal of record (A7 §5 rules: `FINAL_*` stays the CURRENT naming pattern;
dated files get the ARCHIVED banner instead of deletion).

- **Inspection rounds:** `inspection-r94/` (8) · `inspection-r96/` (6) ·
  `inspection-r97/` (6) · `inspection-r98/` (8) · `inspection-r111/` (5) ·
  `inspection-r117/` (4) — 37 files, ≈1.0 MB.
  (`inspection-r118/` stays CURRENT — it is this round's evidence.)
- **Round reports + repair plans:** `round-92-audit` · `round-93-audit` ·
  `round-94-audit` · `round-95-whatsapp-excellence` ·
  `round-96-mobile-perfection` · `round-96-repair-plan` ·
  `round-97-repair-plan` · `round-97-report` · `round-98-repair-plan` ·
  `round-98-report` · `r110-remediation-2026-09-23` · `r111-round-report` ·
  `r116-round-report` · `r117-round-report` — 14 files.
- **Dated audits/plans:** `deep-audit-2026-09-06` ·
  `strongest-round-2026-09-06` · `db-audit-2026-09-07` ·
  `final-audit-2026-09-20` · `free-tier-optimization-2026-09-20` ·
  `subnation-ux-world-class-plan-2026-09-06` — 6 files.
- **UX audits:** `ux-audit-storefront` · `ux-audit-admin` ·
  `ux-audit-icons` — 3 files.
- **Catalog/SEO:** `catalog/final-report-2026-09-20` ·
  `catalog/catalog-gap-analysis-2026-09-20` · `seo-enrichment-r116` — 3 files.

## Index stats (R118, 2026-10-06)

- **CURRENT: 38** (27 verified legacy docs + 7 `inspection-r118/` reports +
  4 new operations docs) — 15 of the 27 legacy carry inline open-fix notes
  (A7 findings being addressed in this round's truth pass).
- **STALE: 6** under `docs/` (+2 repo-root historical snapshots + the two
  root front-door docs named in the header).
- **ARCHIVED proposals: 63.**
- Total markdown under `docs/`: 103 pre-R118 + 5 new (this index + 4
  operations docs) = **108**.

## House rules (from A7 §5, binding for new docs)

1. `FINAL_*` is the only naming pattern for CURRENT operator docs.
2. Dated files get an `ARCHIVED (date)` first line instead of deletion.
3. Every "for current state see X" pointer lands on **this index**.
4. New docs carry `Status: CURRENT @ <date>` and the change that invalidates
   them must touch that line.
