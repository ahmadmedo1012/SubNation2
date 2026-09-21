# Feature Specification: AI Admin Copilot

**Feature Branch**: `010-ai-admin-copilot`

**Created**: 2026-06-03

**Status**: Implemented & wired in production (r103 update) — shape diverged from this design doc: the shipped copilot uses DIRECT-EXECUTE tools (backend/src/services/copilot/admin-direct.ts) + a two-step preview/confirm flow on the universal `admin_request` tool, not the doc's draft→confirm pipeline. Kept as the original design record.

**Input**: User description: "Design an AI-powered Admin Copilot for SubNation that lets administrators run natural-language commands across catalog, inventory, pricing, and operations, but only after a structured preview-and-confirm safety pipeline. Design-only phase. Required outputs: spec.md, research.md, data-model.md, quickstart.md."

---

## Context & Intent

SubNation administrators currently perform catalog, inventory, pricing, and operational changes through multi-step admin UI flows. Routine work (price updates, stock adjustments, description edits, FAQ tweaks, bulk category changes) consumes admin time and is error-prone at scale. Sensitive work (publishing drafts, archiving products, refund-adjacent wallet operations, role changes) carries real business risk and demands precision.

This feature introduces an **AI Admin Copilot** embedded in the admin dashboard. The copilot interprets natural-language commands from authenticated admin operators, drafts the corresponding action, shows a structured before/after preview, and executes the action **only after explicit human confirmation**. For high-risk actions it requires a second confirmation step. Every executed action is recorded in an immutable audit trail attributed to the approving admin.

The copilot is an **administrative operator surface**, not a customer-facing chatbot, not a generic AI chat, not a content/SEO generator, and not a support agent. It exists to make admin work faster and safer — never to act on its own judgement.

---

## Clarifications

### Session 2026-06-03

- Q: What is the maximum number of rows a single bulk operation may affect before the copilot refuses to draft and instructs the admin to narrow scope? → A: 500 rows
- Q: What unambiguous interaction pattern does the second-confirmation step for high-risk actions use? → A: Delayed re-click — the second Confirm button is disabled for a 3-second cooldown after the panel renders, then becomes clickable; the panel re-states the most consequential summary fields during the cooldown
- Q: What per-admin rate limit applies to copilot command throughput? → A: 30 commands per minute, 200 commands per hour per admin
- Q: How long is a generated preview valid before the system invalidates it outright (independent of record-version staleness checks)? → A: 5 minutes from generation timestamp; expired previews cannot be approved and must be re-drafted
- Q: What is the wallet/balance/refund scope for v1 of the copilot? → A: Draft + preview only — the copilot may interpret wallet/refund commands and show a preview, but the execute step is disabled and the admin is redirected to existing wallet/refund admin tooling to actually run the action; full wallet/refund execute via copilot is out of scope for this spec

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Read-only Catalog & Operations Assistant (Priority: P1)

An admin asks the copilot natural-language questions about the current state of products, inventory, orders, top-ups, users, and operational health, and receives accurate, source-grounded answers with no ability to write anything.

**Why this priority**: This is the safest possible MVP — zero write risk, immediate productivity value (faster than navigating admin pages), and it validates the core mechanic of intent understanding + grounded response. It can ship and deliver value before any preview/execute capability exists, and it bounds the blast radius of early model errors to "wrong answer" rather than "wrong write".

**Independent Test**: Deploy the copilot with read-only data scopes only. An admin types "how many active products do we have in the streaming category?", "show me the 5 lowest-stock products", "summarize today's risky activity", "explain this product's status". Each response returns correct data fetched from authoritative sources, with citations to the underlying records. No write tool is exposed in this phase, verifiable by inspection of the available tool set and by attempting a write command (which must be refused).

**Acceptance Scenarios**:

1. **Given** an authenticated admin with read access, **When** they ask "show me products with stock below 5 in the gaming category", **Then** the copilot returns a list grounded in current inventory data with links to the affected product records and no proposed actions.
2. **Given** an authenticated admin, **When** they ask "what changed in the catalog yesterday?", **Then** the copilot summarizes recent changes drawn from the change history, attributing each change to the admin who made it.
3. **Given** an authenticated admin, **When** they ask the copilot to "delete product X" or "raise all prices by 10%", **Then** the copilot refuses to execute in this phase and explains that write actions are not yet enabled.
4. **Given** an admin without permission to view wallet data, **When** they ask "show me wallet balances", **Then** the copilot refuses and references the missing scope, never returning wallet data even if the underlying source could.

---

### User Story 2 — Draft an Action with Preview, No Execute Yet (Priority: P2)

