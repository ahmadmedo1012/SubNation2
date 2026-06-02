# Contract: `priorities.md`

**Purpose**: the ranked remediation plan. Converts the audit's findings into a sprint plan a planner can fill from this document alone.

**Stakeholder**: planner / sprint owner (User Story 3).

**Spec authority**: FR-015, FR-024, FR-051, FR-052, SC-006, SC-009.

**Authoritative entity**: see [`../data-model.md` §6 Risk Score](../data-model.md).

---

## Required structure

```markdown
# SubNation Security Audit — Remediation Priorities

**Linked assessment**: `security.md` (same audit, same pinned commit).
**Generated**: <YYYY-MM-DD>

## 1. Ranking Method

<Plain-language description of how findings are ranked. Required content:

- The five inputs: severity, likelihood, blast radius, ease of exploitation, business impact.
- The ordering rule: primary by severity, then businessImpact, then easeOfExploitation desc.
- The contested-severity resolution rule (largest possible loss wins; see research.md §2).
- Pointer to data-model §6 for full enumerations.>

## 2. Ranked Table (every finding)

<Every F-NNN appears here. Severity column MUST equal security.md (FR-052).
Sorted per §1 ordering rule.>

| Rank | ID    | Title   | Severity | Likelihood | Blast Radius | Ease     | Business Impact | Partition  | Urgency |
| ---- | ----- | ------- | -------- | ---------- | ------------ | -------- | --------------- | ---------- | ------- |
| 1    | F-NNN | <title> | Critical | probable   | tenant-wide  | easy     | severe          | quick-win  | urgent  |
| 2    | F-NNN | …       | High     | possible   | multi-user   | moderate | material        | structural | urgent  |
| …    |       |         |          |            |              |          |                 |            |         |

## 3. Quick Wins (small, reversible, low-risk)

<Subsection per Finding. Each subsection re-states severity, recommendation
direction, reversibility, and dependencies — so the planner does not need to
open security.md to fill the sprint.>

### Q-NN — F-NNN — <title>

**Severity**: <tier>
**Effort estimate** (planner-facing, not from data-model): <small | small-medium>
**Recommendation**: <direction from finding.contract.md, repeated here>
**Reversibility**: fully-reversible | reversible-with-care
**Dependencies**: <list, or "none">
**Why this is a quick win, not structural**: <one sentence>

## 4. Structural Hardening

<Subsection per Finding. Same shape as §3, with one extra required field:

- **Why a quick win is insufficient**: <one sentence — supports FR-024 / SC-009>>

### S-NN — F-NNN — <title>

**Severity**: <tier>
**Effort estimate**: <medium | medium-large | large>
**Recommendation**: <direction>
**Reversibility**: fully-reversible | reversible-with-care | one-way
**Dependencies**: <list>
**Why a quick win is insufficient**: <one sentence — REQUIRED, per FR-024>
**Justification for size > quick-win** (REQUIRED iff size is `large`): <reasoning>

## 5. Deferred Items

<Subsection per Finding. These are the items the audit explicitly recommends
not fixing in the next hardening sprint — typically Low severity, or High
severity with prohibitive remediation cost vs. blast-radius. Each entry names
the deferral reason and the trigger that would un-defer it.>

### D-NN — F-NNN — <title>

**Severity**: <tier>
**Reason for deferral**: <one paragraph>
**Trigger to un-defer**: <e.g., "If the OpenWA host owner provides admin access — see CG-04">

## 6. Cross-Document Consistency Check

<Mechanical checklist signed off before publish. Closes C-03 / VR-RS-01 /
VR-RS-02 / VR-RS-03.>

- [ ] Every F-NNN in security.md §3 appears in this file's §2 table exactly once.
- [ ] Severity in §2 == severity in security.md §3 for every F-NNN.
- [ ] No `urgent` finding lands in §5 Deferred.
- [ ] No `deferred` finding lands in §3 Quick Wins.
- [ ] Every §4 Structural entry has a non-empty "Why a quick win is insufficient" line.
- [ ] Every `large`-size recommendation has a Justification (FR-024 / SC-009).
```

---

## Validation (closure rules from `data-model.md` §9)

- **C-03** — Severity matches `security.md` for every F-NNN.
- **C-06** — Zero `large rewrite` recommendation lacks `justification`.
- **VR-RS-01** — Every `security.md` Finding has exactly one Risk Score in this file.
- **VR-RS-02** — `severity` in §2 matches `security.md`.
- **VR-RS-03** — `partition` is consistent with `urgency` (`urgent` → never `deferred`; `deferred` → never `quick-win`).
- **FR-051 closure** — §2 shows all five inputs for each finding, not just the rank.

---

## Anti-patterns this contract is designed to prevent

1. **"Just sort by severity."** A pure severity sort hides the contested-severity problem (low likelihood × catastrophic blast radius vs. high likelihood × moderate impact). The five-input vector is the audit trail (FR-051).
2. **Quick wins that are not actually quick.** A "quick win" with one-way reversibility (e.g., key rotation that requires downstream updates) is structural in disguise. The Reversibility field forces this question.
3. **Repeated bodies between security.md and priorities.md.** §3 / §4 / §5 re-state _the planner-relevant_ fields (recommendation direction, reversibility, dependencies, deferral reason) — they do not copy the full Finding body. The Finding body lives in `security.md`.
4. **Silent large-rewrite recommendations.** §4 makes the "why a quick win is insufficient" line _required_ — a structural recommendation without that line fails the contract.
5. **Open-ended deferrals.** Every `D-NN` MUST name the trigger that would un-defer it. "Defer indefinitely" is not a plan; it is forgetting.
6. **Drift after security.md edits.** §6 cross-document consistency check is the mechanical gate that catches drift before publish.
