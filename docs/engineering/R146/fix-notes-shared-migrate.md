# R146 fix notes — shared packages + the migration system (agent 146-FIX-5)

Implements findings 1–5 of `audit-shared-migrate.md`. Lane files only:
`backend/src/migrate.ts`, `backend/src/jobs/__tests__/migrate-boot-body.test.ts`,
`shared/db/package.json`. No service/route/CI/config file was touched.

Verification baseline before any edit: read `lib/encryption.ts` end-to-end.
The real ciphertext shapes are exactly what the audit assumed — v1 =
`iv:tag:ct` hex triple with IV 12 bytes (24 hex chars) and GCM tag 16 bytes
(32 hex chars); v2 = `v2:` + the same triple (`encrypt()` line 193, `isEncrypted()`
lines 335–350). One deviation from the audit's suggested predicate was needed
on purpose: `isEncrypted()`'s v1 check is **length-only, not hex**, so the SQL
pre-filter deliberately uses the *stricter* hex shape — a v1-shaped but
non-hex value is pulled into memory once and then skipped by the JS gate
(no behavior change vs the old filter, which also excluded it by colon count).

## Finding 1 — legacy plaintext credentials with two colons never encrypted

- **Changed (`backend/src/migrate.ts`):**
  - inventory loop (was :948, now :950–953): `AND account_password NOT LIKE '%:%:%'`
    → `AND account_password NOT LIKE 'v2:%' AND account_password !~ '^[0-9a-f]{24}:[0-9a-f]{32}:'`
  - orders loop (was :1776, now :1783–1786): same line-for-line swap for
    `delivered_password`.
  - +4/+5-line why-comments at both sites (the old guess matched human text).
- **Why this is safe:** the pre-filter is a *superset* selector — everything it
  pulls is re-checked by the authoritative JS `isEncrypted()` gate, which
  unchangedly skips anything v2-prefixed or v1-shaped. Only rows that are
  neither ciphertext shape reach `encrypt()`. Uppercase-hex or non-hex
  v1-lookalikes are pulled once per boot and skipped by the gate (they were
  invisible to the old filter too — no regression, just one in-memory row).