An admin describes a change ("update product 'Pro Plan' price to 49.99", "increase stock of 'Starter Plan' by 20", "add an FAQ entry to product X about refund policy"). The copilot drafts a proposed action, shows a structured before/after preview with affected entities, validation warnings, and side-effect notes — but cannot execute. The admin reviews the preview and either dismisses it or saves it as a pending plan.

**Why this priority**: Adds the planning capability without introducing write risk. Lets the team validate intent-recognition quality on real change requests, calibrate preview UX, and catch mis-interpretations before any execute path exists. Independently shippable as a "draft assistant" that admins can then apply manually through existing UI.

**Independent Test**: Admin issues a change command. Verify the copilot returns: (a) intent interpretation in plain text, (b) the structured proposed change set (which fields, on which entities, from what value to what value), (c) any validation warnings (e.g., "price drops below cost"), (d) a list of affected entities with IDs, (e) a clear "preview only — not executed" indicator. Verify no write occurs by checking the audit log and the entity timestamps before and after.

**Acceptance Scenarios**:

1. **Given** an authenticated admin with catalog write scope, **When** they ask "update the description of 'Premium Tier' to mention 24/7 support", **Then** the copilot returns a preview showing the current description, the proposed new description as a diff, and the affected product ID, with no change applied.
2. **Given** the same admin, **When** they ask "lower price of all draft products by 10%", **Then** the copilot returns the count of affected drafts, a sample preview of the first N rows showing before/after, and any warnings (e.g., margin alerts), with no change applied.
3. **Given** an admin who proposes a change to a field that does not exist on the entity, **When** the copilot drafts the action, **Then** it returns a validation error and refuses to construct an invalid plan rather than guessing or inventing fields.

---

### User Story 3 — Approve & Execute Low-Risk Catalog Edits (Priority: P2)

For low-risk catalog fields (title, description, long description, FAQ, usage terms, image URL, category), an admin reviews a preview from User Story 2, clicks Approve, and the copilot performs the edit. The execution is recorded in the audit trail with admin attribution. The result is shown with a success/failure indicator and a link to the affected entity.

**Why this priority**: Closes the loop from intent → preview → execute for the lowest-risk subset, proving the full safety pipeline end-to-end before high-risk classes are unlocked. Independently shippable as Phase 3 (low-risk only); price/stock/publish/archive remain preview-only until User Story 4 ships.

**Independent Test**: Admin approves a previewed description edit. Verify: (a) the entity is updated to the previewed new value, (b) an audit log entry is written with admin ID, timestamp, intent text, action plan, before/after values, and outcome, (c) the copilot UI shows a confirmation receipt with a link to the entity, (d) attempting to approve a price/stock/publish/archive change still fails with "high-risk — requires double confirmation" until US4 ships.

**Acceptance Scenarios**:

1. **Given** a previewed FAQ addition, **When** the admin clicks Approve, **Then** the FAQ is added to the product, an audit entry is written, and the UI shows success with the new state.
2. **Given** a previewed description edit, **When** the admin clicks Cancel instead, **Then** no change is made, the preview is discarded, no audit entry is written for an action that did not occur, and the cancellation itself is recorded as a copilot interaction event.
3. **Given** the entity has been modified by another admin between preview generation and approval, **When** the admin clicks Approve, **Then** the copilot detects the staleness, blocks the execute, and offers to re-draft against the current state.

---

### User Story 4 — High-Risk Action Double-Confirmation Gate (Priority: P2)

For high-risk actions — price changes, cost-price changes, stock changes, product publish, archive/unarchive, bulk edits, and admin permission/role changes — the copilot requires a second, distinct confirmation step beyond the standard Approve click before executing. The second confirmation surfaces the most consequential summary fields again and requires an unambiguous action (a 3-second cooldown on the second Confirm button) before committing. Wallet/balance/refund-adjacent commands are a separate class: the copilot drafts and previews them but disables execute and redirects the admin to existing wallet/refund admin tooling.

**Why this priority**: This is the feature's core safety property for sensitive work. Without it, executing the spec's high-risk classes would violate the constraint "never act blindly". Required before any of the high-risk classes can be enabled in production.

**Independent Test**: Admin previews a price change on a product. After clicking Approve, the copilot displays a second confirmation panel re-stating the entity, the field, the old value, the new value, the margin impact, and any warnings. The second Confirm control is disabled for 3 seconds with a visible countdown, then becomes clickable. Verify: (a) clicking outside or pressing Esc cancels without execute, (b) the second confirmation cannot be auto-clicked, deep-linked to, or skipped via API, (c) once committed, the action executes and is logged with both confirmation timestamps, (d) role/permission operations follow the same pattern, (e) wallet/refund commands surface a preview but the execute control is replaced by a "Open in wallet admin" handoff link with no copilot-side execute path.

**Acceptance Scenarios**:

