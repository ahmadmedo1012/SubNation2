# Feature Specification: Arabic Catalog Content Enrichment

**Feature Branch**: `012-arabic-catalog-enrichment`

**Created**: 2026-06-04

**Status**: Draft

**Input**: AI Opportunity Assessment §7.3 / opportunity O2 — operator-facing, off-peak batched LLM work that fills missing product descriptions, long-form descriptions, and FAQ entries. Goal: close the catalog data-quality gap PROJECT_OVERVIEW §8 flagged, improve SEO and conversion, with admin-in-the-loop review on every output.

---

## User Scenarios & Testing _(mandatory)_

> All "users" in this spec are SubNation operators (the founder + core admins). The customer surface is intentionally untouched by the LLM — customers see only the content the admin explicitly approves and publishes via the existing product-edit flow. No "AI-generated" badge, no real-time inference on the storefront.

### User Story 1 — Admin reviews and approves a draft (Priority: P1) 🎯 MVP

An admin opens the catalog enrichment panel at `/admin/products/enrichment`. The page lists products with pending LLM-drafted content (missing or thin descriptions, missing FAQ). For each row, a side-by-side preview shows the current product state and the proposed draft. The admin clicks "تطبيق" (apply) on a draft they like; the product is updated through the existing low-risk catalog-edit path; the draft is marked `published`. They click "تعديل" (edit) to tune copy before publishing. They click "رفض" (reject) on a draft that is poorly worded; the row is marked `rejected` and the cron will not re-draft that field for 14 days.

**Why this priority**: The whole feature exists to clear the data-quality backlog. Without an approval surface, drafts accumulate without ever reaching customers. MVP = an admin can take one draft from "drafted" to "published" without touching SQL.

**Independent Test**: Seed 3 products with NULL `description_long`. Run the enrichment cron once. Open the panel; verify 3 rows appear with side-by-side previews. Click "تطبيق" on row 1 → the product's `description_long` becomes the draft text, the `enrichment_drafts` row's `state` becomes `published`. Click "رفض" on row 2 → state becomes `rejected`. Row 3 remains `drafted`.

**Acceptance Scenarios**:

1. **Given** the enrichment cron has produced drafts, **When** an admin opens the panel, **Then** they see the list of `state='drafted'` rows ordered by product creation date descending, with current-state ↔ proposed-state side-by-side rendering.
2. **Given** an admin clicks "تطبيق", **When** the apply succeeds, **Then** the product field is updated through the existing service-layer write path (no direct table mutation), an `audit_logs` row records the admin id + product id + field name, and the draft state becomes `published` with `published_at` stamped.
3. **Given** an admin edits a draft before publishing, **When** they save, **Then** the edited text — not the original LLM output — is what writes to the product, and the draft row records both the original LLM text (`generated_text`) and the admin's edit (`final_text`) for audit.
4. **Given** an admin rejects a draft, **When** they confirm, **Then** the row's state becomes `rejected` and the cron's 14-day suppression window (`rejected_at + 14 days`) prevents re-drafting that product+field combination until that date has passed.
5. **Given** an admin lacks the `inventory` permission scope, **When** they navigate to `/admin/products/enrichment`, **Then** the route returns 403 — same gate the existing product-edit pages use.

---

### User Story 2 — Cron drafts content off-peak (Priority: P1)

A daily worker-tier cron (`enrichment-runner`) selects products that need enrichment — missing `description_long`, missing or empty `faq`, or thin `description` (< 50 characters) — and generates an LLM draft for the missing field. Drafts land in `enrichment_drafts` with `state='drafted'`. The cron NEVER mutates the live `products` table.

**Why this priority**: Without the runner there are no drafts. P1 because the panel (US1) is empty without it. The runner is the engine; the panel is the steering wheel.

**Independent Test**: With `ENRICHMENT_RUNNER_ENABLED=true` on the worker tier, run the cron against a fixture catalog. Verify the runner: (a) skips archived/inactive products; (b) skips products with `description_long` already populated; (c) skips products with a `state='rejected'` draft within the 14-day suppression window; (d) produces well-formed Arabic copy for the qualifying products; (e) writes the audit-log run row.

**Acceptance Scenarios**:

1. **Given** the cron schedule fires at 03:45 UTC and `ENRICHMENT_RUNNER_ENABLED=true`, **When** the worker runs, **Then** it generates drafts for at most N products per run (configurable cap, default 50) and respects the global daily token budget.
2. **Given** the cron tier guard fails (the env flag is `false` or the process is not the worker), **When** the runner is invoked, **Then** it short-circuits with a structured warn log and writes nothing.
3. **Given** the LLM API is unavailable, **When** the runner attempts a draft, **Then** the runner records a `failure` outcome in the run row, increments the failure metric, and moves on without crashing the loop. Already-drafted rows from earlier runs are unaffected.
4. **Given** a product previously had a `rejected` draft within the last 14 days for the same field, **When** the runner picks candidates, **Then** that product+field combination is skipped.

