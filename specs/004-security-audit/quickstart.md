# SubNation Security Audit — Quickstart

**Audience**: independent reviewer or future auditor.
**Audit baseline**: branch `004-security-audit` @ `1711081c4cbd1bddddf4408479e365aaccb3c23e` (short: `1711081`) — every code citation in this audit resolves at this exact commit.
**Audit window**: 2026-06-02 (single-day audit).
**Auditor**: Claude (Opus 4.7) on behalf of repo owner.
**Distribution**: internal only — product owner, engineering, authorized reviewers.

> This file replaces the plan-validation `quickstart.md` written during `/speckit-plan`. The collision is intentional and documented in [`plan.md`](./plan.md) → "Project Structure".

---

## 1. How the audit was scoped

Spec [`spec.md`](./spec.md) FR-001 enumerates 47 surfaces across six subsystem groups (Authentication, Authorization, Wallet & Financial Integrity, API & Input Handling, Infrastructure & Deployment, Frontend Security, Supply Chain & Operational). Every surface MUST resolve at sign-off as one of: ≥ 1 Finding (`F-NNN`), an explicit non-issue (`security.md` §6), or a coverage gap (`CG-NN` in [`research.md`](./research.md) §6). At publish, **45 of 47** surfaces closed as Findings or non-issues; **2 of 47** closed as coverage gaps (SUP-1: full automated CVE scan; INFRA-4: live Cloudflare WAF rules).

In-repo surfaces were inspected end-to-end by reading committed source at the pinned commit. Out-of-repo surfaces (Render dashboard, Cloudflare dashboard, Sentry org, Neon console) are recorded as coverage gaps because this audit had no live dashboard credentials. A future audit pass with read access can promote these gaps.

The audit deliberately did not cover: any UX/SEO improvement work outside security's scope, any prior spec (`001-ai-opportunity-assessment`, `003-anomaly-detection`) except where the same code path was being audited, the OpenWA host's _internal_ configuration (we audit the SubNation side of that boundary; see CG-04-style note for OpenWA in `research.md`), and any code that landed during the audit window itself — those would shift the pinned-commit baseline.

## 2. How the audit was conducted

Read-only inspection of the SubNation repo at the pinned commit. The auditor used:

- File reads (`backend/src/**`, `frontend/src/**`, `shared/**`, `config/env.example`, `Dockerfile`, `render.yaml`, `.gitleaks.toml`, `.github/workflows/ci.yml`, root `package.json`, `pnpm-lock.yaml`).
- `git grep` and `git log -p` (read-only against the repository).
- Cross-reference of code paths against the SubNation Constitution at `.specify/memory/constitution.md`.
- Drizzle schema review under `shared/db/src/schema/` for ledger-shape claims.
- Test-file inspection (`backend/src/**/__tests__/`) where existing coverage validates a non-issue.

The auditor did **not**:

- Execute any HTTP request, WebSocket connection, or scripted probe against any environment (production, staging, or local-with-shared-state) — FR-041.
- Run wallet writes, admin-action invocations, auth-state mutations, or any other state-changing operation in any environment — FR-041.
- Rotate any secret — FR-042.
- Modify any code, configuration, migration, or production behavior — FR-040.
- Reproduce any secret value in any deliverable — FR-042 (the Secret-Handling Log in `research.md` §7 is empty by observation, not by omission).

**Severity calibration** is locked in `research.md` §2 (Critical / High / Medium / Low with explicit anchors). **Per-claim classification** uses `proven` / `likely` / `hypothesis` per `research.md` §1 D-10, with `≥ 2 converging signals` required to promote a claim from `hypothesis` to `likely`, and read-only reproduction at the pinned commit required to promote `likely` to `proven`. Race-condition findings whose reproduction would mutate the ledger are explicitly classified `hypothesis` per FR-021.

## 3. How the four documents relate

```
                 ┌─────────────────────┐
                 │     security.md     │   ← what's wrong, why, how to fix
                 │   (Findings F-NNN)  │       Stakeholder + engineer.
                 └──────────┬──────────┘
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
  │   research.md   │  │ priorities   │  │  quickstart  │
  │   (Evidence     │  │     .md      │  │     .md      │
  │   EN/CG/SH)     │  │  (Risk Score │  │  (THIS file) │
  │ Reviewer + dev. │  │   ranking)   │  │  Reviewer.   │
  └─────────────────┘  └──────────────┘  └──────────────┘
   What we saw, where  How to sequence   How to verify
   exactly, why we     remediation work  the other three
   didn't run state-   into a sprint.
   changing PoCs.
```

