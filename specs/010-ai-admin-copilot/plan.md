# Implementation Plan: AI Admin Copilot

**Branch**: `010-ai-admin-copilot` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-ai-admin-copilot/spec.md`

## Summary

Add an AI Admin Copilot panel to the SubNation admin dashboard that interprets natural-language commands, drafts catalog/inventory/pricing/role actions, renders structured before/after previews, and executes only after explicit human confirmation (with a 3-second-cooldown second-confirmation gate for high-risk classes). Wallet/balance/refund commands are draft+preview only — execute hands the admin off to the existing wallet admin tooling. Every executed action writes a rich, immutable copilot-action record and a parallel `audit_logs` row, both attributed to the approving admin. Implementation reuses every existing admin substrate (RBAC permissions array, argon2/2FA admin auth, Redis rate-limit middleware, audit log table, Drizzle schema as source of truth, api-zod + api-spec + api-client-react contract triple, Pino logging with redaction, Prometheus metrics) and adds three new Postgres tables (`copilot_previews`, `copilot_actions`, `copilot_action_items`). LLM intent parsing is structured-tool-use only — the model never emits free-text actions; the only mutations it can propose are calls to a typed, allow-listed tool catalog whose handlers route through the existing service-layer functions.

## Technical Context

**Language/Version**: TypeScript ~5.9, Node.js ≥ 22 (constitution §Stack & Deployment Shape).

**Primary Dependencies**: Express 5, Drizzle ORM, PostgreSQL (Neon), Redis (ioredis), Zod 4, React 19, Vite, Tailwind CSS, TanStack Query, wouter, Anthropic SDK (`@anthropic-ai/sdk`) for the LLM tool-use surface (Claude Sonnet 4.6 for intent + drafting; Claude Haiku 4.5 as a future cost-down option for read/explain). Pino for structured logging. `prom-client` for metrics. `argon2` and TOTP unchanged.

**Storage**: Three new Postgres tables in `shared/db/src/schema/`:

- `copilot_previews` — pending previews with 5-minute TTL (FR-PREVIEW-003).
- `copilot_actions` — immutable execution records (FR-AUDIT-001).
- `copilot_action_items` — per-item outcomes for bulk executes (FR-BULK-004).
  Plus one row per execute in the existing `audit_logs` table with `action="copilot.execute"` and `targetType="copilot_action"`, so existing admin audit views surface copilot work alongside other admin activity.

**Testing**: Vitest for unit + integration on backend (`backend/src/test`) and frontend (`frontend/src/test`). Concurrency tests for stale-preview races and double-execute prevention live in `backend/src/test/copilot/`. UI behavior tests for the second-confirm cooldown and keyboard-only flow live in `frontend/src/test/admin/copilot/`.

**Target Platform**: Web admin dashboard only — same Node process serving API + built React on `$PORT` (constitution §Stack & Deployment Shape). No mobile, no native, no separate copilot service.

**Project Type**: Web application (existing `backend/` + `frontend/` + `shared/` monorepo).

**Performance Goals**:

- Preview generation for a single-entity action ≤ 5s p95 (SC-006).
- Preview generation for a bulk action up to 500 rows ≤ 15s p95 (SC-007).
- Read/explain first-token latency ≤ 1s p95 (UX-comfort target; not in SC).
- Existing constitution gate: catalog + wallet read endpoints stay < 200ms p95; copilot endpoints are excluded from that gate (LLM-bound) but do not degrade other endpoints.

**Constraints**:

- Per-admin rate limit: 30 commands/min, 200 commands/hour, sliding windows, enforced in Redis (FR-SAFETY-004).
- Bulk row cap: 500 per single bulk operation (FR-BULK-003).
- Preview TTL: 5 minutes (FR-PREVIEW-003).
- Second-confirm cooldown: 3 seconds, server-enforced (FR-CONFIRM-002).
- Wallet/refund: copilot MUST NOT execute (FR-DATA-002 + Out of Scope).
- Defense in Depth (constitution §IV): all copilot endpoints behind `requireAdmin`, CSRF, the existing IP/user rate-limit tiers AND the new copilot-specific bucket. Logger redaction MUST treat any preview field that includes credential fields as sensitive.
- All copilot writes go through existing service functions (`backend/src/services/*`) so existing validation, ledger atomicity, and pricing rules apply unchanged.

**Scale/Scope**:

- Pilot: ≤10 admins for the first 14 days (matches SC-002, SC-010, SC-011 measurement windows).
- Steady-state: ≤50 admins total. With 30/min cap, peak system throughput is 1500 commands/min — well below current admin endpoint capacity.
- Catalog scale: ~10k products, ~100k inventory rows. Bulk previews against the full catalog are above the 500-row cap and refused at draft time.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Mapped against `.specify/memory/constitution.md` v1.0.0:

| Principle                                    | Status        | Evidence in plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Financial Integrity (NON-NEGOTIABLE)**  | ✅ Pass       | Copilot does NOT execute any money-mutating action (wallet/balance/refund/topup). FR-DATA-002 + Out of Scope make this explicit. Copilot drafts a preview and redirects the admin to existing wallet admin tooling — which already runs the existing transactional service (`refund.service.ts`, `adjustment.service.ts`, `topup.service.ts`, `payment.service.ts`). The constitution's transactional/atomic/audit-traceable invariants for money flows are unchanged because the copilot never touches them. Price/cost-price changes ARE writable but they are catalog metadata (`numeric(10,2)` already), not ledger entries; they remain subject to existing pricing-policy guards in `lib/pricing.ts`.                                                               |
| **II. Passwordless Customer Auth**           | ✅ Pass — N/A | Admin-only feature. Admin auth is the existing argon2 + TOTP 2FA + RBAC + 8h session — copilot reuses `requireAdmin` and the admin permission scopes (`inventory`, `orders`, `finance`, `users`, `admins`, `settings`, `all`). No customer-auth surface is added or modified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **III. Shared Contracts (API-First)**        | ✅ Pass       | All copilot endpoints add Zod schemas in `shared/api-zod/src/copilot/`, OpenAPI paths in `shared/api-spec/openapi.yaml`, regenerated React hooks in `shared/api-client-react/`, and Drizzle schema in `shared/db/src/schema/copilot_*.ts`. Contracts are the source of truth; no endpoint, no field, no type lives only on one side. Phase 1 produces the contract files.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **IV. Defense in Depth**                     | ✅ Pass       | Six independent layers: (1) `requireAdmin` (auth + isActive); (2) per-route `requirePermission` middleware mapping copilot intent to existing admin scopes; (3) existing IP-tier and user-tier Redis rate limits; (4) NEW per-admin copilot rate limit (30/min, 200/hour) in a separate Redis bucket; (5) preview TTL + record-version staleness check enforced server-side at execute; (6) confirmation rows are single-use and bound to `(admin_id, preview_id)` — replays rejected. Logger redaction extends to copilot fields that may contain credential text (`accountPassword` already covered; `metadata.before`/`metadata.after` for inventory rows added to the redaction allowlist).                                                                           |
| **V. Observability & Operational Readiness** | ✅ Pass       | New Pino logger context with `correlationId` per copilot session. New Prometheus counters `copilot_command_total{kind, outcome}`, `copilot_rate_limit_denials_total`, `copilot_safety_refusal_total{reason}`, `copilot_validation_rejection_total`; histograms `copilot_preview_seconds{kind}`, `copilot_execute_seconds{kind}`. `audit_logs` rows continue to power existing admin audit views; copilot-specific rich payload lives in `copilot_actions`/`copilot_action_items`. Sentry captures unhandled exceptions in copilot routes (existing global handler — no change). New schema migrations follow the constitution's idempotent + Redis-NX-locked pattern. Alerting: existing Discord webhook covers Sentry + alerting service; no new alerting channel added. |
| **§ Arabic-First (RTL) UX**                  | ✅ Pass       | Copilot UI authored Arabic-first. System prompt for the LLM responds in the admin's preferred locale. Suggested commands localized via existing i18n. RTL layout preserved (panel slides from the right in LTR, from the left in RTL — handled by existing layout token).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **§ Stack & Deployment Shape**               | ✅ Pass       | Single Node process, no new service, no Docker change, no deploy-shape change. Anthropic API calls are outbound HTTPS from the web tier. `ANTHROPIC_API_KEY` is added to `config/env.example` with fail-fast validation at boot. Cron jobs (preview-row reaper, every 5 minutes) live on the `subnation-worker` tier per the constitution's scheduling rule; the web tier MUST NOT run the reaper.                                                                                                                                                                                                                                                                                                                                                                        |

**Result**: All gates pass without justifying any complexity exceptions. No entry needed in Complexity Tracking.

### Post-design re-check (after Phase 1 artifacts written)

After producing `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`:

| Principle                                    | Re-check verdict                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Financial Integrity**                   | ✅ Holds. `data-model.md` confirms zero copilot writes to `wallet_ledger` / `wallet_topups`; the `draft_wallet_action` tool produces `risk_tier="no_execute"` previews and both confirm endpoints return 403 with a handoff URL (see `openapi.copilot.yaml`).                               |
| **II. Passwordless Customer Auth**           | ✅ N/A. No customer-auth surface added; `requireAdmin` reused.                                                                                                                                                                                                                              |
| **III. Shared Contracts (API-First)**        | ✅ Holds. `contracts/openapi.copilot.yaml` is the single source of truth; `data-model.md` §1 maps directly to forthcoming Drizzle schema; tool argument schemas are shared between `shared/api-zod/src/copilot/tools/*` and the LLM tool catalog.                                           |
| **IV. Defense in Depth**                     | ✅ Holds. Six layers (auth, scope, IP rate-limit, user rate-limit, copilot rate-limit, preview TTL + version + single-use) are each present in distinct files in the project structure tree.                                                                                                |
| **V. Observability & Operational Readiness** | ✅ Holds. `research.md` R-13 enumerates Prometheus counters/histograms; `data-model.md` §5 enumerates the daily reconciliation queries; `quickstart.md` §6 gives the operating shortcuts. Reaper job (R-15) is documented to run on the worker tier per the constitution's scheduling rule. |
| **§ Arabic-First (RTL) UX**                  | ✅ Holds. Frontend layout (R-11) and system-prompt locale handling (R-12) cover Arabic-first + RTL.                                                                                                                                                                                         |
| **§ Stack & Deployment Shape**               | ✅ Holds. Single Node process; one new env var (`ANTHROPIC_API_KEY`); no deploy-shape change; reaper on existing worker tier.                                                                                                                                                               |

**Re-check result**: All gates still pass. Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-ai-admin-copilot/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── README.md
│   ├── openapi.copilot.yaml
│   └── tool-catalog.md
├── checklists/
│   └── requirements.md  # produced by /speckit-specify, kept current
└── tasks.md             # /speckit-tasks output (NOT created by this command)
```

### Source Code (repository root)

```text
backend/src/
├── routes/admin/copilot/        # NEW — HTTP surface for copilot
│   ├── index.ts                 #   mounts: /api/admin/copilot/*
│   ├── ask.ts                   #   POST /ask           (Phase 1, SSE stream)
│   ├── draft.ts                 #   POST /draft         (Phase 2)
│   ├── previews.ts              #   GET /previews/:id   (Phase 2)
│   ├── confirm.ts               #   POST /previews/:id/confirm        (Phase 3, low-risk)
│   ├── double-confirm.ts        #   POST /previews/:id/double-confirm (Phase 3, high-risk)
│   └── history.ts               #   GET /history       (Phase 1+, paged audit view)
├── services/copilot/            # NEW — copilot-only logic, NEVER bypasses existing services
│   ├── llm.client.ts            #   thin wrapper around Anthropic SDK with tool-use
│   ├── system-prompt.ts         #   built from per-admin permission scopes
│   ├── tool-catalog.ts          #   the typed allow-list of tools the LLM may call
│   ├── tools/
│   │   ├── read.tools.ts        #   read-only tools (Phase 1)
│   │   ├── catalog.tools.ts     #   draft + execute for catalog content
│   │   ├── pricing.tools.ts     #   draft + execute for price/cost-price (high-risk)
│   │   ├── inventory.tools.ts   #   draft + execute for stock (high-risk)
│   │   ├── status.tools.ts      #   draft + execute for publish/archive (high-risk)
│   │   ├── bulk.tools.ts        #   draft + execute for any bulk variant (high-risk, ≤500 rows)
│   │   ├── permissions.tools.ts #   draft + execute for admin role/permission (high-risk)
│   │   └── wallet.tools.ts      #   draft ONLY; execute throws -> handoff URL
│   ├── validator.ts             #   schema + business-rule validation BEFORE preview is shown
│   ├── preview.store.ts         #   create/get/expire previews (Postgres); 5-min TTL
│   ├── confirmation.ts          #   single-use confirmation rows; cooldown clock
│   ├── executor.ts              #   single + bulk execute paths; per-item result capture
│   ├── anomalies/               #   fixed-catalog heuristics for US7
│   │   ├── loss-making-price.ts
│   │   ├── refund-cluster.ts
│   │   ├── stock-spike.ts
│   │   └── discount-ratio.ts
│   └── audit.ts                 #   writes copilot_actions + audit_logs row in one tx
├── lib/copilot/
│   ├── rate-limit.ts            #   30/min + 200/hour Redis sliding-window bucket
│   ├── redaction.ts             #   extends Pino redaction for copilot payloads
│   └── ids.ts                   #   short, URL-safe IDs for previews/confirmations
├── jobs/copilot-reaper.ts       #   NEW — cron, every 5 minutes on the WORKER tier only
└── test/copilot/                #   NEW — concurrency, staleness, replay, redaction tests

frontend/src/
├── pages/admin/
│   └── layout.tsx               #   MODIFY — mount the slide-out copilot panel
└── components/admin/copilot/    # NEW
    ├── CopilotPanel.tsx         #   slide-out container, RTL-aware
    ├── CommandInput.tsx         #   natural-language input, Ctrl/Cmd+K opens
    ├── SuggestedCommands.tsx    #   context-aware, scoped by permissions
    ├── RecentActions.tsx        #   the admin's last N copilot actions
    ├── PreviewCard.tsx          #   structured before/after diff
    ├── BulkPreviewCard.tsx      #   count + sample + aggregate impact
    ├── ConfirmDialog.tsx        #   single-confirm
    ├── DoubleConfirmDialog.tsx  #   second-confirm with 3s cooldown countdown
    ├── ResultPanel.tsx          #   success/failure feedback with audit link
    ├── HistoryView.tsx          #   filterable history (admin/time/class/outcome)
    └── api.ts                   #   uses generated hooks from shared/api-client-react

shared/
├── db/src/schema/
│   ├── copilot_previews.ts          # NEW
│   ├── copilot_actions.ts           # NEW
│   ├── copilot_action_items.ts      # NEW
│   └── index.ts                     # MODIFY — re-exports the three new tables
├── api-zod/src/copilot/
│   ├── ask.ts                       # NEW — request/response schemas for /ask
│   ├── draft.ts                     # NEW
│   ├── preview.ts                   # NEW
│   ├── confirm.ts                   # NEW
│   ├── history.ts                   # NEW
│   └── index.ts                     # NEW
├── api-spec/openapi.yaml            # MODIFY — append /api/admin/copilot/* paths
└── api-client-react/                # REGENERATED via existing orval pipeline

config/env.example                   # MODIFY — add ANTHROPIC_API_KEY (required in prod)
```

**Structure Decision**: Web application — existing `backend/` + `frontend/` + `shared/` monorepo (constitution §Stack & Deployment Shape). The copilot is a vertical slice across all three workspaces: schema in `shared/db`, contracts in `shared/api-zod` + `shared/api-spec`, hooks in `shared/api-client-react`, route handlers in `backend/src/routes/admin/copilot/`, services in `backend/src/services/copilot/`, UI in `frontend/src/components/admin/copilot/` + a layout mount in `frontend/src/pages/admin/layout.tsx`. The reaper cron runs on the existing `subnation-worker` tier per the constitution's scheduling rule.

## Complexity Tracking

> No constitution gate violations. This section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| _(none)_  | _(none)_   | _(none)_                             |