1. **Given** a previewed price change from $19.99 to $9.99, **When** the admin approves, **Then** a second-confirmation step shows the price drop, the margin impact warning, and requires explicit re-confirmation; only after that does the change execute.
2. **Given** a previewed bulk archive of 47 products, **When** the admin approves, **Then** the second-confirmation step shows the count, lists a sample of the affected products, and warns that archive will hide them from customers; explicit re-confirmation is required.
3. **Given** any wallet/refund-adjacent command, **When** the admin previews it, **Then** the copilot shows the structured preview but the execute control is disabled and replaced with a handoff link to the existing wallet/refund admin tooling; no copilot-side execute path exists for this class.

---

### User Story 5 — Bulk Operations with Sampled Preview (Priority: P3)

An admin issues a bulk command ("increase prices 10% across all products in 'streaming' category", "archive all draft products older than 90 days", "set stock to 0 for products tagged 'discontinued'"). The copilot computes the affected set, shows the total count, displays a representative sample of the changes (a small subset rendered as before/after), and surfaces validation summaries (count of warnings, estimated margin impact, count of items that would fail validation). Execution requires the high-risk double-confirmation from User Story 4 and writes a single audit-trail entry covering the batch with per-item outcomes.

**Why this priority**: Bulk is the highest-value time-saver but also the highest-risk class. It is gated behind US4's double-confirmation. It builds on US2's preview model and is independently testable once US2 and US4 are in place.

**Independent Test**: Admin issues a bulk price-increase command. Verify the copilot returns: total affected count, a sample of N rows with before/after, an aggregate margin impact summary, count of validation warnings, count of items that would fail. After double-confirmation, verify the batch executes, per-item outcomes are recorded, partial failures are reported, and a single batch audit entry references all per-item results.

**Acceptance Scenarios**:

1. **Given** a bulk price command affecting 200 products, **When** the copilot generates the preview, **Then** it shows the count, a sample of representative rows, aggregate margin impact, and any validation warnings, capped at the configured bulk limit.
2. **Given** a bulk command would exceed the configured row limit, **When** the copilot evaluates the request, **Then** it refuses to draft the action and instructs the admin to narrow the scope, never silently truncating the affected set.
3. **Given** a bulk execute partially fails (e.g., 195 succeed, 5 fail validation at write time), **When** execution completes, **Then** the result panel shows successes, failures with reasons, and the audit batch entry contains per-item outcomes.

---

### User Story 6 — Audit Trail & Action History (Priority: P2)

Every interaction with the copilot — interpreted intent, drafted plans, approvals, cancellations, executions, failures — is recorded. Admins can browse and filter copilot action history (by admin user, time range, action class, entity, outcome) from within the copilot panel and from the existing admin audit views.

**Why this priority**: Required for trust, accountability, recovery analysis, and regulatory hygiene. Must exist before any execute capability ships in production. Independently testable as a read-only history view backed by the audit store.

**Independent Test**: After admin sessions occur, query the action history view. Verify each executed action has an entry containing: admin user ID, timestamp, original natural-language intent, interpreted action plan, before/after values, confirmation timestamps (single and double where applicable), outcome (success/partial/failure), and per-affected-entity references. Verify cancellations are recorded as copilot interaction events. Verify no audit entry can be edited or deleted from the UI.

**Acceptance Scenarios**:

1. **Given** any executed action, **When** the admin opens action history, **Then** the entry is visible with full provenance fields and is filterable by admin, time, class, and outcome.
2. **Given** a cancelled preview, **When** the admin opens action history, **Then** the cancellation is visible as an interaction event with no executed change linked.
3. **Given** any audit entry, **When** an admin attempts to edit or delete it from the UI, **Then** the action is refused and the attempt is itself recorded.

---

### User Story 7 — Anomaly & Risk Inspection (Priority: P3)

The admin asks the copilot to summarize unusual or risky activity ("anything unusual today?", "summarize suspicious discounts in the last week", "any abnormal top-up patterns?"). The copilot inspects authoritative data sources, identifies and explains potentially anomalous events using domain heuristics (e.g., loss-making prices, large single-user discount stacking, sudden inventory spikes, refund clusters), and proposes — but does not execute — investigation or mitigation actions.

**Why this priority**: High decision-support value, low write risk (read + propose only). Builds on US1's read pipeline and US2's draft pipeline. Independently shippable as an inspector with no execute capability of its own.

**Independent Test**: Inject known-pattern test data (a margin-violating price, a refund cluster, a stock anomaly). Ask the copilot to summarize. Verify the relevant items appear in the summary with explanations grounded in the underlying records, and that any proposed mitigation is shown as a draft preview only.

**Acceptance Scenarios**:

