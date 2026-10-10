# SubNation — Developer Onboarding

> Status: CURRENT @ 2026-10-10 (R128). The ordered path for a new developer:
> read top-to-bottom, ~30 minutes of reading before the first commit. The
> docs front door (buckets, house rules) is [`docs/README.md`](./README.md);
> this page is the developer journey through it.

## 1. The repo map (5 minutes)

A **pnpm monorepo** (`pnpm` is enforced — npm/yarn installs fail fast):

| Path | What lives there |
|---|---|
| `backend/` | Express 5 API — routes, services, jobs, middlewares, idempotent boot migrations (`src/migrate.ts`) |
| `frontend/` | Vite + React 19 SPA (Arabic RTL) — pages, components, hooks; vitest suites + Playwright e2e (`e2e/`) |
| `shared/db` | Drizzle schema + SQL migration mirror |
| `shared/api-spec` | The OpenAPI contract (`openapi.yaml`) — the source of the generated clients |
| `shared/api-zod` · `shared/api-client-react` | **orval-generated** from the spec (committed; drift-gated in CI) |
| `docs/` | 4-bucket docs tree (CURRENT / HISTORY / DEPRECATED / PENDING) + `inspection-r###/` round reports |
| `specs/` | Dated spec-driven working directories (spec / plan / priorities / checklists) |
| `config/` · `deploy/` · `scripts/` | `env.example` reference · compose contract · local orchestration (dev, seed, backup) |

Repo root: `README.md` (product + quickstart) · `OPERATIONS_RUNBOOK.md`
(on-call) · `CHANGELOG.md` (round ledger) · `.hermes.md` (agent guidance —
source-of-truth hierarchy + non-negotiables).

## 2. Setup (10 minutes)

Node.js **22+**, pnpm **10+**, any PostgreSQL:

```bash
pnpm install
cp config/env.example .env      # edit DATABASE_URL
pnpm run dev                    # boot migrations create/update the schema
pnpm run db:seed                # default admin + sample products (idempotent)
```

No Postgres handy? The README's *Local PostgreSQL* section has a one-command
Docker recipe. Redis is optional in development (in-process fallbacks).
The guest-only Playwright smoke needs a running stack:
`pnpm --filter @workspace/subnation run test:e2e`.

## 3. The law docs — read these BEFORE your first change (10 minutes)

1. **[`docs/FINAL_MONEY_INVARIANTS.md`](./FINAL_MONEY_INVARIANTS.md)** —
   M1–M17 are law: single-transaction checkout, no negative balance,
   idempotent top-up, `payment_reference` guard on `mobile_transfer`,
   single-writer inventory, domain events after commit. Any change near
   wallet/orders/refunds/loyalty requires the money suite green.
2. **The no-`db:push` rule** — schema changes flow exclusively through the
   idempotent boot migrations (`backend/src/migrate.ts`); there is no
   `db:push` step in any workflow, and the script **must never be run
   against production** (it can drop production-only tables —
   `docs/history/deep-audit-2026-09-06.md`). Regenerate Drizzle migrations
   after schema edits so the CI drift gate stays green.
3. **The orval workflow** — API changes start in
   `shared/api-spec/openapi.yaml`; then run
   `pnpm --filter @workspace/api-spec run codegen` and commit the
   regenerated `shared/api-zod` + `shared/api-client-react`. CI fails on
   orval drift, exactly as it fails on Drizzle migration drift and
   OpenAPI↔Express route drift. Never hand-edit generated code.

Also binding (from `.hermes.md` non-negotiables): deploys are operator-owned
— the live stack's push-to-deploy (Coolify webhook on `main`) is the one
sanctioned pipeline, and any other deployment/restart/DNS/production-data
action is an explicit operator-ordered step; never expose secrets (gitleaks
scans every push).

## 4. Frontend conventions (the short version)

- **Arabic-first, RTL** — copy is Arabic by default; layout must work
  right-to-left (see the existing RTL tests, e.g.
  `frontend/src/components/__tests__/switch-rtl.test.tsx`).
- **Same-origin SPA** — the backend serves the built frontend; the browser
  uses relative `/api` paths and same-origin WebSockets.
- Data fetching goes through the generated client hooks
  (`shared/api-client-react`) — if a hook is missing, the answer is
  "edit the spec", not "hand-write a fetch".

## 5. The gates (run before every PR — CI runs them on every code push;
docs-only pushes skip the heavy jobs via ci.yml's path filter)

```bash
pnpm lint
pnpm typecheck
pnpm --filter @workspace/api-server exec vitest run      # backend suite
pnpm --filter @workspace/subnation run test:run          # frontend suite
pnpm build                                               # includes the bundle budget gate
```

CI (`.github/workflows/ci.yml`) additionally runs: gitleaks secret scan,
OpenAPI↔Express route parity, Drizzle migration drift, orval drift, CVE
scan on prod deps, the impeccable UI-anti-pattern gate, and the production
build. Current suite sizes live in the README's *Tests* section (verified
each round).

## 6. Where rounds are recorded

This repo ships by **round** (no semver), and every round leaves an
evidence trail:

- [`CHANGELOG.md`](../CHANGELOG.md) — one entry per round, newest first:
  changes + measured evidence + gates run on the merged tree.
- `docs/inspection-r###/` — the round's audit reports (A1–A12 style), one
  file per auditor.
- `docs/project-plan/10-progress-log.md` — the append-only progress ledger.
- `docs/README.md` — round records + the pointer hierarchy of record:
  this index → `docs/project-state/source-of-truth.md` (current live
  state) → `docs/architecture/FINAL_*` (topology).

Conventional commits carry the round tag: `fix(backend): … (R126)`.
Claimed behavior in docs/PRs is evidence-stamped (file:line, command
output, live probe) — "should pass" is not evidence.

## 7. When you're stuck

- **Product/stack questions** → `README.md` (pitch, quickstart, perf
  record link).
- **"Is this claim current?"** → `docs/README.md` bucket status →
  `docs/project-state/source-of-truth.md`.
- **Incident/on-call** → `OPERATIONS_RUNBOOK.md` §2 →
  `docs/DISASTER_RECOVERY.md`.
- **Contributing flow** (PRs, issue templates, security reporting) →
  [`CONTRIBUTING.md`](../CONTRIBUTING.md) + [`SECURITY.md`](../SECURITY.md).
