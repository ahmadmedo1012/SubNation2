# Contract: `research.md` (audit-deliverable form)

**Purpose**: the evidence notebook backing every claim in `security.md`. A reviewer who picks any claim must be able to follow it back to a citable observation.

**Stakeholder**: reviewer (User Story 4) and engineer (User Story 2 cross-checks).

**Spec authority**: FR-014, FR-031, FR-032, FR-042, FR-043.

**Important**: this contract describes the **audit-deliverable** form of `research.md`. The Phase 0 form already in `specs/004-security-audit/research.md` carries methodology decisions and templates; `/speckit-implement` populates the empty sections without rewriting the methodology decisions.

---

## Required structure

`research.md` MUST contain the following sections, in this order. The Phase 0 file already has the right skeleton; `/speckit-implement` fills it in.

```markdown
# Phase 0 Research: SubNation Security Audit Methodology

**Audit baseline**: branch `004-security-audit` @ <commit hash>
**Audit window**: <YYYY-MM-DD> to <YYYY-MM-DD>

## 1. Methodology Decision Log

<Decisions D-01 through D-10 — locked at plan time. Edits during /speckit-implement
require an explicit amendment note ("D-04 amended on YYYY-MM-DD because …").>

## 2. Severity Scale Calibration

<As locked at plan time. Calibration anchors are referenced (not redefined) in
security.md §1.>

## 3. Coverage Matrix

<The 47-row matrix. Every row's Status MUST be `covered` or `gap` at sign-off
(no `open` rows). Each row's `Findings / Notes / Gap` cell MUST contain at
least one of:

- a list of F-NNN IDs (the row is closed by those Findings)
- the literal `non-issue: <one-line note>` (the row is closed by a non-issue)
- a `CG-NN` reference (the row is a coverage gap)>

## 4. Evidence Notebook

<Populated by /speckit-implement. One subsection per EN-NNN, in numerical order.
Each EN follows the template in §4 of the Phase 0 file. ENs that the audit ended
up not citing in any Finding MUST either be linked to a Finding or moved to a
"Discarded observations" subsection at the end with a one-line reason.>

### EN-001 — <title>

<EN body per template>

### EN-002 — <title>

…

### Discarded observations (optional)

<ENs that were gathered but not used. Each carries a one-line reason for
discarding (e.g., "behavior turned out to be intentional and documented in
PLATFORM.md"). This protects future audits from re-investigating dead ends.>

## 5. External-Source Notes

<Populated by /speckit-implement. One subsection per XS-NN. Required for any
Finding whose primary evidence is a Render / Cloudflare / Sentry / Neon
dashboard view rather than a repo file.>

## 6. Coverage Gaps

<Populated by /speckit-implement. One subsection per CG-NN. Each gap MUST
record:

- assumption the audit is making about the boundary
- access required to close the gap
- worst-case finding if the assumption is wrong (severity tier + 1-line description)
  This closes FR-032.>

## 7. Secret-Handling Log

<Populated by /speckit-implement. One subsection per SH-NN. Records: secret type,
location (path or log channel — never the value), how the audit found it,
recommendation to rotate, linked Finding F-NNN.
Closes FR-042 / SC-008.>

## 8. Done-When (Phase 0 + audit-deliverable)

<Phase 0 done-when checklist (already complete) PLUS the audit-deliverable
done-when:

- [ ] Coverage matrix has zero `open` rows
- [ ] Every EN is linked to a Finding OR moved to Discarded observations
- [ ] Every CG records assumption / access / worst-case
- [ ] Every SH records type / location / recommendation
- [ ] Pre-publish entropy scan run; result attached at the bottom of this file
- [ ] Reviewer spot-check on ≥10% of Findings (minimum 3) — pass>
```

---

## Validation (closure rules from `data-model.md` §9)

- **C-01** — Every Coverage Item has `status ∈ {covered, gap}`.
- **C-04** — Every Evidence Note's `pathRange` resolves at the pinned commit.
- **C-05** — Zero secret values appear in Evidence Note excerpts (entropy scan clean).
- **C-07** — Every Hypothesis Finding is supported by an EN that records why the PoC was not run.
- **C-08** — Every CG-NN has assumption + access-required + worst-case.

---

## Anti-patterns this contract is designed to prevent

1. **Methodology drift mid-audit.** Decisions D-01 through D-10 are locked at plan time. Changing severity calibration mid-audit silently invalidates earlier rankings; if a decision needs to change, it must be explicitly amended (with a date) so the change is auditable.
2. **Floating Evidence Notes.** ENs that no Finding cites are research debt — either they belong to a Finding the audit forgot to write, or they are dead ends that future audits will rediscover. The Discarded section forces a verdict.
3. **Coverage matrix as decoration.** The matrix is the single mechanism that closes FR-002 / SC-003. A row left `open` at sign-off is a silent omission, not a forgotten cell.
4. **External-source URLs.** Sentry / Render / Cloudflare URLs sometimes resolve to authenticated content — they may leak the auditor's session or short-lived tokens. The contract requires source-by-name + timestamp instead.
5. **Secret-handling buried in a Finding.** SH-NN entries live here, in §7, AND in their corresponding Finding. Putting them only in Findings makes the rotation list hard to compile (operations needs a single list, not a scavenger hunt).
6. **"Trust me" evidence.** "We checked X and it's fine" without an EN is not evidence; it is unverifiable assertion. Either there is an EN or there is no claim.