1. **Given** a product whose price is below cost, **When** the admin asks "summarize loss-making products", **Then** the copilot lists the product with the cost and current price, computes the margin gap, and offers to draft a price-correction plan as a preview only.
2. **Given** a cluster of refund operations against one user in the last 24 hours, **When** the admin asks "any unusual refund activity?", **Then** the copilot highlights the cluster with timestamps and amounts and links to the underlying records.
3. **Given** the copilot's heuristic returns no anomalies, **When** asked, **Then** it states "no anomalies found by these heuristics in this window" rather than fabricating findings.

---

### User Story 8 — Suggested Commands, Recent Actions, and Inline UX (Priority: P3)

The copilot panel surfaces context-aware suggested commands (e.g., on a product page: "update price", "add FAQ", "publish draft"), shows the admin's recent copilot actions, and exposes a clear input affordance, preview cards, approve/cancel buttons, and success/failure feedback. Suggestions are derived from the current admin context and never expose entities the admin lacks permission to see.

**Why this priority**: UX polish that compounds the copilot's discoverability and speed. Not safety-critical. Builds on the previous stories' execution model.

**Independent Test**: Open the copilot from a product detail page. Verify suggested commands are scoped to that product. Click a suggestion. Verify it pre-fills the input. Issue the command. Verify the preview/approve/cancel UI behaves as in earlier stories. Verify recent actions are listed and link back to their audit entries.

**Acceptance Scenarios**:

1. **Given** the admin opens the copilot from a product detail page, **When** the panel renders, **Then** suggestions reference that product and the admin sees their recent copilot actions on that product.
2. **Given** the admin lacks permission to see wallet data, **When** the panel renders, **Then** no wallet-related suggestions appear, regardless of the admin's location in the dashboard.
3. **Given** a long-running execute, **When** it is in progress, **Then** the panel shows progress feedback and the admin can navigate elsewhere; the result appears in the action history when complete.

---

### Edge Cases

- **Stale preview**: The underlying entity changed between preview generation and approval. The copilot must detect the mismatch (e.g., via record version) and block execution, offering a re-draft.
- **Concurrent admin edits**: Two admins act on the same entity simultaneously. The second to confirm must see a stale-preview block; never silently overwrite.
- **Misinterpreted intent**: The admin says "raise prices in streaming by 10" — does that mean 10% or 10 currency units? The copilot must surface the ambiguity in the preview ("interpreted as 10%") and let the admin correct before approval.
- **Hallucinated fields**: The copilot proposes editing a field that does not exist on the target entity. The validation layer must reject the plan before preview is shown.
- **Field outside allowed scope**: Admin asks to edit a field that is read-only or system-managed. The copilot must refuse at draft time.
- **Permission downgrade mid-session**: The admin's role is reduced while a preview is pending. The copilot must re-check authorization at execute time, not only at draft time.
- **Bulk cap exceeded**: The affected set exceeds the configured per-batch limit. The copilot must refuse to draft the bulk action and instruct the admin to narrow scope; it must never silently truncate.
- **Partial bulk failure**: Some items fail at write time. The result panel must show per-item outcomes; the audit batch entry must include per-item results.
- **Network or service failure mid-execute**: The execute path must be designed so that either (a) the action is fully applied with a recorded outcome, or (b) the action is cleanly aborted with an explicit failure entry; no partial silent state.
- **Wallet operation insufficient context**: Wallet/refund actions require additional context (linked order, reason, amount). The copilot must refuse to draft without those fields.
- **Secret leakage attempt**: The admin asks the copilot to print stored credentials, internal API keys, or PII outside the admin's scope. The copilot must refuse and never include such content in any response, preview, or audit entry.
- **Prompt injection in entity content**: A product description contains text attempting to manipulate the copilot. The copilot must treat entity content as untrusted data, never as instructions, and never execute commands derived from it.
- **Bypass attempt**: The admin tries to skip the preview/confirm steps via direct API or deep-link. The execute path must enforce that a fresh, valid preview + confirmation pair exists, and reject otherwise.
- **Long-tail language input**: Admin types in Arabic or English (or a mix). The copilot must support both for input and respond in the admin's preferred language without losing intent fidelity.
- **Empty / nonsense input**: The copilot must respond with a helpful clarifier rather than guessing or executing nothing-actions silently.
- **Rate-limit burst**: An admin (or compromised admin session) issues many commands in a short window. The copilot must throttle gracefully and never queue silent executes.

---

## Requirements _(mandatory)_

### Functional Requirements — Identity, Authorization, & Scoping

