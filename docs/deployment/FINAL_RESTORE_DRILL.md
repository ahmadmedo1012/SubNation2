# Final Restore Drill Runbook — SubNation

> Companion to `docs/DISASTER_RECOVERY.md` (the master DR reference — backup
> inventory, recovery scenarios, cron install). This file owns ONE thing: the
> executed procedure + ledger for proving a backup actually restores.
> Scratch-target procedure, drill checklist, and the dated drill record.

## 0. HARD RULE — never restore over production

**Restoring a dump over the production database is FORBIDDEN.** A drill (or a
real recovery rehearsal) ALWAYS targets a SEPARATE scratch database whose name
contains `drill`, `scratch`, or `restore` (e.g. `subnation_drill`).

This is enforced by construction, not by operator discipline:
`scripts/restore-drill-check.sh:36-44` parses the database name out of the URL
and exits **64** unless it matches `*drill*|*scratch*|*restore*|*test*` — the
validation step physically cannot run against a production-shaped name. The
script is also read-only by design (`restore-drill-check.sh:9` — "THIS SCRIPT
NEVER WRITES"). The restore command itself is typed by the operator, so the
discipline still applies there: paste a scratch URL, nothing else.

## 1. Prerequisites

| # | Requirement | How to confirm |
|---|---|---|
| 1 | Preflight CLEAR | `./scripts/backup-preflight.sh` exits 0 (`BACKUP PREFLIGHT CLEAR`) — checks pg_dump/pnpm/gzip on PATH, `DATABASE_URL` shape + `sslmode`, backup dir writable, ≥500 MB disk headroom, `BACKUP_KEEP ≥ 1` |
| 2 | A fresh backup | `pnpm --filter @workspace/scripts run backup --keep 14` — must end with `✓ gzip integrity verified` (r112 step: full gunzip re-read, CRC32 trailer checked, torn artifacts removed — `scripts/src/backup-db.ts:300-333`) and `✓ backup complete` |
| 3 | Client tools | `pg_dump`/`psql` on PATH. Neon runs PostgreSQL **17** → install `postgresql-client-17` or newer (`apt install postgresql-client-17`); backup-db.ts aborts on a major-version mismatch |
| 4 | A scratch Postgres target | Pick ONE: |

- **Option A — second Neon branch/database (recommended):** create from the
  Neon console (Console → project → Branches → "New branch", or a new database
  in the project). Same engine version as production — no version-skew noise.
  Name it e.g. `subnation_drill` so the check script accepts it.
- **Option B — local docker container** (zero Neon footprint):
  ```bash
  docker run -d --name drill-pg -e POSTGRES_PASSWORD=drill -p 127.0.0.1:5433:5432 postgres:17
  ```

## 2. Procedure (exact commands)

Run from the repo root; `BACKUP_DIR` is wherever your dumps live
(`/var/backups/subnation` on the VM, `./backups` by default).

```bash
# 1. Decompress the newest backup (r112 backups are verified gunzip-clean,
#    but the local re-check is free)
NEWEST=$(ls -1 "$BACKUP_DIR"/subnation-*.sql.gz | sort | tail -n 1)
gunzip -c "$NEWEST" > /tmp/subnation-drill.sql

# 2. Create the scratch database (name MUST contain drill/scratch/restore)
#    Option A (Neon): createdb from any psql against the branch URL.
createdb "postgres://.../subnation_drill"

# 3. Restore the dump into it
psql "postgres://.../subnation_drill" -f /tmp/subnation-drill.sql
# A "unrecognized configuration parameter" stderr line from a version-skewed
# drill server is benign (see the R112 record below) — judge by the exit code.

# 4. Validate — expect exit 0 and the ✓ list
./scripts/restore-drill-check.sh "postgres://.../subnation_drill"

# 5. Drop the scratch database (record this — never skip it)
psql "<admin-url>" -c 'DROP DATABASE subnation_drill WITH (FORCE);'
rm -f /tmp/subnation-drill.sql   # decompressed dump contains credential data
docker rm -f drill-pg 2>/dev/null # only if Option B was used
```

`WITH (FORCE)` disconnects any lingering session before the drop — the same
drop command the check script prints on success (`restore-drill-check.sh:99`).

## 3. What the check validates

`scripts/restore-drill-check.sh` runs read-only SQL and asserts:

- **Schema:** `public` tables ≥ 38 (a torn/partial restore fails here).
- **Critical tables exist and are queryable:** `users`, `admin_users`,
  `products`, `product_variants`, `inventory`, `wallet_topups`, `orders`,
  `openwa_sessions` — row counts printed for each.
- **Business data survived:** ACTIVE products (`is_active AND NOT
  is_archived`) > 0; `admin_users` ≥ 1 (someone can log in after this
  restore).
- **Deliverable stock** under ACTIVE products: informational — restock is an
  operator action, never fabricated by a drill.
- **`openwa_sessions` presence:** the table must exist and be queryable;
  **0 rows is expected** when no WhatsApp session was linked at backup time
  (the gateway re-pairs via QR on the real system — see
  `docs/WHATSAPP_OPERATIONS.md`).

## 4. Drill ledger

> Never backfill — a drill that was not executed does not go in the ledger.

| Date | Environment | Steps | Result | Operator |
|---|---|---|---|---|
| **2026-09-25 (R112)** | engineering sandbox → live Neon DB (dump source) + local scratch PG cluster | 1–5 above | **PASS** — details below | r112 agent |
| **2026-10-01 (R115)** | release sandbox → live Neon (backup source) + **Neon scratch branch** `r115-restore-drill` db `drill_restore` | 1–5 above | **PASS** — details below | r115 release engineer |
| PENDING-OPERATOR | the production VM (on-VM tooling proof; live host = Contabo) | 1–5 above | first ON-VM drill remains an open operator action | — |

### R115 drill record (2026-10-01) — PASS

- **Backup under test:** `subnation_preR115_20261001T024634Z.sql.gz`
  (62,417 bytes) — the **pre-migration** recovery point taken at
  02:46:34Z, immediately before the R115 reconcile (see
  `BACKUP_METADATA.json` shipped beside it in the same download bundle;
  sha256 `3680136b…4d73`). `pg_dump 17.11` (exact server match) exit 0,
  `gzip -t` OK, 40 COPY blocks / 40 CREATE TABLE.
- **Scratch target:** Neon branch (copy-on-write) on the SAME project —
  branch `r115-restore-drill`, database `drill_restore` (name-guard
  satisfied by construction). Production was never touched; the branch
  was **deleted** after the drill (HTTP 200).
- **Restore:** `zcat | psql` → exit 0 in 1m39s, **zero SQL errors**.
- **Validation:** `restore-drill-check.sh` → **exit 0 (RESTORE DRILL
  DATABASE VALIDATED)** — 40 tables, users 17 / admin_users 3 / products
  59 (45 ACTIVE) / variants 263 / inventory 10 / topups 13 / orders 7 /
  openwa_sessions queryable; FK constraints 39 restored; orphan checks
  0; wallet cached=ledger parity 5/5 in the restored copy.
- **Delta vs R112 drill:** validated the exact R115 pre-migration backup
  (the recovery point the rollback floor depends on), on a Neon-native
  scratch branch rather than a local cluster.

### R112 drill record (2026-09-25) — PASS

- **Backup:** `pg_dump` 17.11 (client) against Neon server 17.11 via
  `scripts/src/backup-db.ts` → `subnation-2026-09-25T01-24-31-286Z.sql.gz`,
  62,485 bytes compressed / 326,696 bytes decompressed. Exit 0, ended with
  `✓ gzip integrity verified` (the r112 full-gunzip CRC32 re-read).
- **Restore:** fresh throwaway PG cluster (`initdb`) on 127.0.0.1; `psql`
  restore **exit 0**, with one benign stderr line —
  `unrecognized configuration parameter transaction_timeout` (a PG17-emitted
  `SET` replayed on the PG16 drill server; harmless, no data impact).
- **Validation:** `scripts/restore-drill-check.sh` → exit 0, verdict
  **RESTORE DRILL DATABASE VALIDATED** — 40 public tables; `users=17`,
  `admin_users=3`, `products=59` (45 ACTIVE), `product_variants=263`,
  `inventory=10` rows (1 deliverable unit under ACTIVE products — the
  netflix-premium product; 10 total incl. archived units), `wallet_topups=13`,
  `orders=7`, `openwa_sessions=0` rows (table present — expected: no session
  was linked at backup time).
- **Scratch database dropped** after the run.

**Honest scope note:** this drill ran from the engineering sandbox — the dump
was taken against the LIVE Neon database, and the restore landed in a LOCAL
scratch cluster on 127.0.0.1. It therefore validates the dump pipeline, the
restore path, and the validation tooling end-to-end. It does NOT prove the
on-VM toolchain (host-cron entry, `pg_dump` on the VM's PATH, `/var/backups`
write path) — which is why the operator's **first ON-VM drill remains a
cutover-checklist item** (`docs/deprecated/FINAL_MIGRATION_READINESS.md` §2
"restore rehearsal before cutover" + Operator TODOs, `docs/history/r111-round-report.md`
item 5, and the `PENDING-OPERATOR` ledger row in `docs/DISASTER_RECOVERY.md`).

## 5. Cadence

- **First drill:** before DNS cutover (the on-VM row above).
- **Then:** quarterly — same calendar as `DISASTER_RECOVERY.md` §"Restore
  drill schedule" (Jan/Apr/Jul/Oct 1st).
- **Plus:** after ANY change to backup tooling (`scripts/src/backup-db.ts`,
  `scripts/backup-cron.sh`, retention/prune logic) or a Neon major-version
  bump — a drill is the only proof the new artifact shape restores.

Record every run in the ledger above (date, environment, steps, result,
operator) and mirror it in `docs/DISASTER_RECOVERY.md`'s drill ledger — that
file stays the master DR reference.