- **`security.md`** — the canonical Findings catalog (`F-001` … `F-012`), threat model, executive summary, explicit non-issues. Engineer-readable; leadership-readable in §1 / §2 / §6.
- **`research.md`** — methodology decisions D-01..D-10, severity calibration §2, coverage matrix §3 (47 rows, all closed), evidence notebook §4 (every `EN-NNN` cited by Findings), external-source notes §5 (empty for this audit), coverage gaps §6 (`CG-01` … `CG-08`), secret-handling log §7 (empty by observation), done-when checklist §8.
- **`priorities.md`** — every `F-NNN` ranked by five inputs (severity / likelihood / blast radius / ease / business impact); partitioned into Quick Wins (`Q-NN`), Structural Hardening (`S-NN`), Deferred Items (none in this audit); cross-document consistency check at §6.
- **`quickstart.md`** — this file. How to verify any single Finding without contacting the auditor.

## 4. Step-by-step: how to verify a Finding

For any single `F-NNN`:

1. Open [`security.md`](./security.md) §3, locate `F-NNN`.
2. Note the Finding's **Severity**, **Subsystem**, **Exploitability**, and the **Reproduction or Hypothesis** block.
3. For every entry under **Claims**, follow each `EN-NNN` reference into [`research.md`](./research.md) §4.
4. For each `EN-NNN`, run `git show 1711081:<path>` and confirm the cited line range still resolves (it should — the audit pinned to this commit). If the path was renamed or removed _since_ the pinned commit, that is expected drift; the citation refers to the pinned snapshot, not current `HEAD`.
5. Read the EN's behavior description and confirm it matches what you see at the cited lines.
6. Re-classify the claim independently: would _you_ call it `proven`, `likely`, or `hypothesis` per the rules in [`research.md`](./research.md) §1 D-10? Compare to the Finding's labeled classification.
7. If the claim is `hypothesis`, read the **Reproduction or Hypothesis** block's `whatWouldConfirm` and `whyNotRun` fields. Decide whether the audit's reason for not running the PoC holds (typical reason: "would mutate the append-only ledger" — FR-041).
8. Open [`priorities.md`](./priorities.md) §2; locate the same `F-NNN`. Confirm severity matches `security.md` (FR-052 / VR-RS-02). Confirm the partition (`quick-win` / `structural` / `deferred`) is consistent with the urgency in `security.md`.
9. Record your verdict: agree / disagree / needs-discussion. If disagree, name which step (1–8) failed.

## 5. Reviewer spot-check protocol (closes SC-005 / SC-007)

Per `research.md` §1 D-06, locked at plan time:

- **Sample size**: 10% of Findings, **minimum 3**. With 12 Findings in this audit, sample size is 3 (10% × 12 = 1.2, floor to 1, raised to the minimum 3).
- **Sampling method**: drawn uniformly at random against the finalized Finding list.
- **Pass criteria**: for each sampled Finding, all of (a) every cited path resolves at the pinned commit, (b) every cited behavior is present at the pinned commit, (c) per-claim classification consistent with the linked Evidence Notes.
- **Failure handling**: any single failure halts sign-off. The auditor returns to the affected Finding, repairs the issue, then a _new_ sample is drawn (no cherry-picking).
- **Independence**: the reviewer is not the auditor.

The audit's own self-spot-check (auditor reviewing their own work) is recorded in `research.md` §8 with explicit "self" labeling. It does **not** satisfy SC-005 / SC-007 — those require an independent reviewer. Sign-off marks the audit as content-complete; SC-005 / SC-007 closure waits on the independent pass.

## 6. Pinned commit reference

**Commit hash**: `1711081c4cbd1bddddf4408479e365aaccb3c23e`
**Short**: `1711081`
**Branch at audit**: `004-security-audit`

**Recommended reproduction commands**:

```bash
# Fetch the audited branch
git fetch origin 004-security-audit

# Check out the exact pinned commit (detached head; no edits possible)
git checkout 1711081c4cbd1bddddf4408479e365aaccb3c23e

# Verify a single citation
git show 1711081:backend/src/lib/jwt.ts | sed -n '20,25p'

# Or, with the auditor's repo cloned, just look up the line
sed -n '20,25p' backend/src/lib/jwt.ts
```

Every `F-NNN` finding's cited paths resolve at this revision exactly. If a citation does not resolve, the audit drift-protected against this case (FR-023), and a re-pin is required before re-publishing.

## 7. What this audit did NOT do

Listed explicitly so the absence of an action is not mis-cited as a "we already covered that":

- **No code changes.** No `.ts`, `.tsx`, `.json`, schema, or migration files were modified. Remediation work happens on a future, separately-authorized branch — not on `004-security-audit`. (FR-040.)
- **No state-changing probes.** No HTTP request, WebSocket, or scripted operation was executed against production, staging, or any environment. (FR-041.)
- **No secret rotation.** Recommendations to rotate secrets are findings; rotation is operations work and follows audit acceptance. (FR-042.)
- **No production access** beyond what the auditor already held (the SubNation repo). The audit did not request, receive, or use new credentials.
- **No remediation work.** This branch ships documentation. The next branch (post-acceptance) ships fixes; that branch will reference this audit's pinned commit and `F-NNN` IDs but will not modify the audit deliverables.
- **No reproduction of any secret value.** The Secret-Handling Log in `research.md` §7 is empty _by observation_ — the auditor scanned for committed secrets and found none. If a secret had been found, it would have been recorded as a `SH-NN` entry naming type and location only, never the value (FR-042 / SC-008).