- **FR-AUTH-001**: The copilot MUST be available only to authenticated admin users; unauthenticated access MUST be impossible to reach the copilot surface or any of its capabilities.
- **FR-AUTH-002**: The copilot MUST inherit the existing admin role and permission model. It MUST NOT introduce a parallel authorization scheme nor expand any admin's scope beyond what they already have in the admin dashboard.
- **FR-AUTH-003**: The copilot MUST enforce per-resource permission checks at three points: (a) when reading data to answer a question, (b) when drafting an action, and (c) at execute time. The check at execute time MUST be authoritative even if the role changed since draft time.
- **FR-AUTH-004**: The copilot MUST scope all read and write operations to the data the requesting admin is permitted to access. If an admin lacks a scope, the copilot MUST refuse and explain the missing scope, never silently truncating or partially answering.
- **FR-AUTH-005**: Every copilot action MUST be attributed to a single, authenticated admin user. Service accounts, shared sessions, and impersonation MUST be disallowed for execute paths.

### Functional Requirements — Intent, Drafting, & Validation

- **FR-INTENT-001**: The copilot MUST accept natural-language input in English and Arabic (text input).
- **FR-INTENT-002**: The copilot MUST present its interpretation of the admin's intent in plain language as part of every preview, so the admin can confirm or correct before approval.
- **FR-INTENT-003**: The copilot MUST NOT invent entities, fields, values, or relationships that are not present in the underlying data sources or schema.
- **FR-INTENT-004**: The copilot MUST validate every drafted plan against the target entity's schema and business rules. Plans referencing non-existent fields, illegal values, or read-only attributes MUST be rejected at draft time with a clear reason.
- **FR-INTENT-005**: The copilot MUST surface ambiguity (e.g., "10" interpreted as percent vs. currency) in the preview and require the admin to confirm or correct before approval; it MUST NOT silently choose between ambiguous interpretations of business-significant fields.
- **FR-INTENT-006**: The copilot MUST treat content stored in entities (descriptions, FAQs, etc.) as untrusted data and never as instructions; injected instructions in entity content MUST NOT alter copilot behavior.

### Functional Requirements — Preview & Confirmation Pipeline

- **FR-PREVIEW-001**: Every write action MUST pass through a preview step before execution. There MUST be no execute path that skips preview.
- **FR-PREVIEW-002**: A preview MUST include: (a) interpreted intent, (b) the structured proposed change set (entity, field, before, after), (c) the list of affected entities with stable identifiers, (d) validation warnings, (e) side-effect notes (e.g., "this will hide products from customers"), (f) a clear "preview — not yet executed" indicator.
- **FR-PREVIEW-003**: A preview MUST include the admin user, the timestamp it was generated, and a record-version reference for each affected entity sufficient to detect staleness at execute time. A preview MUST be valid for at most **5 minutes** from its generation timestamp; after this window the preview MUST be rejected at execute time regardless of record-version staleness, and the admin MUST be required to re-draft.
- **FR-PREVIEW-004**: At execute time the system MUST verify the preview is still valid (entities unchanged since record-version capture). If stale, execution MUST be blocked and a re-draft offered.
- **FR-CONFIRM-001**: A standard write action (low-risk catalog edits) MUST require one explicit confirmation action by the admin before execute.
- **FR-CONFIRM-002**: A high-risk action MUST require a second, distinct confirmation step that re-states the most consequential summary fields. The second Confirm control MUST be disabled for a 3-second cooldown after the second-confirmation panel renders and only becomes clickable after the cooldown elapses. The cooldown countdown MUST be visible to the admin. Closing or navigating away cancels the second confirmation; the cooldown MUST NOT be skippable via keyboard, deep-link, or repeated submission.
- **FR-CONFIRM-003**: The set of high-risk classes MUST include, at minimum: price changes, cost-price changes, stock-level changes, product publish, archive/unarchive, bulk edits of any kind, and admin permission/role changes. Wallet/balance/refund-adjacent commands are a separate, no-execute class (see FR-DATA-002): they require preview but the copilot MUST disable the execute control for them.
- **FR-CONFIRM-004**: Confirmations MUST be single-use. A given preview + confirmation pair MUST execute at most one action; replays MUST be rejected.
- **FR-CONFIRM-005**: Confirmations MUST NOT be auto-clickable, deep-linkable, skippable via direct API, or otherwise bypassable. The execute path MUST verify a fresh, valid preview + confirmation pair exists.
- **FR-CONFIRM-006**: Cancellation MUST be available at every step. Cancelling MUST produce no side effect on the target data and MUST be recorded as a copilot interaction event.

### Functional Requirements — Execution & Outcome Reporting

- **FR-EXECUTE-001**: Execution MUST occur only after all gates pass: authentication, authorization, draft validation, preview generation, freshness check, single confirmation (and second confirmation for high-risk), and rate-limit check.
- **FR-EXECUTE-002**: Each execute MUST yield a structured outcome (success, partial, failure) with per-affected-entity results for bulk actions.
- **FR-EXECUTE-003**: On failure, the system MUST NOT leave silent partial state. Either the action is fully applied with the recorded outcome, or it is aborted with an explicit failure entry. Bulk actions MAY have per-item outcomes but MUST report each.
- **FR-EXECUTE-004**: The result of an execute MUST be visible to the admin in the copilot UI immediately, with links to the affected entities and the audit entry.

