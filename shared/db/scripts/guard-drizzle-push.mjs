#!/usr/bin/env node
// R122 (A4-P1-1): fence around `drizzle-kit push` — the one-command
// production outage.
//
// The LIVE production DB is built and reconciled by backend/src/migrate.ts
// (the boot engine), which creates every FK / unique constraint under ITS
// OWN names (fk_orders_user, users_firebase_uid_key, …). The drizzle chain
// (shared/db/drizzle/*.sql) is DECLARATIVE-ONLY documentation — nothing in
// the repo executes it at runtime; CI only regenerates + diffs it (ci.yml
// "Migration drift check").
//
// `drizzle-kit push` reconciles BY NAME. Run against the boot-built live
// DB it sees all 40 FKs and ~11 unique constraints as differently-named
// objects → DROP + re-ADD each (an AccessExclusiveLock on every money
// table), plus re-derivation of the boot-owned NULLS NOT DISTINCT index
// and the probe-gated CHECKs — a full production outage with schema churn
// the CI drift gate cannot prevent.
//
// Schema changes flow EXCLUSIVELY through migrate.ts (the post-merge.sh
// convention since round-4). If you are ABSOLUTELY sure you want a push
// against a throwaway / chain-built database, set:
//
//   I_ACCEPT_DRIZZLE_PUSH_DANGER=true pnpm --filter @workspace/db push
//
// Anything else exits 1 with this explanation, before drizzle-kit runs.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.env.I_ACCEPT_DRIZZLE_PUSH_DANGER !== "true") {
  console.error(`
drizzle-kit push is DISABLED by default (R122, A4-P1-1).

The production database is built by backend/src/migrate.ts under its OWN
constraint names (fk_orders_user, users_firebase_uid_key, ...), which DIVERGE
from the drizzle-chain names (orders_user_id_users_id_fk, ...). A push against
the boot-built live DB drops and re-creates every FK + unique constraint —
an AccessExclusiveLock on every money table (production outage).

Schema changes flow exclusively through migrate.ts (boot stages).
The shared/db/drizzle/*.sql chain is declarative-only (CI regenerates +
diffs it; nothing executes it at runtime).

To override — ONLY against a throwaway or chain-built database:

  I_ACCEPT_DRIZZLE_PUSH_DANGER=true pnpm --filter @workspace/db push
`);
  process.exit(1);
}

// Opt-in given: hand the invocation to drizzle-kit with the exact argv it
// would have received without this guard (args pass through verbatim —
// `push` forwards nothing, `push-force` forwards --force — and the config
// path is pinned to this package's drizzle.config.ts as before).
const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const result = spawnSync(
  process.execPath,
  [
    path.join(packageDir, "node_modules", "drizzle-kit", "bin.cjs"),
    "push",
    ...process.argv.slice(2),
    "--config",
    path.join(packageDir, "drizzle.config.ts"),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
