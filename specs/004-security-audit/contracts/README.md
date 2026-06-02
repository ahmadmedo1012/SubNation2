# Contracts: Document-Shape, Not API

**Feature**: [004-security-audit](../spec.md) | **Plan**: [../plan.md](../plan.md)

This directory holds **document-shape contracts** for the four audit deliverables and for a single Finding. Reading these contracts in order tells `/speckit-tasks` and `/speckit-implement` exactly what each Markdown deliverable must contain and in what order.

## Why these are not API contracts

The plan template's Phase 1 step says "Define interface contracts (if project has external interfaces) → `/contracts/`." For a normal SubNation feature, that means OpenAPI under `shared/api-spec/`, Zod schemas under `shared/api-zod/`, and regenerated React hooks under `shared/api-client-react/` (Constitution Principle III). This audit ships none of those.

The audit ships four Markdown files. The "interface" the audit exposes is therefore the **document shape** — the section order, the required fields, the cross-document consistency rules. Treating that shape as a contract is the same discipline the Constitution requires for code, applied to documentation: shipping the audit means satisfying these contracts the same way shipping a feature means satisfying its OpenAPI.

## Why `shared/api-*` is intentionally not touched

Constitution Principle III requires that any change to the public API surface update `shared/api-spec`, `shared/api-zod`, and `shared/api-client-react` in the same PR. This audit does not change the API surface — it observes it. Touching `shared/api-*` here would either (a) be a no-op commit that adds review noise, or (b) imply a behavior change that the audit charter forbids (spec FR-040). Both are wrong. The audit is documentation; it leaves `shared/api-*` alone.

A reviewer scanning this branch's diff for `shared/api-*` changes will find none. That absence is a deliberate signal that the audit respected its scope.

## Files in this directory

| Contract | What it specifies |
|----------|------------------|
| [`finding.contract.md`](./finding.contract.md) | The required structure of a single Finding inside `security.md`. |
| [`security-md.contract.md`](./security-md.contract.md) | The section order and content of `security.md`. |
| [`research-md.contract.md`](./research-md.contract.md) | The section order and content of `research.md` (audit-deliverable form, not the Phase 0 methodology form). |
| [`priorities-md.contract.md`](./priorities-md.contract.md) | The section order and content of `priorities.md`. |
| [`quickstart-md.contract.md`](./quickstart-md.contract.md) | The section order and content of the audit-deliverable `quickstart.md`. |

## How to read these contracts

Each contract has the same shape:

1. **Purpose** — one sentence on why the document exists.
2. **Stakeholder** — who reads this document (one of the four audiences from spec User Stories).
3. **Required structure** — section-by-section, what MUST appear and what MUST NOT.
4. **Validation** — the closure rules (`C-NN` from `data-model.md` §9) that touch this document.
5. **Anti-patterns** — the failure modes this contract is designed to prevent.

A deliverable is **conformant** iff it satisfies the required structure AND passes every cited validation rule. Conformance is checked at audit sign-off, before push.
