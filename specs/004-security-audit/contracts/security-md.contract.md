# Contract: `security.md`

**Purpose**: the audit's primary deliverable — the document leadership reads first and engineers reference for every Finding.

**Stakeholder**: leadership (User Story 1) for §§ 1–2; engineers (User Story 2) for §§ 3–6.

**Spec authority**: FR-010, FR-011, FR-012, FR-013, FR-020, FR-022, FR-030, FR-050.

---

## Required structure

`security.md` MUST contain the following sections, in this order. No interleaving.

```markdown
# SubNation Security Assessment

**Audit baseline**: branch `004-security-audit` @ <commit hash>
**Audit window**: <YYYY-MM-DD> to <YYYY-MM-DD>
**Auditor(s)**: <names>
**Severity scale**: see `research.md` §2 (Critical / High / Medium / Low)
**Classification scale**: per claim — proven / likely / hypothesis (see `research.md` §1 D-10)
**Distribution**: internal — product owner, engineering, authorized reviewers only.
This document describes attack paths and is not for external publication.

---

## 1. Executive Summary

<≤ 600 words. Readable by a non-engineer in 5 minutes (SC-001).
Required points:

- overall security posture (one of: solid / acceptable-with-caveats / at-risk / critical)
- top three risks in plain language (with their F-NNN IDs)
- what is safe enough today
- what is most urgent
- one-paragraph statement of what this audit did NOT do
  (no probes, no fixes, no migrations, no secret rotation).>

## 2. Threat Model

<Required content (FR-013):

- Likely attacker types (Threat Actor entities from data-model §2)
- Attacker goals
- Attack surfaces in scope (cross-references the matrix in research.md §3)
- Trust boundaries (Trust Boundary entities from data-model §4)
- Highest-value assets (Asset entities from data-model §3)
  A diagram is OPTIONAL but recommended.>

## 3. Findings

<One Finding per level-3 heading, in F-NNN order. Each Finding follows the
contract in finding.contract.md. Findings are NOT grouped by subsystem here —
that grouping happens in research.md §3 (Coverage Matrix) and priorities.md.
This section's job is to be the canonical, ordered, ID-stable list.>

### F-001 — <title>

<full Finding template per finding.contract.md>

### F-002 — <title>

…

## 4. Risk Ranking (summary)

<Compact table of every Finding with severity + urgency + partition. The
detailed five-input ranking lives in priorities.md; this section is the
quick reference so a reader of security.md does not need to switch
documents to see the list at a glance.>

| ID    | Title | Severity | Urgency | Partition  |
| ----- | ----- | -------- | ------- | ---------- |
| F-001 | …     | Critical | urgent  | quick-win  |
| F-002 | …     | High     | urgent  | structural |
| …     |       |          |         |            |

## 5. Quick Wins vs. Structural Work

<Two subsections. NOT a re-listing of every Finding — that is priorities.md's
job. This is a leadership-readable summary:

- Quick wins (≤ 5 bullets, each citing F-NNN).
- Structural hardening (≤ 5 bullets, each citing F-NNN).
  Items not appearing here are deferred and live in priorities.md.>

### 5.1 Quick wins (small, low-risk, reversible)

- **F-NNN** — <one-line description and rationale>

### 5.2 Structural hardening

- **F-NNN** — <one-line description and rationale; states why a quick win
  is insufficient — supports FR-024>

## 6. Explicit Non-Issues

<Per FR-030: surfaces that were inspected, looked risky on first reading,
and were determined to be acceptable. Each entry names:

- Coverage matrix row ID (e.g., FE-2)
- What was inspected
- Why it is not a Finding (one short paragraph)
- The Evidence Note(s) that support the dismissal (EN-NNN)
  This section closes spec FR-030 and ensures future audits do not re-litigate
  the same ground.>

### Non-issue: <Coverage matrix ID> — <one-line title>

<Body>
**Evidence**: EN-NNN, EN-NNN
```

---

## Validation (closure rules from `data-model.md` §9)

- **C-01** — Every Coverage Item has `status ∈ {covered, gap}` — `security.md`'s findings list closes the `covered` rows.
- **C-03** — Severity in `security.md` §3 equals severity in `priorities.md` for the same `F-NNN`.
- **C-05** — Pre-publish entropy scan is clean.
- **FR-011 closure** — Sections appear in the order specified above. A diff that reorders sections fails the contract.
- **FR-012 closure** — Executive Summary contains all four required points.
- **FR-013 closure** — Threat Model contains all five required elements.

---

## Anti-patterns this contract is designed to prevent

1. **Buried lede.** The executive summary leads; if a non-engineer cannot answer the four spec-User-Story-1 questions in 5 minutes, the summary failed (SC-001).
2. **Findings grouped by subsystem in §3.** Grouping defeats stable IDs across documents — when a finding's subsystem is reclassified, its position in the document moves, breaking cross-references in `priorities.md`. Grouping happens in §3 of `research.md` (the matrix), not here.
3. **"All findings are urgent."** §4's `Urgency` column is a triage signal, not a marketing label. Inflation makes the column useless.
4. **Section 5 re-lists every Finding.** §5 is a leadership-readable summary — it cites F-NNN IDs, it does not duplicate Finding bodies.
5. **Section 6 is forgotten.** Skipping the explicit non-issues section guarantees the next audit re-investigates the same surfaces (FR-030 violation; not optional).
6. **"Audit found that some endpoints lack rate limiting."** Generic claims with no F-NNN, no EN, no severity — they are noise, not findings. They MUST appear as F-NNN with linked evidence or not at all.
