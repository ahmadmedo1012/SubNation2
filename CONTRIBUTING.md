# Contributing to SubNation

Thanks for helping improve SubNation — an Arabic-first (RTL) digital
subscriptions marketplace, live in production at <https://subnation.ly>.
This guide covers the practical path from clone to a merge-ready change.

## Setup

Node.js **22+** and **pnpm 10+** are required (pnpm is enforced — npm/yarn
installs fail fast):

```bash
pnpm install
cp config/env.example .env      # edit DATABASE_URL
pnpm run dev                    # boot migrations create/update the schema
pnpm run db:seed                # default admin + sample products (idempotent)
```

No local Postgres? The README's *Local PostgreSQL* section has a one-command
Docker recipe. Redis is optional in development.

## Gates to run before every PR

CI (`.github/workflows/ci.yml`) runs these on every push — run them locally
first so the PR lands green:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @workspace/api-server exec vitest run      # backend suite (240 files)
pnpm --filter @workspace/subnation run test:run          # frontend suite (168 files)
pnpm build                                               # includes the bundle budget gate
```

Contract rules the gates enforce:

- **API changes**: edit `shared/api-spec/openapi.yaml`, then run
  `pnpm --filter @workspace/api-spec run codegen` and commit the regenerated
  clients — the orval drift gate fails CI otherwise.
- **Schema changes**: flow exclusively through the idempotent boot migrations
  (`backend/src/migrate.ts`). **Never run `db:push`** against any shared or
  production database; regenerate Drizzle migrations so the drift gate stays
  green.
- **Money-adjacent code** (wallet, checkout, top-ups, refunds, loyalty):
  `docs/FINAL_MONEY_INVARIANTS.md` (M1–M14) is law — changes near it require
  the money suite green and an explicit note in the PR.

## Conventions

- **Conventional commits with a round tag**: `fix(backend): … (R126)` /
  `docs(readme): … (R126)`. This repo ships by round, not semver.
- **Evidence-stamped changes**: every claim a change makes (counts, bytes,
  gates, live behavior) carries its evidence — file:line, command output, or
  a live probe. "Should pass" is not evidence.
- **Docs stay true**: if your change invalidates a doc, fix the doc in the
  same round (house rules in `docs/README.md`). New current-state docs carry
  `Status: CURRENT @ <date>`.
- **Round reports**: rounds are recorded in `CHANGELOG.md` (one entry per
  round, newest first) with audit/inspection reports under
  `docs/inspection-r###/`. Don't edit past entries — corrections land as
  bracketed notes in the current round.

## Reporting issues

Open an issue using the bug or feature template (Arabic or English both
fine). Security findings follow [`SECURITY.md`](./SECURITY.md) — never a
public issue.

## Where things live

`README.md` for the product + quickstart · `docs/README.md` for the docs
index · `docs/ONBOARDING.md` for the ordered developer path ·
`OPERATIONS_RUNBOOK.md` for on-call operations.
