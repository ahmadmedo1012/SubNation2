# Plan-Validation Quickstart

**Lifecycle note**: this is **plan-phase scaffolding** — its job is to help a reader confirm that the plan in [`plan.md`](./plan.md) is correct before `/speckit-tasks` runs. It is **not** the audit-deliverable `quickstart.md` mandated by spec FR-016. When `/speckit-implement` runs, it will overwrite this file with the audit-deliverable form per [`contracts/quickstart-md.contract.md`](./contracts/quickstart-md.contract.md). This collision is documented in `plan.md` → "Project Structure" and `Complexity Tracking`.

**Audience**: a reviewer (or future-you) deciding whether to proceed to `/speckit-tasks`.

**Time-to-validate**: ~15 minutes.

---

## What you should be able to confirm

After reading the plan and its companion artifacts, you should be able to answer **yes** to every one of the following. A **no** anywhere is a signal to revise the plan before `/speckit-tasks`.

### A. Scope discipline

- [ ] **A-1.** The plan's "Audit Methodology" section makes it impossible for the audit to ship code, change configuration, mutate state, or rotate secrets — the plan re-asserts spec FR-040 / FR-041 / FR-042 in concrete terms.
- [ ] **A-2.** The plan does not depend on any new runtime dependency, npm package, migration, or environment-variable change. Search `plan.md` for `pnpm`, `npm`, `migration`, `drizzle-kit` — there should be no instructions to add anything.
- [ ] **A-3.** The plan touches no source file outside `specs/004-security-audit/` except the SPECKIT-managed pointer block in `CLAUDE.md`. Run `git diff --stat main..HEAD` after `/speckit-plan` and confirm that is the case.

### B. Methodology completeness

- [ ] **B-1.** [`research.md`](./research.md) §1 records ten methodology decisions (D-01 … D-10), each with Decision / Rationale / Alternatives Considered.
- [ ] **B-2.** [`research.md`](./research.md) §2 defines exactly four severity tiers with explicit calibration anchors and a contested-severity resolution rule.
- [ ] **B-3.** [`research.md`](./research.md) §3 enumerates 47 coverage rows across 6 subsystem groups; each row carries `status: open` (Phase 0 baseline) and is ready for `/speckit-implement` to close.
- [ ] **B-4.** Per-claim classification (proven / likely / hypothesis) is the rule, not per-finding — confirm the Claim sub-entity in [`data-model.md`](./data-model.md) §1.1 and the claim format in [`contracts/finding.contract.md`](./contracts/finding.contract.md).

### C. Document-shape coverage

Every spec FR for deliverable structure has a contract that satisfies it:

- [ ] **C-1.** Spec FR-011 (`security.md` section order) ↔ [`contracts/security-md.contract.md`](./contracts/security-md.contract.md) "Required structure".
- [ ] **C-2.** Spec FR-012 (executive summary content) ↔ [`contracts/security-md.contract.md`](./contracts/security-md.contract.md) §1.
- [ ] **C-3.** Spec FR-013 (threat model content) ↔ [`contracts/security-md.contract.md`](./contracts/security-md.contract.md) §2.
- [ ] **C-4.** Spec FR-014 (`research.md` evidence) ↔ [`contracts/research-md.contract.md`](./contracts/research-md.contract.md) §4 + EN entity in [`data-model.md`](./data-model.md) §7.
- [ ] **C-5.** Spec FR-015 (`priorities.md` ranking + partition) ↔ [`contracts/priorities-md.contract.md`](./contracts/priorities-md.contract.md).
- [ ] **C-6.** Spec FR-016 (`quickstart.md` audit deliverable) ↔ [`contracts/quickstart-md.contract.md`](./contracts/quickstart-md.contract.md).
- [ ] **C-7.** Spec FR-020 (Finding required fields) ↔ [`contracts/finding.contract.md`](./contracts/finding.contract.md) "Required structure".
- [ ] **C-8.** Spec FR-030 (explicit non-issues section) ↔ [`contracts/security-md.contract.md`](./contracts/security-md.contract.md) §6.
- [ ] **C-9.** Spec FR-051 (five ranking inputs visible per finding) ↔ [`contracts/priorities-md.contract.md`](./contracts/priorities-md.contract.md) §2 table.

### D. Closure mechanisms (mechanical, not aspirational)