### Functional Requirements — Audit Trail

- **FR-AUDIT-001**: Every executed action MUST produce an immutable audit log entry containing: admin user, timestamps (preview, single-confirm, double-confirm if applicable, execute), original natural-language intent, interpreted plan, action class, before/after values per affected entity, outcome, and any failure reasons.
- **FR-AUDIT-002**: Every cancellation, refusal, validation rejection, and authorization denial MUST be recorded as a copilot interaction event with reason.
- **FR-AUDIT-003**: Audit entries MUST be immutable from the UI. Edit and delete MUST be impossible; any edit/delete attempt MUST itself be recorded.
- **FR-AUDIT-004**: Audit entries MUST be filterable by admin user, time range, action class, entity, and outcome from within the copilot panel and the existing admin audit views.
- **FR-AUDIT-005**: Audit retention MUST meet or exceed the SubNation administrative audit retention policy already in force; this feature MUST NOT shorten existing retention.

### Functional Requirements — Bulk Operations

- **FR-BULK-001**: Bulk operations MUST always pass through preview and high-risk double-confirmation regardless of the underlying action class.
- **FR-BULK-002**: A bulk preview MUST show the total affected count, a representative sample of N rows with before/after values, aggregate impact summary (e.g., margin impact for price changes), and counts of validation warnings and predicted failures.
- **FR-BULK-003**: A configured bulk row limit of **500 rows** MUST cap the size of any single bulk operation. If a request exceeds the limit, the copilot MUST refuse to draft and instruct the admin to narrow scope. It MUST NOT silently truncate. The limit is configurable but MUST NOT be raised without a security review.
- **FR-BULK-004**: A bulk execute MUST produce one audit entry referencing per-item outcomes; per-item failures MUST be visible in both the result UI and the audit entry.

### Functional Requirements — Safety, Constraints, & Refusals

- **FR-SAFETY-001**: The copilot MUST refuse any request that would bypass authorization, expose secrets, mutate money or balances silently, delete data without explicit confirmation, perform destructive actions without preview, invent data, override business rules, or operate as a customer-facing chatbot.
- **FR-SAFETY-002**: The copilot MUST never include credentials, API keys, internal infrastructure details, or out-of-scope PII in any response, preview, or audit entry.
- **FR-SAFETY-003**: The copilot MUST refuse to draft an action that violates a business rule (e.g., price below cost when policy disallows it), and surface the violated rule. If the admin's role permits override, the copilot MAY offer to draft the action with a prominent warning, still requiring high-risk double-confirmation.
- **FR-SAFETY-004**: The copilot MUST rate-limit per-admin command throughput to **30 commands per minute and 200 commands per hour** per admin user (sliding windows). Limits apply to draft, preview, and execute calls combined. Rate-limit denials MUST be visible in the audit log with the admin, window, and counter state. Limits are configurable but MUST NOT be raised without a security review.
- **FR-SAFETY-005**: The copilot MUST be implementable such that no single failure mode (model error, prompt injection, schema drift, stale data, partial network failure) can cause an unconfirmed write.

### Functional Requirements — Data Sources