---

### User Story 3 — Token budget cap (Priority: P2)

Enrichment is bounded by a per-day token budget. The cron stops generating drafts for the day once the cumulative token spend (input + output, summed per-call from the existing copilot LLM client) exceeds the configured cap. The remaining candidates are deferred to the next day's run.

**Why this priority**: Constitution §I (financial integrity) requires that AI features keep their inference cost within the assessment-level budget (cost band: batched-llm; SC-004 requires monthly inference < 10% of stated ROI). P2 because v1 ships with a sensible default cap; SC-005 (cost cap held) is measured weekly, not on every run.

**Independent Test**: Configure `ENRICHMENT_DAILY_TOKEN_CAP=5000`. Seed 100 candidate products. Run the cron. Verify: (a) the run stops once cumulative tokens spent > 5000; (b) the run row records `tokens_spent` < cap + max-single-response slack; (c) the remaining candidates appear in the next day's run.

**Acceptance Scenarios**:

1. **Given** the daily token cap is configured, **When** the runner accumulates token spend, **Then** it halts the loop on the next iteration after exceeding the cap.
2. **Given** the cap is configured to zero (effectively disabled), **When** the runner starts, **Then** it logs an explicit warn and skips the run entirely (the operator clearly meant "stop drafting").
3. **Given** the runner consults the LLM client and the response includes input/output token counts, **When** the runner finishes, **Then** the run row's `tokens_spent` reflects the sum across all calls in this run.

---

### User Story 4 — Copilot integration (Priority: P3)

The AI Admin Copilot exposes a read tool `query_enrichment_drafts` so admins can ask "ما المنتجات التي تحتاج إلى مراجعة محتوى؟" (what products need content review?) and the copilot grounds the answer with rows from `enrichment_drafts`. The copilot's existing draft+preview pipeline (010-ai-admin-copilot) is NOT extended to draft enrichment content — that work is the cron's job. The copilot only READS the existing drafts for discoverability.

**Why this priority**: Discoverability + Arabic-language convenience. P3 because the dedicated panel is the authoritative surface; the copilot is the "remind me what's pending?" entry point.

**Independent Test**: Phase 1 copilot enabled. Admin asks "show me products with pending enrichment drafts". Copilot calls `query_enrichment_drafts`, replies with rows that match a direct query against `enrichment_drafts WHERE state='drafted'`. No fabrication: every product mentioned by the model must be in the tool output.

**Acceptance Scenarios**:

1. **Given** the copilot has the `inventory` scope, **When** the admin asks "what products need content review?", **Then** the copilot calls `query_enrichment_drafts` and replies with rows that include `product_id`, `field_name`, `state`, and a panel deep-link.
2. **Given** the copilot is asked about a specific product, **When** it calls the tool with a `product_id` filter, **Then** it returns the latest draft row for that product+field or "no draft available".

---

### Edge Cases

