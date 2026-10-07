# FINAL SIGNOFF — R115 production cutover release (2026-10-01)

> Status legend: **VERIFIED** (executed + green) · **VERIFIED WITH LIMITATION**
> (executed, known boundary) · **STATICALLY VERIFIED** (proven from
> source/config/docs, runtime awaits cutover) · **NOT VERIFIED** (needs the
> operator's infrastructure) · **BLOCKED BY EXTERNAL INFRASTRUCTURE** · FAILED.
>
> Release identity: **R115 = `6f14bc3`** (origin/main, verified synced; full
> SHA `6f14bc37f00a2d963c00d61c8dcd60a43214a570`). R115 content: the loyalty
> economics integrity core (`6caa63b`), the premium storefront + admin
> economics console (`3a2e2e1`), and the red-team review fixes (`6f14bc3` —
> V1-M21 opening-balance boot-abort P0, calculator safe-min math, FIFO
> pre-ledger reversals).
>
> **Cutover executed 2026-10-01/02** — this table is the dated R115
> pre-cutover ledger; the post-cutover release record is `git log` +
> `docs/project-plan/10-progress-log.md` (R116→R121).
>
> **CI truth for this table:** GitHub Actions is disabled on SubNation2
> (billing suspension — `FINAL_OPERATOR_INPUTS.md` §account-level cleanup), so
> **zero CI runs exist for `6f14bc3` on GitHub**. Every gate below was
> executed locally on the exact release commit using the SAME commands as the
> CI quality job (`docs/deployment/FINAL_COMMAND_BOOK.md` §LOCAL) — this
> table is the release authority.

| Item | Status | Evidence |
|---|---|---|
| Architecture | **STATICALLY VERIFIED** | `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md`; compose header declares the authoritative strategy; R115 changed application behavior (loyalty economics, storefront) but introduced NO topology change — no new services, no Redis, single container |
| Git SHA | **VERIFIED** | R115 release `6f14bc3` == origin/main (fetch + rev-parse, 2026-10-01); working tree clean at the SHA |
| Backend tests | **VERIFIED** | 162 files / **1497 / 0 failed** on `6f14bc3` (vitest run, 408 s) — includes the R115 loyalty suites: points-ledger writers, FIFO reversal replay, welcome-policy B, stacking cap, calculator golden matrix + property invariants (35/35 red-team suites green per the `6f14bc3` commit record) |
| Frontend tests | **VERIFIED** | 101 files / **703 / 0 failed** on `6f14bc3` (vitest run, 125 s) — includes the R115 storefront/admin-console suites |
| OpenWA tests | **VERIFIED** | **103 / 0 failed** at the pinned `ba6a843` (npm test = strict tsc build + suite); openwa CI green on GitHub (both workflows: CI + Docker multi-arch, 2026-09-25); pinned image `ghcr.io/ahmadmedo1012/openwa:sha-ba6a843` verified LIVE from the registry 2026-10-01: tag present, multi-arch index **linux/amd64 + linux/arm64** |
| Typecheck | **VERIFIED** | exit 0 across all workspaces (libs project-refs build + backend + frontend + scripts) |
| Lint | **VERIFIED** | **0 errors / 91 warnings** (85 at r111 → 91 with R115's new files; all warnings, no gate failures) |
| OpenAPI contract gate | **VERIFIED** | `check-openapi-routes.ts` PASS: 82 documented / 171 implemented / 89 allowlisted internal-diagnostic families — every enforced route documented, every documented operation implemented |
| Migration drift | **VERIFIED** | `drizzle-kit generate` → "No schema changes, nothing to migrate"; `git diff --exit-code -- shared/db` clean — the 0014 chain (`0014_fuzzy_jazinda`) matches the schema exactly |
| Production build | **VERIFIED** | `pnpm --filter @workspace/api-server run build` exit 0: API + Vite SPA + PWA (generateSW, 10 precache entries / 347.47 KiB); bundle budgets green (index 36,775 B gzip) |
| Security | **VERIFIED WITH LIMITATION** | gitleaks **8.27.2 git-mode + `.gitleaks.toml` (the CI-pinned method): 166 commits / 14.22 MB scanned, 0 leaks**; `pnpm audit --prod --audit-level critical` exit 0 (0 critical; 14 high = triaged inform-tier per CI policy — trusted-egress chains); limitation: no external live pen-test was performed |
| Docker | **VERIFIED WITH LIMITATION** | Dockerfile/compose audit green (multi-stage, prod-only, non-root, healthcheck, GIT_SHA, secret-free, log rotation); runtime gates require a Docker host: run `scripts/docker-verify.sh --arm64` on the VM (limitation: this sandbox has no Docker daemon — unchanged since R112) |
| ARM64 | **STATICALLY VERIFIED** | Supply chain at `6f14bc3`: 24 `linux-arm64` + 9 `linux-x64-musl` lockfile refs (esbuild 0.27.3, rollup 4.59.0 gnu+musl, tailwindcss/oxide 4.2.1 gnu+musl, lightningcss 1.31.1, @sentry/cli 2.58.5); `node:22-alpine` multi-arch base; openwa's arm64 manifest verified live (row OpenWA). The canonical runtime gate remains `docker-verify.sh --arm64` → **ARM64 VERIFIED** on the VM |
| Migrations (R115) | **APPLIED + VERIFIED (2026-10-01)** | V1-M21 (points_ledger + `users.welcome_bonus_granted` + `users.loyalty_points >= 0` CHECK, probe-gated with skip-and-warn + reboot-to-apply) + V1-M22 (orders `refunded_at`/`refund_amount`/`refunded_by_admin_id` + wallet_ledger backfill) — idempotent boot stages in `migrate.ts`; the R115-R1 P0 (opening-balance backfill aborting boot for zero-point users) is FIXED in `6f14bc3` (`WHERE loyalty_points <> 0`) — **`6caa63b`/`3a2e2e1` must never be deploy targets**. First R115 boot applies every still-pending stage (R112 record: 4 non-destructive pre-R115 stages through V1-M20) in one idempotent pass. **r115-db: executed 2026-10-01T02:49:32→02:50:07Z against canonical Neon with legacy writers suspended — V1-M18/M19/M20/M21/M22 first-applied, 0 constraint skips, backfills sane (opening 3 / welcome 0 / refunds 2); fingerprint deliberately absent until the production build's own first boot (no-op verify + `v2` marker write)** |
| Neon | **VERIFIED (R115 record)** | Live DB (project `calm-art-99771185`, branch main, db neondb) reconciled to the exact R115 schema on 2026-10-01: 42/42 tables, 0 mismatches vs the drizzle TS source of truth, 12 enums exact, drift 0; full data forensics clean (orders↔ledger 7/7, refunds 2/2, wallet 5/5, topups 5/5 evidenced, zero negative balances, sequences healthy, no orphan FKs); legacy Render writers suspended 02:47:50Z (auto-resumed by the Oct-1 free-hours renewal, then re-suspended — kept suspended per §21) |
| Backup | **VERIFIED (R115 record)** | REAL pre-migration run 2026-10-01T02:46:34Z: `pg_dump 17.11` (exact server match) exit 0 → `subnation_preR115_20261001T024634Z.sql.gz` (62,417 B, 40 tables/40 COPY blocks), `gzip -t` OK, sha256 `3680136b…4d73` + `BACKUP_METADATA.json` recorded; R112 record (2026-09-25) also stands; nightly cron install on VM = checklist item |
| Restore | **VERIFIED (R115 record)** | REAL drill PASS 2026-10-01: Neon scratch branch `r115-restore-drill` → db `drill_restore` restored from the pre-migration backup in 1m39s, zero SQL errors, FK constraints 39, orphan checks 0 → `restore-drill-check.sh` **exit 0 (VALIDATED)**; branch deleted after (no second production database); VM-parity rerun = checklist item |
| Cloudflare | **NOT VERIFIED** | DNS stays an operator action by design; readiness gate `scripts/dns-cutover-check.sh` tested (guards + failure paths + live DNS read); runbook `docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` |
| HTTPS | **NOT VERIFIED** | Issued by Coolify's Let's Encrypt at cutover; the dns-cutover-check TLS section validates it before the switch |
| Socket.IO | **VERIFIED WITH LIMITATION** | Transport stack regression-proven inside the 1497; handshake gate = docker-verify §5 on the VM |
| TOTP | **STATICALLY VERIFIED** | Full journey proven in code + tests; enrollment on `ahmadmedo` = operator (checklist §E) |
| Inventory | **VERIFIED (R112 record, as data)** | 45 active products, 1 deliverable unit (netflix-premium) — R115 changed NO inventory data (hard rule: no fake inventory/test production data); loading = operator data entry |
| Loyalty economics (R115) | **VERIFIED + RECONCILED (2026-10-01)** | Every points mutation now writes its points_ledger row in the SAME transaction (6 attributed types + structural exactly-once); refunds revoke exactly the unspent award remainder (keyed FIFO replay — pre-ledger orders use the legacy floor); welcome policy B on ALL channels (5 LYD at first approved topup, guarded `welcome_bonus_granted`); tiers derived-only from net spend; stacking cap enforced; all proven by the suites inside the 1497/703 |

## Remaining engineering blockers

**None.** All locally verifiable gates are green on the exact release commit.

## Remaining operator actions (the only work left)

Per `docs/deprecated/FINAL_OPERATOR_INPUTS.md` + the executable
`docs/deprecated/FINAL_CUTOVER_CHECKLIST.md`: VM provisioning → Coolify →
secrets → docker-verify/preflight on VM → backup cron + restore drill →
WhatsApp QR → TOTP enrollment → inventory load → private smoke test →
DNS cutover. Account-level: restore Actions minutes (or accept local-gate
authority) + build the first `subnation2` GHCR fallback image once restored.

## FINAL STATUS: **PRE-CUTOVER READY (R115)**