This section's purpose: protect the audit's scope. "We audited the system" does not mean "we ran every test"; it means "we read every committed surface end-to-end without changing anything."

## 8. How to use the audit for a future hardening sprint

**The intended flow** when leadership has authorized remediation:

1. Read [`security.md`](./security.md) §1 (executive summary) + §2 (threat model) — 5 minutes, leadership-readable.
2. Read [`priorities.md`](./priorities.md) end-to-end — 15–20 minutes, planner-readable. Fill the sprint with §3 Quick Wins first; queue §4 Structural Hardening next; ignore §5 Deferred unless its triggering condition has fired.
3. For each Finding being remediated, open the same `F-NNN` in `security.md` §3 and read the **Recommendation** block. The Direction field is design-level (not a code diff) — the implementing engineer translates direction into commits.
4. Implementation work happens on a fresh branch (e.g., `005-security-fixes-batch-1`), not on `004-security-audit`. The remediation branch references this audit's pinned commit and the `F-NNN` IDs in commit messages. The audit deliverables are _not_ edited by remediation work — the audit is the snapshot the remediation references.
5. After remediation lands, schedule a follow-up audit (`006-security-audit-followup`) that re-runs against the new commit and either confirms the Finding is closed or files a new Finding for any regression.

**Coverage-gap follow-ups** (`CG-01` … `CG-08`) are not blocked on remediation. They are independent: each gap names the access required and the worst-case if its assumption is wrong. Closing them is a tooling or access task, not a fix.

## Appendix A — Finding index

| Finding | Severity     | Subsystem  | Title                                                     |
| ------- | ------------ | ---------- | --------------------------------------------------------- |
| F-001   | High         | AUTH-5     | Admin JWT signing key derived from customer secret        |
| F-002   | High         | AUTH-1     | `verifyFirebaseIdToken` silently ignores `checkRevoked`   |
| F-003   | Medium       | AUTH-7     | Account linking auto-completes without explicit consent   |
| F-004   | **Critical** | WALLET-3/6 | Admin wallet adjustment bypasses ledger and transaction   |
| F-005   | **Critical** | WALLET-3/6 | Admin order-refund does not credit wallet or write ledger |
| F-006   | High         | WALLET-4   | Coupon `maxUses` race                                     |
| F-007   | High         | WALLET-1/2 | Topup approval lacks optimistic lock on wallet balance    |
| F-008   | High         | WALLET-7   | Admin wallet adjustment lacks idempotency key             |
| F-009   | Medium       | API-4      | CSRF check disabled outside production                    |
| F-010   | Low          | API-7      | JWT in redirect URL query string                          |
| F-011   | Medium       | SUP-2      | Dockerfile runtime stage runs as root                     |
| F-012   | Low          | INFRA-7    | Logger / Sentry redaction not unit-tested                 |

## Appendix B — Coverage-gap index

| Gap   | Subsystem | Access required to close                                                                       |
| ----- | --------- | ---------------------------------------------------------------------------------------------- |
| CG-01 | SUP-1     | Automated CVE scanner in CI (`npm audit` / `snyk` / `osv-scanner`)                             |
| CG-02 | SUP-6     | Review of gitleaks default rules + sandbox test commit for `SESSION_SECRET` / `ENCRYPTION_KEY` |
| CG-03 | AUTH-2    | Frontend deep-read of Telegram OAuth completion                                                |
| CG-04 | INFRA-4   | Cloudflare dashboard read-only access                                                          |
| CG-05 | INFRA-2   | Neon console read-only access                                                                  |
| CG-06 | INFRA-7   | Sentry org admin read access                                                                   |
| CG-07 | INFRA-1   | Render dashboard read-only on the SubNation account                                            |
| CG-08 | AUTH-7    | Frontend deep-read of post-OAuth account-linking flow                                          |

## Appendix C — Document map

- [`spec.md`](./spec.md) — feature specification (4 user stories, FR-001..FR-052, SC-001..SC-010)
- [`plan.md`](./plan.md) — audit methodology + Constitution Check
- [`research.md`](./research.md) — methodology decisions, severity calibration, coverage matrix, evidence notebook, gaps, secrets log, done-when
- [`data-model.md`](./data-model.md) — 8 entities, validation rules, closure conditions C-01..C-08
- [`contracts/`](./contracts/) — document-shape contracts (one per deliverable + `finding.contract.md` + `README.md`)
- [`tasks.md`](./tasks.md) — audit-execution task list (Phase 1 setup → Phase 7 sign-off)
- [`checklists/requirements.md`](./checklists/requirements.md) — spec quality checklist
- [`security.md`](./security.md) — **the audit's primary deliverable** (Findings catalog)
- [`priorities.md`](./priorities.md) — ranked remediation plan
- [`quickstart.md`](./quickstart.md) — **this file**
