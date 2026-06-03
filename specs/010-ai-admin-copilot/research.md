# Phase 0 Research: AI Admin Copilot

**Feature**: 010-ai-admin-copilot
**Date**: 2026-06-03
**Status**: Complete — all decisions resolved before Phase 1

---

## Scope of this document

The spec already locks the user-visible numbers and policies (bulk cap, preview TTL, rate limits, second-confirm pattern, wallet no-execute). This document captures the **engineering decisions** that bridge the spec to the codebase: model choice, tool-use shape, schema strategy, rate-limit storage, staleness mechanism, anomaly heuristics, and rollout plumbing. Each entry is **Decision → Rationale → Alternatives considered**.

---

## R-1. LLM provider and model

**Decision**: Anthropic API. Claude **Sonnet 4.6** (`claude-sonnet-4-6`) for intent parsing, action drafting, and bulk preview synthesis. **Haiku 4.5** (`claude-haiku-4-5-20251001`) reserved for read/explain (US1) once Phase 1 is operating to drop cost; not enabled at first launch.

**Rationale**:

- Tool-use is mandatory for the safety pipeline (R-2). Anthropic's tool-use is mature, supports forced tool calls, and is documented in the SDK we will use (`@anthropic-ai/sdk`).
- Sonnet 4.6 is the project's default for "build AI applications" (system note `claude-sonnet-4-6`); using it keeps the copilot consistent with other AI features in the SubNation roadmap.
- Haiku 4.5 cost is ~5× cheaper than Sonnet — economically meaningful for read/explain where most queries are short. Switching the read/explain path to Haiku is a one-line model-id change once SC-002 acceptance baselines are clear.
- Prompt caching is supported on both models — the system prompt + tool catalog + per-admin permission summary will be cache-marked so repeated commands within a 5-minute window cost ~10% of a cold call (SC-006/SC-007 budget headroom).

**Alternatives considered**:

- _OpenAI / GPT_: function-calling is comparable, but the project has no existing OpenAI integration and adding a second provider adds key management, error handling, and observability surface.
- _Self-hosted open-weight model_: latency and ops cost (GPU inference, model swapping, tool-use quality) outweigh savings at our pilot scale (≤10 admins).
- _Sonnet for everything_: cheaper to start but locks us out of an obvious cost-down lever once read/explain volume proves out.

---

## R-2. Tool-use as the only mutation surface

**Decision**: The model NEVER emits free-text "do X". The model receives a **typed tool catalog** and the only way to propose a write is to call a tool with a JSON argument that matches the tool's Zod schema. Tools fall into three classes:

1. **Read tools** (Phase 1, US1, US7): `search_products`, `get_product`, `list_low_stock`, `summarize_recent_changes`, `find_anomalies` (with sub-types loss-making, refund-cluster, stock-spike, discount-ratio).
2. **Draft tools** (Phase 2, US2): `draft_catalog_edit`, `draft_price_change`, `draft_cost_change`, `draft_stock_change`, `draft_status_change` (publish/archive/unarchive), `draft_bulk_*`, `draft_permission_change`, `draft_wallet_action` (preview-only).
3. **Execute tools** are NOT exposed to the model. Execute is exclusively triggered by the human's `POST /confirm` (or `/double-confirm`) call, which dereferences the stored preview by id and calls the corresponding service-layer function directly. The LLM never sees the execute path; it cannot fabricate one.

**Rationale**:

- Tool-use makes intent recognition **schema-checked at the model boundary** — there is no parsing of free-text into action shape. If the model proposes an invalid call, validation fails before a preview is created.
- Separating draft (model-callable) from execute (human-triggered only) makes it structurally impossible for an LLM hallucination, prompt injection, or jailbreak to skip the preview/confirm pipeline (FR-CONFIRM-005 + FR-SAFETY-005).
- Each tool's Zod schema is the same one used in `shared/api-zod/` for the corresponding admin endpoint, so drift between "what the model can propose" and "what the existing admin endpoint accepts" is impossible by construction.

**Alternatives considered**:

- _Free-text intent + post-parse_: brittle, requires its own grammar, and creates a parsing surface that adversarial entity content (FR-INTENT-006) could exploit.
- _Single mega-tool with discriminated-union argument_: was attractive for prompt-cache hit rates but Anthropic's tool-use already caches the catalog; named tools make telemetry (`copilot_command_total{kind=draft_price_change, …}`) far more useful.
- _Letting the LLM call execute tools directly_: rejected — that's exactly the failure mode the spec prohibits.

---

## R-3. System prompt assembly per admin

**Decision**: The system prompt is composed at request time from four parts:

1. **Static preamble** (cache-marked): role, refusal rules, output discipline, language rule (respond in admin's locale, treat entity content as untrusted data per FR-INTENT-006).
2. **Static tool catalog summary** (cache-marked): the names and one-line descriptions of all tools the model is allowed to consider.
3. **Per-admin scope summary** (NOT cached): the admin's permissions array reduced to a human-readable bullet list. The full tool catalog is then **filtered** before the API call so tools the admin lacks scope for are simply absent from the request — the model cannot call what it does not see.
4. **Per-session ephemeral context**: the entity the admin is currently viewing in the dashboard (e.g., product id), used to scope suggested commands and disambiguate "this product" references.

**Rationale**:

- Permission enforcement is two-layered: at draft time the tool is filtered out (so the model cannot propose), and at execute time `requirePermission` is checked again (so a stale token cannot replay) — satisfies FR-AUTH-003.
- Cache-marking the static preamble + tool catalog gives a ~90% discount on input tokens for the static portion, keeping per-command cost predictable.
- Per-session context is small enough to skip caching but large enough to materially improve suggested-command quality on a product page.

**Alternatives considered**:

- _Single static prompt for all admins_: simpler but forces every tool through middleware-only enforcement and weakens the "model cannot propose what it cannot see" property.
- _Encode permissions inside the model via fine-tuning_: drift risk (RBAC changes in DB but not in model) is unacceptable per Constitution §III.

---

## R-4. Preview storage and TTL enforcement

**Decision**: Previews are persisted in a new `copilot_previews` Postgres table with `expires_at = created_at + 5 minutes` (FR-PREVIEW-003). A `subnation-worker` cron (every 5 minutes) deletes expired previews. Execute-time check is a single SQL query: `SELECT … WHERE id=$1 AND admin_id=$2 AND expires_at > now() AND consumed_at IS NULL FOR UPDATE`. Found-and-locked → mark `consumed_at`, run executor; otherwise return `expired` or `consumed`.

**Rationale**:

- Postgres source-of-truth makes the freshness check authoritative and race-safe (`FOR UPDATE`).
- 5-minute TTL puts the row reaper on the worker tier (constitution §V scheduling rule). Web tier MUST run with `DISABLE_WEB_SCHEDULERS=true` per existing convention.
- `consumed_at` makes confirmations single-use (FR-CONFIRM-004) without needing a separate confirmations table.

**Alternatives considered**:

- _Redis-only previews_ with TTL: faster but loses durability across deploys, makes the audit story harder (we want previews recoverable for incident review even if execute never happens).
- _No TTL, only staleness check_: leaves abandoned previews indefinitely, creates a slow-leak storage problem and a bigger replay surface.

---

## R-5. Record-version staleness check

**Decision**: For each affected entity in a preview, capture `(entity_type, id, updated_at)` at draft time. At execute time, re-read the entity and verify `updated_at` is unchanged. If any entity's `updated_at` has advanced, abort the execute with a `STALE` outcome and offer the admin a re-draft.

**Rationale**:

- The existing `productsTable` has `updatedAt` (verified). We need to ensure every other writable entity does too — see R-7 for the audit.
- `updated_at` is sufficient — we do not need a separate `version` column. Postgres' `now()` clock is monotonic per row and updated by Drizzle on every write that we control.
- Staleness check is in the same transaction as `consumed_at` and the actual write, giving us serialized read-write semantics without explicit advisory locks.

**Alternatives considered**:

- _Optimistic version column_: cleaner semantically but requires schema migrations on every writable table.
- _Hash of all relevant fields_: protects against an `updated_at` that didn't actually change the relevant field; rejected as over-engineering for this milestone.

---

## R-6. Rate limit: per-admin sliding window in Redis

**Decision**: Two Redis sorted-set sliding windows per admin: `copilot:rl:1m:<adminId>` (60s window, 30 max) and `copilot:rl:1h:<adminId>` (3600s window, 200 max). Implemented as a tiny Lua script (atomic ZREMRANGEBYSCORE + ZCARD + ZADD) so the window decision is race-free under concurrent requests. Counter applies to all `/ask`, `/draft`, `/confirm`, `/double-confirm` endpoints (FR-SAFETY-004 says draft + preview + execute combined). Denials emit a Pino log line + `audit_logs` row + Prometheus counter increment, then return `429 Too Many Requests` with `Retry-After`.

**Rationale**:

- Sliding-window via sorted-set is the standard Redis pattern; matches the existing rate-limit middleware style.
- Two windows (minute + hour) catch both bursty bypass attempts and slow-and-low credential-abuse patterns.
- The constitution's existing IP/user rate-limit tiers stay in front of this; the per-admin copilot limit is an inner gate, not a replacement.

**Alternatives considered**:

- _Token bucket_: equally fine but harder to reason about with two distinct windows; sorted-set is also already proven in this codebase.
- _Per-tool quotas_ (e.g. 10 bulks/hour): defer; not in spec, premature complexity.

---

## R-7. Writable-entity audit for `updated_at` coverage

**Decision**: Before Phase 3 enable, verify every writable entity touched by FR-DATA-002 has an `updated_at` column or equivalent monotonic field. The entities are: `products` (✅ confirmed), `inventory` (⚠ needs check), `admin_users` (⚠ needs check). The `tasks.md` plan will include explicit verification tasks; if any is missing, add a migration that introduces `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` plus a Drizzle hook for `onUpdate`.

**Rationale**: Staleness check (R-5) requires this column on every writable entity. We document the audit so it is not silently skipped.

**Alternatives considered**: same as R-5 alternatives.

---

## R-8. Audit log strategy: `copilot_actions` table + `audit_logs` row

**Decision**: Two coordinated rows per executed action, written in one transaction:

1. **`copilot_actions`** (NEW) — full provenance: admin, original natural-language intent, interpreted action plan, action class, before-state snapshot, after-state snapshot, single-confirm timestamp, double-confirm timestamp (nullable), outcome, failure reason. For bulk: a parent row plus N `copilot_action_items` rows for per-item outcomes.
2. **`audit_logs`** (existing) — one summary row per copilot execute with `action="copilot.execute"`, `actor_type="admin"`, `target_type="copilot_action"`, `target_id=<copilot_actions.id>`. This is what the existing admin audit views read.

Refusals/cancellations/validation rejections are logged to `copilot_actions` with `outcome` set accordingly but DO NOT add to `audit_logs` — FR-AUDIT-002 requires recording them but the existing audit log is for executed admin actions; copilot-specific audit views read directly from `copilot_actions`.

**Rationale**:

- `audit_logs` exists and powers existing UIs (Constitution §I + §V); extending it is the path of least surprise.
- `copilot_actions` carries the rich payload (intent text, plan JSON, before/after JSONB) without bloating `audit_logs.metadata` text.
- Single transaction means it is impossible to have an executed write without its audit pair (SC-003: 100% audit coverage).

**Alternatives considered**:

- _Reuse `audit_logs.metadata` for the rich payload_: technically possible (it is `text`) but defeats the schema-typed indexability we want for filtering history by class/outcome.
- _Separate write path that fires after the execute_: rejected — non-atomic, possible silent drop on partial failure.

---

## R-9. Bulk preview generation and execute

**Decision**:

- **Preview**: compute the affected set with a normal SQL query, count the rows. If count > 500, refuse at draft time (FR-BULK-003). Otherwise: store the full id list in `copilot_previews.affected_ids` (JSONB int[]); render a sample of up to 20 representative rows into `preview_payload.sample`; compute aggregate impact (e.g., total margin delta for price changes) by aggregating in-memory over the preview's id list.
- **Execute**: iterate the stored `affected_ids` in batches of 50 inside one transaction with `SAVEPOINT` per batch — per-item failures roll back the batch only and produce a `copilot_action_items` row with the failure reason; the rest continues. Outcome is `success | partial | failure` based on per-item count.

**Rationale**:

- 500 cap × 50/batch = at most 10 batches per execute; well within Postgres + Drizzle transaction limits.
- SAVEPOINT-per-batch matches FR-EXECUTE-003 (no silent partial state) and FR-BULK-004 (per-item outcomes).
- Aggregate impact computed at preview-time means the second-confirm dialog can show "saves you $1,243 in margin" without a second pass.

**Alternatives considered**:

- _One transaction, all-or-nothing_: harsher UX for admins (partial bulk should not fail wholesale).
- _Fully parallel item executes_: parallelism gain not worth the per-item ordering loss for ≤500 rows; sequential batches are simpler and predictable.

---

## R-10. Anomaly heuristics for US7

**Decision**: Four fixed heuristic checks, each a pure function over current data, none using the LLM:

| Heuristic           | Definition                                                                              | Source                                     |
| ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `loss-making-price` | `products.price < products.cost_price * 0.95` (5% margin floor)                         | `productsTable`                            |
| `refund-cluster`    | ≥ 3 refunds against one user in the last 24 hours                                       | `wallet_ledger` rows where `kind='refund'` |
| `stock-spike`       | inventory delta > 5× the rolling 7-day average for that product                         | `inventoryTable` count over time           |
| `discount-ratio`    | active flash-sale discount > 50% on a product whose 30-day median price has not changed | `flash_sales` + `productsTable`            |

The LLM's role for "any unusual activity?" is to call `find_anomalies(kind=…)` and **summarize** the rows the heuristic returns, never to decide what counts as an anomaly. Heuristic thresholds are constants in `services/copilot/anomalies/` so they can be tuned without retraining anything.

**Rationale**:

- Deterministic heuristics are auditable and explainable; the spec's "no fabrication" rule (FR-INTENT-003) forbids the model from inventing anomalies.
- Each check maps to existing tables — no new schema for anomalies.
- The four are a starting set; the file structure makes adding more (or A/B testing thresholds) trivial.

**Alternatives considered**:

- _Use the LLM directly to detect anomalies_: rejected — non-deterministic and the spec forbids fabrication.
- _Prebuilt anomaly-detection feature flag from spec 003_: feature 003 is "anomaly-detection" already on this repo; if its outputs become reliable they can replace these heuristics in a follow-up — but we do not couple to it now to keep this milestone independent.

---

## R-11. Frontend integration with admin layout

**Decision**: The copilot is a **right-side slide-out panel** mounted in `frontend/src/pages/admin/layout.tsx`, opened by Ctrl/Cmd+K or by a fixed-position floating button. Suggested commands are derived from the current admin route (e.g., on `/admin/products/:id`, the panel pre-loads "update price", "add FAQ", "publish draft"). All copilot interactions go through TanStack Query hooks generated from `shared/api-spec` via the existing orval pipeline.

**Rationale**:

- Slide-out (rather than full page) keeps admins in context — matches FR-UX-001 ("dedicated panel or command surface" inside the dashboard).
- Ctrl/Cmd+K is the universal command-palette convention; pairing with a visible floating button keeps it discoverable.
- Reusing the existing orval-generated hooks keeps Constitution §III (API-first, single source of truth) intact.

**Alternatives considered**:

- _Dedicated `/admin/copilot` page_: too far from the work admins are doing; rejected.
- _Always-visible inline strip at top_: noisy and steals vertical space.

---

## R-12. RTL and Arabic-first behavior

**Decision**:

- Panel slides from the appropriate side based on `document.dir` (right in LTR, left in RTL).
- All copilot UI strings live in the existing i18n bundle, Arabic first.
- The system prompt instructs the model to respond in the admin's preferred locale; the locale is read from the existing admin user setting.
- Diff rendering in `PreviewCard` uses the existing direction-aware diff component; no new RTL-specific code path.

**Rationale**: Constitution §Arabic-First (RTL) UX is a release blocker; English-only copilot would block Phase 1.

**Alternatives considered**: none reasonable.

---

## R-13. Observability instrumentation

**Decision**:

- **Logging**: Pino structured logs with `correlationId` per copilot session (existing pattern from `middlewares/correlation.ts`). New logger field `copilot.preview_id` and `copilot.action_id` for join-friendly tracing.
- **Metrics** (`prom-client`):
  - Counter: `copilot_command_total{kind, outcome}` — every drafted command, labeled by tool name and outcome (`drafted | confirmed | executed | failed | refused | rate_limited | stale | expired`).
  - Counter: `copilot_safety_refusal_total{reason}` — `out_of_scope | hallucinated_field | rule_violation | secret_leak_attempted`.
  - Histogram: `copilot_preview_seconds{kind}` and `copilot_execute_seconds{kind}`.
  - Histogram: `copilot_llm_input_tokens` and `copilot_llm_output_tokens` for cost tracking.
- **Sentry**: existing global handler captures unhandled exceptions in copilot routes. No new Sentry config.
- **Audit reconciliation**: a daily worker job compares `copilot_actions` execute count against `audit_logs` rows with `target_type="copilot_action"`; any drift fires the existing alerting webhook (SC-003 enforcement).

**Rationale**: Mirrors the constitution's §V observability requirements; reuses existing infrastructure.

**Alternatives considered**: none — this is the standard pattern in the project.

---

## R-14. Secret/PII redaction for copilot payloads

**Decision**: Extend the existing Pino redaction list to include:

- `*.metadata.before.accountPassword` and `*.metadata.after.accountPassword` (for inventory previews — already partially covered by the existing `accountPassword` rule, but explicit nested paths defend in depth).
- `*.preview_payload.before.accountPassword` and `.after.accountPassword`.
- `*.intent_text` is **not** redacted — admins type their own commands and we want them in audit; if an admin pastes a password into a command, the secret-scan check (next bullet) catches it.

The copilot also runs an outbound content scan on every model response and on every preview payload before storing/returning: a regex pack catching obvious credential shapes (Postgres URLs, AWS keys, Bearer tokens, password-pattern fields) plus the existing inventory-credential field names. Matches abort the response with a `secret_leak_attempted` refusal logged.

**Rationale**: SC-008 requires zero secret-leak instances; defense-in-depth means scanning at output time, not just trusting input filtering.

**Alternatives considered**:

- _Trust the model not to emit secrets_: insufficient for SC-008.
- _Scan only at log-time (Pino redaction)_: catches the audit story but misses what is actually returned to the admin's screen — the leak target.

---

## R-15. Phased rollout switches

**Decision**: Three boolean flags in `admin_settings` (existing or new column), backed by env defaults:

- `copilot_phase1_enabled` (read/explain) — defaults true in staging, **false** in prod at first release.
- `copilot_phase2_enabled` (draft + preview, no execute) — defaults false; flip after Phase 1 stability data.
- `copilot_phase3_enabled` (execute) — defaults false; flip after Phase 2 calibration.
- `copilot_phase3_high_risk_enabled` (sub-flag) — defaults false; allows Phase 3 to ship with low-risk catalog edits only while keeping price/stock/publish/archive/permission/bulk classes preview-only (FR-ROLLOUT-003).

The flags are checked in the `requirePhase` middleware on copilot routes; flipping a flag is itself an admin-permissions-protected action and is audited.

**Rationale**: FR-ROLLOUT-001/002/003 require independently deployable, reversible phases. Setting flags rather than gating in code keeps redeploy off the critical path.

**Alternatives considered**:

- _Code-level feature gates with deploys_: slower turnaround, riskier rollback.
- _Per-admin opt-in_: nice-to-have for the pilot; can layer on top later.

---

## Open follow-ups (deferred to /speckit-tasks)

- Confirm `inventoryTable` and `admin_users` have `updated_at` (R-7).
- Confirm the existing `audit_logs.actor_id` int field can store `admin_users.id` (it does — `admin_users.id` is `serial` int4).
- Decide the exact flash-sale threshold for `discount-ratio` heuristic (currently 50%).
- Pick a UI library or build for the diff renderer; `react-diff-view` or a hand-rolled token-level diff are both viable.
- Decide retention of `copilot_previews` for refused/expired rows (current plan: reaper deletes after TTL+24h; refused are kept for 30 days then archived).