- **Brand-new product (just created)**: eligible immediately if `description_long` or `faq` is missing — no minimum age. The admin gets a draft to review on the next cron run.
- **Archived / inactive product**: skipped entirely — drafts have no value for hidden products.
- **Product with thin description that's been recently rejected**: 14-day suppression. The rejection might have been about wording style; we don't redraft until the suppression window elapses, giving admins a chance to either set the field manually or amend the cron's prompt template.
- **LLM produces non-Arabic output**: the cron validates that the output is predominantly Arabic (≥ 70% Arabic Unicode characters). Failures are recorded as `state='draft_invalid'` and the row is hidden from the admin panel — the next run gets another shot.
- **LLM produces clearly-broken copy** (zero-width characters, repeated tokens, > 10x expected length): the cron rejects the draft on output validation and counts as `draft_invalid` — same handling as above.
- **Runner is invoked twice in the same UTC day**: the second run finds the day's token budget already spent OR the candidate pool empty (the in-progress run from earlier marked the products as having a current `drafted` row); either way the second run is a near-no-op.
- **Daily token cap is zero**: the runner refuses to start and logs a warn. The operator clearly meant to disable enrichment without flipping `ENRICHMENT_RUNNER_ENABLED=false`.
- **Admin edits the draft heavily before applying**: the row carries both `generated_text` (original LLM output) and `final_text` (the admin's version). The audit log captures the diff so reviewers can see what was changed.
- **Catalog has tens of thousands of empty-content products**: the per-run cap (default 50) and the daily token budget bound the work; full catalog enrichment may take several days. The admin panel surfaces a "queue" hint so operators know how much work remains.
- **Worker tier outage**: the panel's pending-drafts list reflects yesterday's state. No urgency — enrichment is a backlog feature, not a real-time one.

---

## Requirements _(mandatory)_

### Functional Requirements

#### FR-DRAFT: draft generation

- **FR-DRAFT-001**: System MUST generate enrichment drafts via the existing copilot LLM client (`backend/src/services/copilot/llm-client.ts`) — no new SDK, no per-event inference cost.
- **FR-DRAFT-002**: System MUST scope each draft to ONE product+field combination — never bundles multiple fields into a single LLM call. This keeps tokens predictable and audit clean.
- **FR-DRAFT-003**: System MUST output Arabic copy as the default; the prompt template instructs the model and the validator (FR-DRAFT-007) rejects non-Arabic output.
- **FR-DRAFT-004**: System MUST mark archived (`isArchived=true`) and inactive (`isActive=false`) products as ineligible for drafting.
- **FR-DRAFT-005**: System MUST respect the 14-day rejection-suppression window: a product+field with a `state='rejected'` row in the last 14 days is not re-drafted.
- **FR-DRAFT-006**: System MUST never call the LLM on the customer purchase critical path. The runner is a worker-tier cron; no synchronous request handler invokes it.
- **FR-DRAFT-007**: System MUST validate every LLM output: ≥ 70% Arabic Unicode characters; length within reasonable bounds (description: 50–1000 chars; description_long: 300–8000 chars; FAQ: 1–10 entries each ≤ 500 chars). Invalid outputs are stored with `state='draft_invalid'` and hidden from the panel.
- **FR-DRAFT-008**: System MUST be idempotent at the (product_id, field_name) level: if a `drafted` row already exists for a product+field, the cron does not generate another. Re-runs are safe.

#### FR-DATA: storage

- **FR-DATA-001**: System MUST store drafts in a dedicated `enrichment_drafts` table with one row per (product_id, field_name, draft_iteration). Fields: state machine (`drafted`, `published`, `rejected`, `draft_invalid`), `generated_text` (original LLM output), `final_text` (admin's edited version, NULL until publish), audit timestamps, model id, token counts, run reference.
- **FR-DATA-002**: System MUST retain draft rows for at least 90 days for audit and back-testing of prompt-template changes.
- **FR-DATA-003**: System MUST cascade-delete draft rows when their parent product is deleted.

#### FR-RUN: run records

- **FR-RUN-001**: System MUST record one row per cron execution in `enrichment_runs`: started_at, completed_at, outcome (`in_flight`, `success`, `failure`), `drafts_generated`, `drafts_invalid`, `products_skipped` (per-reason map), `tokens_spent`, `failure_reason`.
- **FR-RUN-002**: System MUST stop the cron loop once cumulative tokens exceed the configured daily cap. The loop's exit condition is checked between products, not mid-call.
- **FR-RUN-003**: System MUST refuse to run when `ENRICHMENT_RUNNER_ENABLED !== "true"` OR `WORKER_TIER !== "true"`. The cron logs a warn and exits cleanly.
- **FR-RUN-004**: System MUST record a `metadata` audit-log row (`action='enrichment.run'`) per successful run so the existing admin audit views surface enrichment runs alongside other admin activity.

#### FR-PANEL: review surface

- **FR-PANEL-001**: System MUST expose `/admin/products/enrichment`, gated on `requireAdmin` + `requirePermission("inventory")`.
- **FR-PANEL-002**: Panel MUST list drafts in `state='drafted'` ordered by `created_at DESC`, paged at 25 per page.
- **FR-PANEL-003**: Each row MUST show: product name + thumbnail (existing convention), the field being drafted, the current product field value (or "(empty)"), the proposed draft text, the model id + tokens spent.
- **FR-PANEL-004**: Each row MUST offer three actions: "تطبيق" (publish), "تعديل" (edit-then-publish), "رفض" (reject with optional reason).
- **FR-PANEL-005**: Apply / edit-publish MUST go through the existing low-risk catalog-edit service path, not direct `productsTable.update` — this guarantees the same slug/sitemap/audit behavior as a manual admin edit (constitution §III consistency).
- **FR-PANEL-006**: Apply / edit-publish MUST write an `audit_logs` row with `action='enrichment.publish'`, `target_type='product'`, `target_id=<product id>`, metadata containing the field name and the original-vs-final diff.
- **FR-PANEL-007**: Reject MUST set `state='rejected'`, stamp `rejected_at`, store the optional reject reason, and the cron's 14-day suppression takes effect from that timestamp.
- **FR-PANEL-008**: Panel MUST be authored Arabic-first, RTL, matching the existing admin layout tokens.

#### FR-COPILOT: AI admin copilot integration

- **FR-COPILOT-001**: System MUST expose a `query_enrichment_drafts` read-only tool to the AI Admin Copilot, gated on the `inventory` scope.
- **FR-COPILOT-002**: Tool MUST accept optional filters: `state` (default `drafted`), `product_id` (single-product lookup), `field_name`, `limit` (default 10, max 50).
- **FR-COPILOT-003**: Tool MUST return rows from `enrichment_drafts` only — never invents a row. Copilot system prompt's no-fabrication discipline (010 R-3) extends to this tool.
- **FR-COPILOT-004**: Tool MUST surface a deep-link `panel_url` per row pointing at `/admin/products/enrichment?focus=<draft_id>` so the model's reply can drive the admin into the panel.

#### FR-SAFETY: scope boundaries

- **FR-SAFETY-001**: System MUST NEVER auto-publish a draft to the live product. Every change requires an explicit admin click on the panel.
- **FR-SAFETY-002**: System MUST NEVER expose draft text to customers. Drafts live behind the `inventory` admin scope; no customer-facing surface reads `enrichment_drafts`.
- **FR-SAFETY-003**: System MUST NEVER call the LLM in response to customer requests. The runner is the only invoker; storefront paths are unchanged.
- **FR-SAFETY-004**: System MUST refuse the `description` field for products whose existing `description` is already substantive (≥ 100 characters) — the runner only fills gaps. Admins who want to rewrite an existing description use the existing copilot draft+preview flow (010), not this batched runner.
- **FR-SAFETY-005**: System MUST honor the existing logger-redaction rules — draft text is not credential material, but the runner's structured logs MUST NOT include the full draft text at info level (truncate to first 200 chars in logs; full text only in the database row).

### Key Entities _(include if feature involves data)_

- **Enrichment Run**: One row per cron execution. Powers the run-history surface and the per-day token-cap accounting (US3).
- **Enrichment Draft**: One row per (product, field, iteration). Carries the state machine, the original LLM output, the admin's edited version, the rejection metadata, and the link back to its parent run. Cascades on product delete.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001 (coverage)**: 90 days after launch, ≥ 80% of active+non-archived products have non-NULL `description_long` (the field most commonly missing) — measured by the existing catalog audit query, not by tracking which were AI-generated.
- **SC-002 (review velocity)**: Admins clear the daily draft queue (median age of `state='drafted'` rows) in < 48 hours during the pilot. Stale drafts indicate a wording problem the prompt template needs to address.
- **SC-003 (publish-vs-reject ratio)**: After a 14-day pilot, at least 60% of generated drafts are published (with or without admin edits) — a higher rejection rate signals the prompt template is producing unusable copy.
- **SC-004 (cost cap held)**: Monthly LLM spend on enrichment stays under 10% of the assessment's stated ROI lever (data quality / SEO improvement, denominated in USD/month). Constitution §I gate.
- **SC-005 (zero customer regression)**: Customer-facing storefront latency p95 unchanged within ±1% of the baseline measured the week before launch.
- **SC-006 (audit completeness)**: 100% of publish events have a paired `audit_logs` row with `action='enrichment.publish'`, the field name, and the diff. Validated by the existing daily reconciliation worker.
- **SC-007 (no fabrication)**: 100% of products mentioned by the copilot when answering enrichment questions match an `enrichment_drafts` row. Validated by an integration test.

---

## Assumptions

- The existing copilot LLM client (`backend/src/services/copilot/llm-client.ts`) supports plain prompt → completion calls with token-count metadata in the response. v1 reuses Sonnet 4.6; if cost calibration argues for Haiku 4.5, the model id is configurable.
- The catalog stays under 10k active products through the pilot. Larger catalogs would lengthen the back-fill window but the design holds.
- The `inventory` admin permission scope is the right gate. No new scope is introduced.
- The existing copilot draft+preview pipeline (010) is NOT extended for batch enrichment — that's the runner's job. The copilot tool is read-only.
- Rejection reasons are free-text in v1. Structured rejection categories ("too verbose", "off-brand tone", "factually wrong") are a follow-up if pilot signal demands it.
- The default daily token cap is configurable per release. v1 ships with a conservative cap (e.g., 50k input + output tokens/day) sized at < 10% of the stated ROI lever; operators tune it from the existing system_settings table.
- The 14-day rejection-suppression window is a hard-coded constant in v1. If pilot signal argues for per-product suppression tuning, that's a follow-up.