- **FR-DATA-001**: The copilot MAY READ from the existing authoritative admin data domains: products and product attributes (including descriptions, FAQs, usage terms, image references, status, category, pricing, cost), inventory and stock movements, pricing history and planned price changes, orders and order events, top-up and wallet ledgers (read-only for inspection within the admin's scope), users (admin-visible fields only), and existing audit trails.
- **FR-DATA-002**: The copilot MAY WRITE in Phase 3 only to: catalog content fields (title, description, long description, FAQ, usage terms, image URL, category) for low-risk actions; and — gated by high-risk double-confirmation — to price, cost-price, stock levels, product status (publish/archive/unarchive), bulk variants of the above, and admin permission/role assignments. **Wallet/balance/refund-adjacent operations are explicitly NOT writable by the copilot in this spec**: the copilot MAY interpret a wallet/refund command, draft an action plan, and render a preview, but the execute step for any wallet/refund action MUST be disabled and the admin MUST be redirected to the existing wallet/refund admin tooling to actually run the action.
- **FR-DATA-003**: The copilot MUST NOT write to any data domain not explicitly enumerated in FR-DATA-002. New write scopes are out of scope for this feature and MUST require a separate spec to add.
- **FR-DATA-004**: The copilot MUST use existing service interfaces for writes; it MUST NOT introduce a parallel data-mutation path that bypasses existing validation, hooks, or business logic.

### Functional Requirements — Failure Modes & Guardrails

- **FR-FAIL-001**: When the model layer is unavailable or returns a low-confidence interpretation, the copilot MUST refuse to draft and surface the issue, rather than guessing.
- **FR-FAIL-002**: When validation rejects a plan, the copilot MUST return the specific rule violated and not retry with a silently rewritten plan.
- **FR-FAIL-003**: When a write fails at the service layer, the copilot MUST record the failure in the audit log and surface the failure to the admin with the upstream reason.
- **FR-FAIL-004**: Recovery: every executed action MUST be recoverable where the underlying domain supports it (e.g., catalog content edits via prior-value capture in audit; archive via unarchive). The audit entry MUST include the prior values necessary for best-effort recovery. Operations whose underlying domain cannot be reversed (e.g., already-fulfilled wallet operations) MUST be flagged as irreversible at preview time.

### Functional Requirements — UX Surface

- **FR-UX-001**: The copilot MUST live inside the admin dashboard as a dedicated panel or command surface, not as a separate application.
- **FR-UX-002**: The panel MUST support: natural-language text input, suggested commands (context-aware to the current admin location and permissions), a recent-actions list scoped to the admin, preview cards, distinct Approve and Cancel affordances, second-confirmation dialog for high-risk classes, success and failure feedback with links to affected entities and audit entries, and a browsable action history.
- **FR-UX-003**: The panel MUST never expose entities, suggestions, or autocomplete derived from data the admin lacks permission to see.
- **FR-UX-004**: The panel MUST be operable by keyboard alone for the full preview → approve/cancel flow, including high-risk double-confirmation.
- **FR-UX-005**: All copilot UI text MUST be available in English and Arabic and MUST honor RTL layout where applicable.

### Functional Requirements — Rollout & Phasing

- **FR-ROLLOUT-001**: The feature MUST be deployable in phases: Phase 1 (read/explain only, no write capability exposed), Phase 2 (read + draft + preview, no execute), Phase 3 (read + draft + preview + confirmed execute on the enumerated write scopes).
- **FR-ROLLOUT-002**: Each phase MUST be independently deployable and reversible (a phase can be turned off without breaking earlier phases).
- **FR-ROLLOUT-003**: Phase 3 enablement of high-risk write classes MUST be gated such that the system can be configured to allow Phase 3 for low-risk classes only while keeping high-risk classes in preview-only mode.

### Key Entities _(include if feature involves data)_

- **Admin Operator**: An authenticated admin user with a defined role and permission scope, the only actor who may interact with the copilot. All copilot actions are attributed to one Admin Operator.
- **Copilot Session**: A bounded conversational/working context belonging to one Admin Operator. Sessions hold short-term context (e.g., the entity an admin is currently looking at) used to scope suggestions; they do not carry write authority on their own.
- **Intent**: A structured representation of an admin's parsed natural-language request — what they want, on what entities, with what parameters. Generated by the copilot, displayed back to the admin for confirmation, and recorded in the audit trail.
- **Action Plan**: The structured proposal derived from an Intent: action class (e.g., update-price), affected entities with current values, proposed new values, validation warnings, side-effect notes, and irreversibility flags. Plans cannot exist in an executed state without a matching Confirmation.
- **Preview**: A rendered view of an Action Plan including before/after diffs, sampled rows for bulk, aggregate impact metrics, and freshness reference fields. Previews have a bounded lifetime; once stale, execute is blocked.
- **Confirmation**: A single-use authorization artifact attached to a Preview. Standard write actions require one Confirmation; high-risk actions require a second distinct Confirmation. Confirmations are non-replayable.
- **Execution Record**: The immutable audit-trail entry produced by an executed Action Plan. Contains identity, intent, plan, before/after values, confirmations, outcome, and per-item results for bulk.
- **Affected Entity Reference**: A pointer to a domain entity (Product, InventoryItem, Order, WalletEntry, Permission, etc.) targeted by a Plan, including a record-version reference used for staleness checks.
- **Permission Scope**: The set of read and write capabilities the requesting Admin Operator has. The copilot reads and writes only within this scope.
- **High-Risk Policy**: The configured set of action classes that require double-confirmation, including (at minimum) price, cost-price, stock, publish/archive, bulk, and permission/role changes. Wallet/balance/refund-adjacent commands are tracked as a separate no-execute class — preview only, with handoff to existing wallet admin tooling.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An admin can complete a typical low-risk catalog edit (e.g., update a product description) end-to-end through the copilot — from natural-language input to confirmed execute — in under 60 seconds, faster than the equivalent manual admin-UI flow.
- **SC-002**: 95% or more of copilot-generated previews are accepted by the admin without manual correction in the preview step, measured over a rolling 14-day pilot window. (Lower acceptance indicates intent-recognition or preview quality issues.)
- **SC-003**: 100% of executed actions appear in the audit trail with full provenance fields (admin, intent, plan, before/after, confirmations, outcome). Verified by reconciliation between executed-action counts and audit-entry counts; any gap is a critical defect.
- **SC-004**: 0 confirmed instances of a write being applied without a valid preview + confirmation pair, measured by reconciliation between mutation events on enumerated entities and preview/confirmation records. Any single instance is a critical incident.
- **SC-005**: 0 confirmed instances of a high-risk write being applied without a recorded second-confirmation, by the same reconciliation method.
- **SC-006**: Preview generation for a single-entity action returns within 5 seconds at the 95th percentile.
- **SC-007**: Preview generation for a bulk action affecting up to the configured row limit returns count, sample, and aggregate impact within 15 seconds at the 95th percentile.
- **SC-008**: 0 confirmed instances of secret material (credentials, API keys, internal infrastructure identifiers, out-of-scope PII) appearing in any copilot response, preview, or audit entry, measured by automated content scanning of all copilot outputs.
- **SC-009**: 0 confirmed instances of the copilot answering a question or executing an action that references an entity outside the requesting admin's permission scope, measured by reconciling copilot outputs against the permission system.
- **SC-010**: Pilot admin satisfaction score of 4.0 or higher on a 5-point scale measuring trust, speed, and accuracy after a 14-day usage period.
- **SC-011**: 50% or greater reduction in admin time spent on routine catalog edits (description/title/FAQ/category) within 30 days of Phase 3 enablement, measured by time-on-task sampling.
- **SC-012**: 100% of bulk operations exceeding the configured row limit are refused at draft time. 0 instances of silent truncation.
- **SC-013**: Admin recovery from a mistaken low-risk execute is possible within 60 seconds using the audit trail's prior-value capture, for action classes whose underlying domain supports recovery.

---

## Out of Scope

- Customer-facing chat, support agents, or any non-admin AI surface.
- Generic AI chat or open-ended conversational assistant unrelated to administrative actions.
- SEO content generation, marketing copy generation, or other content-marketing AI.
- **Copilot-side execute of wallet, balance, refund, top-up, or any other money-mutating operation.** The copilot drafts and previews these but the execute control is disabled and the admin is redirected to existing wallet/refund admin tooling. Adding copilot-side execute for any money-mutating class MUST require a separate spec.
- New write scopes beyond those enumerated in FR-DATA-002. Adding new write scopes (e.g., creating new admin roles from natural language, mutating financial settings, mutating tax/legal configuration, deploying or modifying infrastructure) MUST require a separate spec.
- Mobile-native admin client. Phase 1–3 target the web admin dashboard only.
- Multi-admin shared collaborative sessions. One admin per session.
- Automated/scheduled copilot actions (e.g., "every Monday raise prices by 1%"). All copilot actions are interactive and admin-initiated in this feature.
- Model selection, model hosting, and model fine-tuning policy. These are implementation choices addressed in `/speckit-plan` and `research.md`, not in this spec.

---

## Assumptions

- The existing admin authentication and role/permission system is reused. The copilot does not introduce a parallel auth scheme.
- The existing administrative audit trail infrastructure is reused or extended; this feature does not replace it.
- All write operations route through the existing service-layer mutation interfaces with their existing validation and business rules; the copilot does not introduce a parallel data path.
- The admin dashboard is a web application; mobile native support is out of scope for this feature.
- SubNation operates with English and Arabic as primary admin languages. Both are supported in copilot input/output and the panel honors RTL layout.
- A configured bulk row limit of 500 rows bounds the size of any single bulk operation; the limit is set by FR-BULK-003 and is configurable but MUST NOT be raised without a security review.
- Per-admin rate limits are set by FR-SAFETY-004 (30/minute and 200/hour, sliding windows); limits are configurable but MUST NOT be raised without a security review.
- Preview freshness is enforced via record-version references on affected entities; the underlying domain already provides such references or can be extended to do so.
- Recovery from executed actions is best-effort: it is supported where the underlying domain allows (catalog content, archive/unarchive), and is explicitly flagged as irreversible at preview time where the underlying domain does not (e.g., already-fulfilled wallet operations).
- The set of "high-risk action classes" enumerated in FR-CONFIRM-003 is the minimum; the implementation MAY add additional classes but MUST NOT remove any without a spec amendment.
- Pilot deployment will involve a small group of admins (≤10) before broad rollout, allowing measurement of SC-002, SC-010, and SC-011.
- The model layer used to interpret intent and draft actions is treated as a fallible component; safety properties are enforced by the preview/confirm/validation pipeline, not by the model's correctness.
- All copilot outputs (responses, previews, suggestions) are subject to automated PII/secret-leak scanning before display; the scanner already exists or is added as part of implementation.
