> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r130/A8-database.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R130-A8 — Database / schema / migrations / Neon audit

**Method:** code + migration files only (no DB connections this round —
read-only mandate). HEAD fd702d6. Round deltas since R127: f029a63 (0020 +
V1-M31 + statement_timeout SET hook), eb50024 (notifications ?page= +
migrate.ts comment). R129: no backend DB changes.

## Chain health — PASS
`shared/db/drizzle/0000..0020` (21 files): journal sequential + monotone +
breakpoints, tags byte-match filenames, no duplicates. Idempotency guards
present in every post-r110 file. Boot stages V1-M1..M31 present, each called
exactly once from runMigrations; every stage probe-gated, DO-block-swallowed,
or unconditional-IF-NOT-EXISTS. Boot↔chain parity for the new pair (V1-M31 ↔
0020): 8/8 index-name parity (one definitional divergence = F1). Snapshot
0020: 41 tables, 90 declared indexes. CI drift gate green at HEAD per the
R129 record; db:push still fenced behind the danger guard.

## Index audit — hot paths
All scope-named predicates have serving declarations (orders/ledger/topups/
notifications/cart/sessions). The one hot-path gap remains products.price
sort (routes/products.ts:426-427) — inherited R126-A6 F3, still open,
correctly carried. Zero-consumer candidate: F2.

## Constraints — PASS
V1-M25 (RESTRICT ×4 money-history tables incl. orphan-probe + confdeltype
probe), V1-M26 (money CHECKs pinned to schema names, mirrored 0018),
orders.order_code UNIQUE, idempotency_keys PK, uniq_wallet_topups_payment_
reference partial unique, FK convergence discipline verified.

## Retention — PASS with notes
All 13 ctid-batched prune paths present; whatsapp_otps rides the indexed
expires_at. Unbounded-by-design (correct): the money audit trail.

## N+1 / transactions — PASS
Notifications pagination one Promise.all; product detail batched pool data;
admin mass-refund loop deliberate + documented. Checkout tx body DB-only;
Telegram emissions post-commit; boot advisory-lock tx consistent with 0020.

## Findings

### A8-F1 [P3 — SUSPECTED] Systematic DESC-index mirror divergence — DOCUMENTED R130 (follow-up filed)
Chain/snapshot declare `DESC NULLS LAST` (drizzle-kit 0.45's output for
`.desc()`); boot twins create plain `DESC` (= NULLS FIRST); the consumer's
`ORDER BY x DESC` wants plain desc — i.e. the LIVE boot-created shape is the
correct one and the DECLARED mirror is the divergent one (~20 `.desc()`
indexes). Impact today: zero (nothing executes the chain; IF-NOT-EXISTS
name-parity makes the tracks no-op against each other). Real risk: a
chain-built fresh environment gets index shapes a hair less optimal for
their own ORDER BY. **R130 disposition:** the full fix (re-declare each
`.desc()` as a raw sql`col desc` expression column + regen chain/snapshot)
is a 20-site, 15-file regen wave — deferred as a documented follow-up with
the convention pinned in `shared/db/src/schema/index.ts` (plain DESC is
canonical; do NOT "fix" the boot twins to match the chain). Smallest
complete fix per the round's batch discipline.

### A8-F2 [P4 — VERIFIED] `idx_wallet_ledger_type` has zero consumers
Consumer analysis done before listing: walletLedgerTable consumers filter
user_id + sort created_at (idx_wallet_ledger_user_created) or INSERT; no
query touches wallet_ledger.type (grep = 0). Pure write amplification on a
money INSERT table. Smallest fix: a future probe-gated DROP INDEX stage
(V1-M32, V1-M27 idiom) + schema/chain mirror removal — not urgent at ~30
ledger rows; confirm no out-of-repo SQL depends on it first.

### A8-F3 [P4 — SUSPECTED] `wallet_topups.payment_reference` is DB-nullable while the replay guard is a partial unique on it
Both writer paths always set it today; only a bypass writer (cron/SQL
console/future code) could insert an approvable NULL-reference row twice →
two approvals → double credit. Smallest fix: additive boot stage (count NULL
→ alert-and-skip if >0, else backfill sentinel then NOT NULL in a DO-block)
+ schema/chain mirror. Needs its own probe-gated stage round.

### A8-F4 [P4 — VERIFIED] Run-metadata tables have no retention path
enrichment_runs / inventory_forecast_runs / provider_fulfillments —
semantics: ≤1-2 runs/day, ~2 orders/30d live → tens of rows/year; harmless
for years. Fold into the documented ~10⁴-row trigger list rather than
shipping a prune now. copilot_actions/copilot_action_items remain the
documented operator decision (OPERATOR_ACTIONS_R118 #12).

## Inherited — VERIFIED CLOSED this round
V1-M25 RESTRICT rebuild, V1-M26 CHECKs, V1-M27..M30, statement_timeout SET
hook + failure logging (R127-L3/R128-B3-F1), retention-index gaps G1-G7
(closed via V1-M31 + 0020), pg_stat_statements operator-DDL scope note,
no-CONCURRENTLY trigger documentation.