- **Test:** new boot-body test "F1: a plaintext credential containing two
  colons is encrypted on boot" — seeds `inventory.account_password =
  'user:pass:2fa'` and `orders.delivered_password = 'mail:secret:otp'`, runs
  the full `runMigrations()` body, asserts both stored values are
  `isEncrypted() === true` and `decrypt()` round-trips the exact plaintext.
- **Mutation proof (non-vacuous pin):** with both fixes temporarily reverted
  to `NOT LIKE '%:%:%'`, the test fails (`expected false to be true` — the row
  stays plaintext); re-applied, it passes.

## Finding 2 — no automated column-level parity gate (migrate.ts vs schema TS)

- **Changed:** `migrate-boot-body.test.ts` — new test "F2: every schema-TS
  column exists in the boot-built database, and vice versa (column census)".
  Iterates every `pgTable` exported by `@workspace/db/schema` (filtered with
  drizzle's `is(value, PgTable)`, pinned to 41 so a silent filter regression
  can't make the loop vacuous), maps `getTableColumns()` **column `.name`s**
  (the SQL names — `getTableColumns` is keyed by TS property name, so
  `Object.keys` would have compared camelCase to snake_case and failed on
  every table), and `toEqual`s them against `information_schema.columns` of
  the boot-built PGlite — mismatch in either direction fails.
- **Result:** the census **PASSES on the current tree** — all 41 tables,
  both directions, zero mismatches. No parity bug found; no schema or
  migrate.ts edit was made for this finding. The gate exists purely to fail
  the next schema-only column addition (the audit's `users.marketing_opt_in`
  → production 42703 scenario) while every other CI check stays green.

## Finding 3 — admin-seed INSERT can abort a concurrent cold boot as "critical"

- **Changed (`backend/src/migrate.ts:1017`):** `ON CONFLICT (username) DO NOTHING`
  appended to the admin seed INSERT (one statement line + 3-line why-comment),
  matching its three sibling seeds (:984, :1195, :1293).
- **classifyError/23505 decision — NOT taken:** after reading
  `classifyError` (boot-migrations.ts:169–190), its "idempotent" class is
  documented as *object-already-exists* SQLSTATEs (42P06/42P07/42701/42710 +
  "already exists" text). 23505 is *data-level* duplicate key: a backfill
  INSERT that hits it usually means the migration's merge logic is wrong, and
  classifying that as "log + continue" would swallow real data-migration
  bugs (and weaken a boot-abort safety net — ponytail forbids). The one-line
  root fix at the only known racy site covers the audited scenario fully.
- **Test:** new boot-body test "F3: the admin seed INSERT loses a
  concurrent cold-boot race without aborting" — deletes `admin_users`, wraps
  the mocked `db.execute` so that at the exact `INSERT INTO admin_users`
  statement boundary (after the COUNT saw zero) a "leader" row with the same
  username is inserted first, then asserts the full body still resolves and
  exactly one admin row remains.
- **Mutation proof:** with the `ON CONFLICT` line temporarily removed the
  test fails with the exact production shape the audit predicted —
  `duplicate key value violates unique constraint "admin_users_username_key"`
  propagating out of `runMigrations()`.

## Finding 4 — dead zod dependency in @workspace/db

- **Changed:** `shared/db/package.json` — deleted `"zod": "catalog:"` (-1
  dependency). Re-verified zero zod imports anywhere under `shared/db`
  (only comments referencing the R135 removal).
- **Install note:** `pnpm install` NOT run, per instructions — **the
  orchestrator must refresh the lockfile once after all lanes land**
  (`@workspace/db` importer block in `pnpm-lock.yaml` still references zod
  until then). Concurrent installs were the thing the instruction avoids.

## Finding 5 — "Migrations completed" logged mid-run

- **Changed (`backend/src/migrate.ts`):** the `logger.info("Migrations completed")`
  line moved from after the seed blocks (was :1243) to after
  `applyR135IndexWaveStage()` (now :2005), i.e. after all 34 V1 stages and
  before the fingerprint persist — with a 3-line why-comment. Chose "move"
  over "reword": both are one line, and the moved line is the honest one
  (nothing DDL-shaped executes after it). Log-only; no runtime effect.

## Test evidence

From repo root, all green:

```
pnpm --filter @workspace/api-server exec vitest run \
  src/jobs/__tests__/migrate-boot-body.test.ts \
  src/jobs/__tests__/migrate-drizzle-chain-apply.test.ts \
  src/jobs/__tests__/migrations-fast-path.test.ts
```

- `migrate-boot-body.test.ts` — **8 passed** (5 pre-existing + F2 census + F1 + F3),
  ~10 s. The census adds ~0.2 s (catalog reads only); F1/F3 each add one full
  body replay.
- `migrate-drizzle-chain-apply.test.ts` — **5 passed** (untouched; the chain
  side of the parity story).
- `migrations-fast-path.test.ts` — **13 passed** (the other direct
  `runMigrations()` consumer; throw-vs-resolve oracle unaffected).
- Mutation run (F1+F3 fixes temporarily reverted): 2 failed / 6 passed —
  exactly the two new pins fail, proving both are real regression gates.
- `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit` —
  clean. `prettier --check` on the three touched files — clean.

## Pins updated

- None. All 26 pre-existing assertions (including the 41/29/39/139 census and
  the executeCalls>300 floor) pass unchanged — the fixes are additive to the
  boot's end shape. The new `expect(tables.length).toBe(41)` inside the F2
  census is a new pin, not an updated one (schema exports exactly the 41 boot
  tables, 1:1, verified before pinning).

## Parity-mismatch discovered by the new census gate

None — the census passes on the current tree in both directions. (This is the
honest "it should pass" outcome the task predicted; had it failed, the
mismatch would be reported here verbatim.)

## Out-of-lane needs / orchestrator notes

1. **Lockfile refresh required** after all lanes land (finding 4 removed a
   dependency; `pnpm install` deliberately not run in-lane).
2. Any deploy carrying these changes performs exactly **one extra full
   reconcile** on first boot — the migration fingerprint's codeHash covers
   migrate.ts, so the fast-path marker mismatches once by design, then
   re-persists.
3. Nothing needed from services/routes/CI lanes; no other file references the
   moved log line, the old pre-filter text, or the admin seed shape
   (grep-verified; the only `%:%:%` hits left are this doc, history docs, and
   the why-comments).