- [ ] **D-1.** Spec SC-003 (every scope subsystem appears) is closed by [`research.md`](./research.md) §3's coverage matrix — every row must transition out of `open` before sign-off.
- [ ] **D-2.** Spec SC-005 (≥10% spot-check, minimum 3) is closed by [`research.md`](./research.md) §1 D-06 reviewer protocol.
- [ ] **D-3.** Spec SC-007 (independent reviewer can verify findings) is closed by [`contracts/quickstart-md.contract.md`](./contracts/quickstart-md.contract.md) §4 (step-by-step verification procedure).
- [ ] **D-4.** Spec SC-008 (zero secret values in deliverables) is closed by [`research.md`](./research.md) §1 D-09 secret-handling discipline + the pre-publish entropy scan in [`research.md`](./research.md) §8 done-when checklist.
- [ ] **D-5.** Spec SC-009 (no large rewrites without justification) is closed by [`data-model.md`](./data-model.md) §1 VR-F-06 + [`contracts/finding.contract.md`](./contracts/finding.contract.md) Recommendation block.
- [ ] **D-6.** Spec FR-052 (severity matches across documents) is closed by [`data-model.md`](./data-model.md) §6 VR-RS-02 + [`contracts/priorities-md.contract.md`](./contracts/priorities-md.contract.md) §6 cross-document consistency check.

### E. Constitution alignment

- [ ] **E-1.** The plan's Constitution Check evaluates all five principles against the _audit's_ behavior, not the system under audit, and returns PASS for each — re-read [`plan.md`](./plan.md) → "Constitution Check".
- [ ] **E-2.** The single deviation (English-only deliverables vs. Arabic-First Domain Constraint) is recorded in [`plan.md`](./plan.md) → "Complexity Tracking" with Why Needed + Simpler Alternative Rejected.
- [ ] **E-3.** The plan does not call for any change to `shared/api-spec/`, `shared/api-zod/`, or `shared/api-client-react/` — confirm by reading [`contracts/README.md`](./contracts/README.md) "Why `shared/api-*` is intentionally not touched".

### F. Re-entrancy / handoff

- [ ] **F-1.** `/speckit-tasks` has enough material to decompose audit work into ordered tasks — every coverage matrix row is a candidate task; every contract is a definition-of-done for the task that produces its document.
- [ ] **F-2.** `/speckit-implement` has unambiguous structure to fill in — Finding template (one contract), Evidence Note template (one entity), Coverage Matrix (one table), severity calibration (one section). Two auditors running `/speckit-implement` against the same codebase should produce structurally identical deliverables.
- [ ] **F-3.** This file (`quickstart.md`) will be overwritten by `/speckit-implement`. The `quickstart.md` contract is satisfied at audit time, not at plan time. Do not over-invest in this file — it is scaffolding.

---

## What this checklist does NOT validate

- **Whether the audit will find anything.** That is `/speckit-implement`'s job. The plan only guarantees that, if findings exist, they will be recorded in a stakeholder-readable, reviewer-verifiable form.
- **Whether the SubNation codebase has Critical-severity issues.** The plan is methodology. It says nothing about outcomes.
- **Whether any specific subsystem is safe.** Coverage rows are `open` at this stage; the plan only commits to closing them, not to a particular verdict.

---

## If something fails

| Failure                                                  | What to revise                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **A-** failure (scope creep)                             | `plan.md` → re-tighten the "Audit Methodology" section against spec FR-040 / FR-041 / FR-042.                                          |
| **B-** failure (methodology gap)                         | `research.md` → add or sharpen the missing decision / calibration / matrix row.                                                        |
| **C-** failure (FR has no contract closure)              | `contracts/<file>` → add the missing section / field / validation rule.                                                                |
| **D-** failure (closure is aspirational, not mechanical) | The relevant artifact — make the closure rule something a reviewer can run, not something they have to interpret.                      |
| **E-** failure (Constitution mis-evaluation)             | `plan.md` → "Constitution Check" — re-evaluate the principle against the audit's behavior, not the system under audit.                 |
| **F-** failure (handoff unclear)                         | Trace the failure to the specific contract / entity / section that lacks the structure `/speckit-tasks` or `/speckit-implement` needs. |

---

## Proceed to `/speckit-tasks` when

Every item A-1 through F-3 is checked. At that point, the plan is durable enough to be decomposed into ordered audit tasks, and the audit itself can begin without re-litigating methodology.
