# Contract: `quickstart.md` (audit-deliverable form)

**Purpose**: tell a reviewer how to verify any Finding in the audit without contacting the original auditor.

**Stakeholder**: independent reviewer (User Story 4 — "reviewers can verify findings and reuse the threat model").

**Spec authority**: FR-016, SC-007.

**Naming-collision note**: there are two files at this path during the feature lifecycle. The plan-validation `quickstart.md` (Phase 1 of `/speckit-plan`) tells the reader how to validate THIS PLAN. The audit-deliverable `quickstart.md` described in this contract overwrites it during `/speckit-implement`. The collision is documented in `plan.md` → "Project Structure" and is intentional.

---

## Required structure

```markdown
# SubNation Security Audit — Quickstart

**Audience**: independent reviewer or future auditor.
**Audit baseline**: branch `004-security-audit` @ <commit hash> — every code citation in this audit resolves at this exact commit.
**Audit window**: <YYYY-MM-DD> to <YYYY-MM-DD>

## 1. How the audit was scoped

<Paragraph. References spec FR-001 (the 47 surfaces) and notes which surfaces
landed as Findings, non-issues, or coverage gaps. Names the boundaries of
"in scope" — e.g., "the OpenWA host's internal config is out of scope per
CG-04; we audit the SubNation side of that boundary only.">

## 2. How the audit was conducted

<Paragraph. Read-only inspection. Names the tools (git grep, file reads,
Drizzle schema review, dashboard read-only views), names what was NOT done
(no probes, no wallet writes, no auth-state mutations, no secret rotation).
Names the source of severity calibration (research.md §2) and the
classification rule (research.md §1 D-10).>

## 3. How the four documents relate

<Diagram or short text. Required points:
  - security.md = ordered Findings list + threat model + executive summary
  - research.md = the evidence notebook every claim cites
  - priorities.md = the ranked sprint plan derived from security.md
  - quickstart.md (this file) = how to use the other three.>

## 4. Step-by-step: how to verify a Finding

<Numbered procedure a reviewer follows for any single Finding. Required:
  1. Open security.md, locate F-NNN.
  2. For every Claim, follow each EN-NNN to research.md §4.
  3. Check the path:line range resolves at the pinned commit (`git show <commit>:<path>`).
  4. Read the excerpt and confirm the behavior matches the description.
  5. Re-classify the claim independently (proven / likely / hypothesis) and
     compare to the Finding's classification.
  6. If the classification was hypothesis: read `whatWouldConfirm` and
     `whyNotRun`; decide whether the audit's reason holds.
  7. Open priorities.md, find the same F-NNN; confirm severity matches and
     the partition (quick-win / structural / deferred) is consistent with
     the urgency.
  8. Record verdict: agree / disagree / needs-discussion. If disagree, name
     which step failed.>

## 5. Reviewer spot-check protocol (closes SC-005 / SC-007)

<As locked in research.md §1 D-06:
  - Sample size: 10% of Findings, minimum 3.
  - Drawn uniformly at random against the finalized list.
  - Any single failure halts sign-off.
  - The reviewer is independent of the audit author.
This section restates the protocol verbatim so this document is independently
useful.>

## 6. Pinned commit reference

**Commit hash**: <full SHA>
**Branch at audit**: 004-security-audit
**Recommended reproduction commands**:

```bash
git fetch origin 004-security-audit
git checkout <commit>
# Now every F-NNN's cited path resolves at the same revision.
```

## 7. What this audit did NOT do

<Bullet list, restating spec FR-040 / FR-041 / FR-042:
  - No code, infra, or migration changes.
  - No state-changing probes.
  - No secret rotation (recommendations only — operations performs rotation).
  - No production access not already held by the auditor.
  - No remediation work — that is a separate, future, separately-authorized branch.
This section protects the audit's scope from being mis-cited as a reason
something is "fine" — it isn't fine, it's untouched.>

## 8. How to use the audit for a future hardening sprint

<Pointer paragraph. Names the sequence:
  1. Read security.md §1 (executive summary) and §2 (threat model).
  2. Read priorities.md to fill the sprint with §3 quick wins first, §4 structural
     items second, ignore §5 unless trigger conditions are met.
  3. For each Finding being remediated, open the F-NNN in security.md and read
     the Recommendation block.
  4. Implementation work happens on a fresh branch (NOT 004-security-audit);
     fixes do not modify the audit deliverables.>
```

---

## Validation

- **FR-016 closure** — Sections appear in the order specified above.
- **SC-007 closure** — A reviewer following only this file (plus `research.md`) can verify three random Findings without contacting the author. Spot-checked at sign-off.

---

## Anti-patterns this contract is designed to prevent

1. **Missing pinned commit.** Without §6 the entire audit decays the moment any cited file is edited. This is the single most important field in the document.
2. **"How to verify" is implicit.** §4 is a numbered procedure, not a description; reviewers follow it, they do not improvise.
3. **Quickstart that is a tutorial.** The audience is a reviewer who already knows what an audit is. Skip "what is CSRF" and similar primer content; cite Wikipedia or OWASP if a reader needs background.
4. **Quickstart as a marketing summary.** §1's job is to tell a reviewer where to look, not to recap the executive summary. The exec summary lives in `security.md` §1; do not duplicate it here.
5. **Recommendation work mixed in.** §8 points at the remediation flow but does not perform it. Remediation lands on a different branch (FR-040). Mixing the two erodes audit-only discipline.
