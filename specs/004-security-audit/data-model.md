# Data Model: SubNation Security Audit

**Feature**: [004-security-audit](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-02

This document formalizes the eight entities the spec defined informally so that `/speckit-tasks` and `/speckit-implement` cannot drift from the spec when generating the deliverables. These are **document entities** — they describe the structure of the audit's outputs, not database tables. There is no schema, no migration, no Drizzle file.

The canonical source for each field's intent is the spec; this file pins it down enough that two audits could not produce structurally different findings.

---

## Conventions

- **MUST / SHOULD / MAY** follow RFC 2119.
- A field marked **MUST** is a hard requirement; absence fails the requirements checklist.
- A field marked **SHOULD** is a strong recommendation; absence requires a one-line justification next to the field.
- A field marked **MAY** is optional context.
- All identifiers follow the schemes in `research.md` §1 D-04 (`F-NNN`, `EN-NNN`, `CG-NN`, plus `XS-NN` external-source, `SH-NN` secret-handling).
- Enumerations are closed sets — values outside the set are invalid.

---

## 1. Finding (`F-NNN`)

A single audit observation, written into `security.md` and ranked in `priorities.md`.

### Required attributes

| Field | Type | Constraint |
|-------|------|-----------|
| `id` | string | Pattern `^F-\d{3}$`; unique across the audit; stable across `security.md` / `priorities.md` / `research.md`. |
| `title` | string (≤ 100 chars) | Imperative or descriptive; states the issue, not the fix. E.g., "Wallet top-up approval lacks idempotency key" — not "Add idempotency key to top-up." |
| `severity` | enum | `Critical` \| `High` \| `Medium` \| `Low` (per `research.md` §2). |
| `subsystem` | string (matrix row ID) | One of the 47 row IDs in `research.md` §3 (e.g., `WALLET-1`). One Finding maps to **exactly one** primary subsystem; secondary subsystems go in `relatedSubsystems`. |
| `exploitability` | enum | `Direct` (one HTTP request / one click) \| `Chained` (≥ 2 prior conditions) \| `Insider` (requires admin or staff context) \| `Theoretical` (no exploit demonstrated). |
| `impact` | string (≤ 500 chars) | Plain-language business impact; what the user / business loses if the Finding is exploited. Avoids security jargon where possible (User Story 1 readability). |
| `evidence` | list of `EN-NNN` | At least one Evidence Note ID. A Finding with zero linked Evidence Notes is invalid. |
| `claims` | list of Claim objects | At least one Claim. See §1.1 below. |
| `reproductionOrHypothesis` | Reproduction \| Hypothesis | Exactly one. See §1.2 below. |
| `recommendation` | Recommendation object | See §8. |
| `urgency` | enum | `urgent` \| `can-wait` \| `deferred`. Default per severity in `research.md` §2 calibration table; may be overridden with a one-line justification in `notes`. |

### Optional attributes

| Field | Type | Notes |
|-------|------|-------|
| `relatedSubsystems` | list of matrix row IDs | Secondary subsystems this Finding also touches (≥ 0). Empty for clean single-subsystem findings. |
| `affectedAssets` | list of Asset names | Cross-references entities in §3. |
| `crossesTrustBoundary` | list of Trust Boundary names | Cross-references entities in §4. |
| `cveOrCwe` | string | E.g., `CWE-352` for CSRF, `CVE-2024-…` for a known dep CVE. |
| `notes` | string | Reviewer-relevant context, contradictions resolved, links to other findings. |

### Derived (not authored)

| Field | Source |
|-------|--------|
| `riskScore` | Computed in `priorities.md` from severity × likelihood × blast radius × ease × business impact (see §6). |

### Validation rules (drawn from spec FRs)

- **VR-F-01** — Every required field is present (FR-020).
- **VR-F-02** — `severity` value matches the calibration in `research.md` §2 (FR-050 / FR-052).
- **VR-F-03** — Every `EN-NNN` in `evidence` resolves to an Evidence Note in `research.md` §4 (FR-014).
- **VR-F-04** — Every cited path in linked Evidence Notes resolves at the audit's pinned commit (FR-023).
- **VR-F-05** — If `reproductionOrHypothesis` is a Hypothesis, the recommendation MUST NOT be marked `urgent` unless the *worst-case* assumption holds (FR-021 + severity calibration anchors).
- **VR-F-06** — `recommendation.size` is **not** `large rewrite` unless `recommendation.justification` explicitly addresses why a smaller fix is insufficient (FR-024).
- **VR-F-07** — No Claim text contains a secret value (FR-042 / SC-008).
- **VR-F-08** — `subsystem` value matches the matrix row ID exactly; typos invalidate the Finding (FR-001 / FR-002 closure).

### 1.1 Claim sub-entity

A Finding contains one or more Claims. Per-claim classification is mandated by FR-021.

| Field | Type | Constraint |
|-------|------|-----------|
| `text` | string (≤ 280 chars) | One falsifiable assertion. "The route is missing CSRF" is one claim; "and therefore an attacker can force a top-up" is a *second* claim. |
| `classification` | enum | `proven` \| `likely` \| `hypothesis` (per `research.md` §1 D-10 promotion rules). |
| `evidence` | list of `EN-NNN` | At least one EN per claim — a claim without supporting Evidence Notes is invalid. |
| `whyNotPromoted` | string | Required iff `classification` is `likely` or `hypothesis`. Names the missing signal that would promote the claim (e.g., "Reproduction would require a state-changing POST that this audit does not run."). |

**Validation**: A Finding's overall *posture* is the strongest classification among its Claims, but the document MUST display each claim's classification individually — never collapse to a single Finding-level classification.

### 1.2 Reproduction vs. Hypothesis sub-entity

Exactly one of these is attached to each Finding. Per FR-020 the Finding MUST carry one or the other.

**Reproduction** (used when the Finding is reproducible read-only at the pinned commit):
| Field | Type | Constraint |
|-------|------|-----------|
| `kind` | literal | `"reproduction"` |
| `steps` | ordered list of strings | Read-only steps a reviewer can replay (e.g., "Open `backend/src/routes/wallet.ts:88`, observe missing `csrfMiddleware`."). |
| `pinnedCommit` | string | The commit hash recorded once in `quickstart.md`; reproduced here for cross-doc independence. |

**Hypothesis** (used when the Finding cannot be reproduced without state change):
| Field | Type | Constraint |
|-------|------|-----------|
| `kind` | literal | `"hypothesis"` |
| `whatWouldConfirm` | string | The PoC that would promote the claim (e.g., "Cross-origin POST to `/api/wallet/topup/approve` from a non-allowed origin against staging."). |
| `whyNotRun` | string | Why the audit did not run the PoC (typically: "would change state," "would touch production," "requires Cloudflare-edge access"). |
| `confirmationCost` | enum | `cheap` \| `moderate` \| `expensive` — informs the planner whether to fund a confirmation pass before remediation. |

---

## 2. Threat Actor

A described attacker profile. Used in the threat-model section of `security.md`. Findings reference Threat Actors as part of impact analysis.

| Field | Type | Constraint |
|-------|------|-----------|
| `name` | string | E.g., "unauthenticated internet user," "authenticated low-privilege buyer," "malicious admin," "compromised external-provider tenant," "compromised support agent." |
| `goals` | list of strings | What this actor is trying to achieve (e.g., "drain wallet balances," "obtain free credentials," "elevate privileges"). |
| `capabilities` | list of strings | What this actor can do (e.g., "execute arbitrary client-side JS via XSS," "send signed Telegram payloads," "read OpenWA host filesystem"). |
| `realismFloor` | enum | `commodity` (script kiddie / botnet) \| `targeted` (a person specifically attacking SubNation) \| `nation-state` (out of scope unless evidence demands). The audit MUST NOT inflate threat models with nation-state actors absent specific evidence. |

**Validation**: at least 4 actor profiles must exist (the four listed in spec Key Entities are the floor; more may be added).

---

## 3. Asset

A thing of value to be protected. Findings declare which Assets they affect.

| Field | Type | Constraint |
|-------|------|-----------|
| `name` | string | E.g., "user wallet balance," "admin session," "OAuth refresh token," "ledger consistency invariant," "encryption key (`ENCRYPTION_KEY`)." |
| `class` | enum | `financial` \| `identity` \| `secret` \| `availability` \| `reputation`. |
| `criticality` | enum | `critical` \| `high` \| `medium` \| `low`. Drives default severity for findings that compromise the asset. |
| `owners` | list of strings | Who in the SubNation team is on the hook if this asset is compromised. |

**Validation**: Asset list MUST cover at minimum: wallet balance, ledger invariant, customer session, admin session, each provider OAuth/OTP token, the `SESSION_SECRET`, the `ENCRYPTION_KEY`, the database connection string, the OpenWA bot token.

---

## 4. Trust Boundary

A named seam between zones of differing trust. Findings often live at boundaries.

| Field | Type | Constraint |
|-------|------|-----------|
| `name` | string | E.g., "browser ↔ app," "app ↔ Cloudflare Tunnel edge," "app ↔ OpenWA host," "app ↔ Telegram," "app ↔ Neon," "app ↔ Redis." |
| `inboundDirection` | string | What flows into the higher-trust side. |
| `outboundDirection` | string | What flows out. |
| `currentControls` | list of strings | The mechanisms enforcing the boundary today (Helmet/CSP, Origin/Referer check, mTLS to Neon, etc.). |
| `assumptions` | list of strings | What the audit is taking on faith because the other side of the boundary is opaque. Each assumption SHOULD have a matching `CG-NN` if the auditor cannot inspect both sides. |

**Validation**: Trust Boundary list MUST include the seven boundaries enumerated in spec Key Entities.

---

## 5. Coverage Item

One row of the matrix in `research.md` §3.

| Field | Type | Constraint |
|-------|------|-----------|
| `id` | string | Matches the matrix row ID (e.g., `AUTH-1`). |
| `subsystem` | string | One of: Authentication, Authorization, Wallet & Financial Integrity, API & Input Handling, Infrastructure & Deployment, Frontend Security, Supply Chain & Operational. |
| `surface` | string | The specific named thing (e.g., "Google login (Firebase)"). |
| `status` | enum | `open` \| `covered` \| `gap`. |
| `closure` | union | One of: list of `F-NNN`, `non-issue` + note, or `CG-NN`. Required iff `status` ∈ {`covered`, `gap`}. |
| `lastReviewedAt` | ISO date-time | Set when the row first transitions out of `open`. |

**Validation**: at audit sign-off, **zero** rows have `status: open` (FR-002 / SC-003).

---

## 6. Risk Score (entry in `priorities.md`)

| Field | Type | Constraint |
|-------|------|-----------|
| `findingId` | string | `F-NNN`. |
| `severity` | enum | Same value as the Finding's severity (FR-052 — must match across documents). |
| `likelihood` | enum | `near-certain` \| `probable` \| `possible` \| `remote`. |
| `blastRadius` | enum | `single-user` \| `multi-user` \| `tenant-wide` \| `cross-tenant`. |
| `easeOfExploitation` | enum | `trivial` \| `easy` \| `moderate` \| `hard`. |
| `businessImpact` | enum | `existential` \| `severe` \| `material` \| `minor`. |
| `partition` | enum | `quick-win` \| `structural` \| `deferred`. Drives the section a Finding lands in inside `priorities.md`. |
| `partitionRationale` | string (≤ 200 chars) | One-line justification for the partition (e.g., "Quick win: single-line middleware add, fully reversible."). |

**Ranking rule**: `priorities.md` orders findings primarily by `severity`, then by `businessImpact`, then by `easeOfExploitation` (descending; trivial > hard). The full five-input vector is shown for each Finding so the rank is auditable, not just stated (FR-051).

**Validation**:
- **VR-RS-01** — Every Finding in `security.md` has exactly one Risk Score in `priorities.md` (no orphans, no duplicates).
- **VR-RS-02** — `severity` matches the Finding's severity (FR-052).
- **VR-RS-03** — `partition` value is consistent with the Finding's `urgency`: `urgent` → typically `quick-win` or `structural`, never `deferred`; `deferred` → never `quick-win`.

---

## 7. Evidence Note (`EN-NNN`, in `research.md`)

| Field | Type | Constraint |
|-------|------|-----------|
| `id` | string | Pattern `^EN-\d{3}$`; unique. |
| `subsystem` | matrix row ID | Cross-references §3 / Coverage Item. |
| `pathRange` | string | `path/to/file.ts:LL-LL`. Resolves at the pinned commit. |
| `excerpt` | string (≤ 3 lines) | Code excerpt; MUST NOT contain a secret value. |
| `behavior` | string (≤ 280 chars) | Plain-language description of what the code does. |
| `linkedFindings` | list of `F-NNN` | Findings this Evidence Note supports. May be empty during the gathering phase; MUST be non-empty by sign-off, OR the EN is dropped or moved to a "discarded observations" section with a one-line reason. |
| `classificationOfObservation` | enum | `proven` \| `likely` \| `hypothesis` — applies to the observation itself, independent of any claim it supports. |
| `notes` | string | Reviewer context, contradictory signals, links to other ENs. |

---

## 8. Recommendation

Attached to each Finding. Sized so the planner can sequence work without re-reading `security.md`.

| Field | Type | Constraint |
|-------|------|-----------|
| `direction` | string (≤ 280 chars) | What to change at the design level. Not code; not a diff. E.g., "Add the existing `csrfMiddleware` to all state-changing wallet routes (currently applied only to admin routes)." |
| `size` | enum | `quick-win` \| `structural` \| `deferred`. Matches the partition in §6. |
| `reversibility` | enum | `fully-reversible` \| `reversible-with-care` \| `one-way` (e.g., key rotation). |
| `dependencies` | list of strings | What must be true before this fix can land (e.g., "OpenAPI regeneration," "OpenWA host owner cooperation," "lead-time for secret rotation"). |
| `justification` | string | Required **iff** `size` is `structural` or larger; explains why a smaller fix is insufficient (FR-024 / VR-F-06). |
| `outOfScopeForThisAudit` | boolean | `true` iff implementing the recommendation is *explicitly* out of this audit's branch. Default: `true` (the audit phase ships no fixes — FR-040). |

---

## 9. Cross-Entity Validation Summary

Closure conditions for the audit's done-when (referenced from `quickstart.md` plan-validation flavor and re-stated in the audit-deliverable `quickstart.md`):

- **C-01** — Every Coverage Item has `status ∈ {covered, gap}` and a non-empty `closure` (FR-002 / SC-003).
- **C-02** — Every Finding has ≥ 1 Evidence Note, ≥ 1 Claim, and exactly one Reproduction-or-Hypothesis (FR-020).
- **C-03** — Every Finding's severity in `security.md` equals its severity in `priorities.md` (FR-052).
- **C-04** — Every Evidence Note's path resolves at the pinned commit (FR-023 / SC-005).
- **C-05** — Zero deliverable contains a secret value (FR-042 / SC-008); pre-publish entropy scan run and clean.
- **C-06** — Zero `large rewrite` recommendation lacks a `justification` (FR-024 / SC-009).
- **C-07** — Every `Hypothesis` Finding has both `whatWouldConfirm` and `whyNotRun` (FR-021 / FR-031).
- **C-08** — Every `Coverage Gap` (`CG-NN`) has assumption + access-required + worst-case (FR-032).

These C-NN closure conditions are the literal pass/fail criteria for the audit and are restated as a checklist in `quickstart.md` (audit-deliverable version).
