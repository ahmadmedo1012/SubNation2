# Implementation Plan: SubNation Security & Vulnerability Assessment

**Branch**: `004-security-audit` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-security-audit/spec.md`

## Summary

Design how the SubNation security audit will be **conducted** and **delivered**. The audit itself is a read-only inspection of the repository, committed configuration, and any logs the auditor already has read access to; nothing in production is changed. This plan fixes the methodology, the evidence-citation format, the finding template (including the proven / likely / hypothesis classification mandated by spec FR-021), the severity scale, the ranking method, and the four deliverable shapes — so that `/speckit-tasks` can decompose the work into ordered audit tasks and `/speckit-implement` can produce decision-grade outputs.

This plan is documentation work. It introduces no runtime code, no migrations, no infrastructure changes, and no production probes (spec FR-040 / FR-041 / FR-042). The deliverables are four Markdown files in `specs/004-security-audit/`: `security.md`, `research.md`, `priorities.md`, and `quickstart.md`.

## Technical Context

The "stack" of this feature is the human-readable documentation that the audit produces and the read-only tooling used to gather evidence. There is no application code, no service, no schema change.

- **Language/Version**: English Markdown (CommonMark, GitHub-flavored). Matches the existing `specs/` directory convention. Translation to Arabic is out of scope per spec Assumptions §8 — see Constitution Check below for the deliberate, justified deviation from Constitution → Domain Constraints → Arabic-First (RTL) UX.
- **Primary Dependencies**: Read-only tooling already available in the developer environment — `git`, `grep`/`ripgrep`, repository browsing, the existing Drizzle schema files, the existing OpenAPI document at `shared/api-spec/`, environment-variable templates at `config/env.example`, the Render service definitions, and the Husky/lint-staged config that gates this branch. No new runtime dependencies are introduced; no new development dependencies are introduced.
- **Storage**: Filesystem Markdown only. The audit does not write to PostgreSQL, Redis, or any external store. Evidence citations point to file paths in the repo at the audit's pinned commit reference (`004-security-audit` HEAD at audit time).
- **Testing**: Validation is performed against the spec's requirements checklist (`specs/004-security-audit/checklists/requirements.md`) and reviewer spot-checks per spec SC-005 (≥10% of findings spot-checked) and SC-007 (3 random findings re-verified by an independent reviewer using only `quickstart.md` + `research.md`). No automated test suite is added; the existing SubNation test suite is unaffected.
- **Target Platform**: Human readers — product owner / leadership (User Story 1), engineers (User Story 2), planners (User Story 3), reviewers (User Story 4). Renders correctly in any GitHub-flavored Markdown viewer.
- **Project Type**: Documentation / audit deliverable. Single feature directory under `specs/`. No `backend/`, `frontend/`, `worker/`, or `shared/*` files are added or modified.
- **Performance Goals** (operationalized from spec Success Criteria):
  - Stakeholder can answer the four leadership questions (posture / top three risks / urgent / explicit non-issues) in **≤ 5 minutes** of reading the executive summary + threat model only — spec SC-001.
  - Engineer can locate, describe, and sketch a remediation for any randomly chosen finding without doing additional discovery — spec SC-002, with three random spot-checks before the audit is signed off.
  - Independent reviewer can verify or refute three random findings using only `quickstart.md` + `research.md`, without contacting the audit author — spec SC-007.
  - Planner can produce a hardening sprint plan from `priorities.md` alone — spec SC-006.
- **Constraints**:
  - **No code, no migrations, no infra change** — spec FR-040.
  - **No state-changing probes** of production or shared environments (no wallet writes, no admin-action invocations, no auth-state mutations) — spec FR-041.
  - **No secret values reproduced** in any deliverable; secret types and locations may appear, values may not — spec FR-042.
  - **Evidence-grounded only**: every claim cites a code path / config excerpt / observed behavior, or it is excluded or labelled hypothesis — spec FR-022, FR-043.
  - **Pinned baseline**: every code citation is interpretable against `004-security-audit` HEAD at the time the audit's `security.md` is finalized — spec FR-023.
  - **No large rewrites** recommended unless the finding explicitly justifies why a smaller fix is insufficient — spec FR-024.
- **Scale/Scope**:
  - Coverage subsystems mandated by spec FR-001: **6 subsystem groups, ~12 named surfaces** — Authentication (Google, Telegram, OpenWA OTP, sessions/cookies/JWTs, account linking), Authorization (admin / user / order / wallet / product endpoints, RBAC, IDOR), Wallet & Financial Integrity (top-ups, approval, balance, ledger, coupons, purchase, refund/adjustment, replay/double-spend/race), API & Input Handling (validation, query params, route protection, CSRF, CORS, open redirects, unsafe URLs, webhooks, provider callbacks), Infrastructure & Deployment (Render config, Neon, Redis, Cloudflare Tunnel/WAF, env vars, secrets, logging/Sentry, rate limits, health endpoints), Frontend (client auth state, unsafe rendering, dynamic HTML/markdown, image URLs, external links, XSS, sensitive-data exposure, admin-only data leakage), Supply Chain & Operational Security (dependencies, build/runtime assumptions, hidden debug paths, obsolete endpoints, diagnostic logs, leftover testing hooks).
  - Each subsystem MUST resolve to one of: ≥1 finding, an explicit non-issue note, or a coverage gap — spec FR-002, SC-003.
  - Expected volume: roughly 30–60 distinct findings + non-issues + gaps across the four deliverables. The audit is not budget-constrained on output volume; it is budget-constrained on **evidence quality** (FR-021, FR-023).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

The Constitution governs **what SubNation builds and ships**. This feature ships nothing executable; it ships documentation about what is already shipped. The relevant gates are about whether the audit itself respects the same principles that the codebase is held to. Each is evaluated against the audit's behavior, not the system under audit.

- **I. Financial Integrity (NON-NEGOTIABLE)** — The audit observes wallet, ledger, coupon, refund, and purchase code paths read-only. It does not introduce code that touches the purchase transaction or the append-only ledger. Spec FR-040 / FR-041 forbid any state change, including any wallet mutation, in any environment. Findings about ledger correctness will be classified per spec FR-021 (proven / likely / hypothesis); a hypothesis will record the proof-of-concept that would confirm it but will **not** execute the proof-of-concept against a real ledger. ✅ **PASS**.
- **II. Passwordless Customer Auth** — No new auth path is introduced. The audit reads Google, Telegram, OpenWA OTP, session/cookie/JWT, and account-linking code paths. Findings about auth weaknesses are recorded with severity, evidence, and remediation direction; they are not implemented in this branch. ✅ **PASS**.
- **III. Shared Contracts (API-First)** — The "contracts" produced by this plan (under `specs/004-security-audit/contracts/`) are **document-shape contracts**, not API contracts. They specify the structure of `security.md`, `research.md`, `priorities.md`, and `quickstart.md`, plus the structure of a single `Finding`. They do **not** touch `shared/api-spec/`, `shared/api-zod/`, or `shared/api-client-react/`, and they impose no requirement on those packages. A reader looking for OpenAPI under `contracts/` will not find one — that absence is intentional and is documented in the contracts directory's README. ✅ **PASS** (with note).
- **IV. Defense in Depth** — The audit assesses the existing defense-in-depth layers (Helmet/CSP, CORS allow-list, Origin/Referer CSRF check, multi-tier Redis rate limit, AES-256-GCM credential encryption, logger redaction, fail-fast secret validation). It does not weaken or strengthen any layer in this branch; remediations are recommendations for a future, separately authorized branch. ✅ **PASS**.
- **V. Observability & Operational Readiness** — The audit reads existing logging, metrics, alerting, and migration code paths but does not modify them. It does not add log lines, metrics, or alerts. Sentry, `prom-client`, and `/api/healthz` are subjects of inspection, not modification. ✅ **PASS**.

**Domain Constraint — Arabic-First (RTL) UX (deliberate, justified deviation):** the Constitution requires customer-facing copy to be authored in Arabic first. The audit deliverables (`security.md`, `research.md`, `priorities.md`, `quickstart.md`) are **not customer-facing** — they are internal documents for SubNation's product owner, engineering, and authorized reviewers (spec Assumptions §7). They describe attack paths and are explicitly not for external publication. Translating them adds zero stakeholder value and meaningfully increases the risk of inconsistency between the two language versions of the same finding. This deviation is recorded in Complexity Tracking below and dismissed as not requiring justification cost; if leadership later wants an Arabic executive summary for a non-engineering audience, that is a follow-up, separately scoped task.

**Domain Constraint — Stack & Deployment Shape:** unaffected. The audit does not change toolchain, runtime, deploy shape, or git-ignore policy. It does not add files to `ruflo/`, `.swarm/`, `.claude-flow/` or any optional dev-tooling path.

**Development Workflow:** the branch follows the existing `###-feature-name` convention (`004-security-audit`). The branch does not require migrations, OpenAPI regeneration, or `shared/api-zod` updates — those gates are non-applicable to a documentation feature. Lint-staged + Prettier + gitleaks pre-commit hooks DO apply (and have already run, normalizing italics from `*` to `_` in the spec). The audit will not bypass hooks (`--no-verify` is forbidden by the user's standing project preference and matches the Constitution's pre-commit posture).

**Code Review Checklist:** a code reviewer for this branch is verifying **document quality**, not security/RTL/ledger/rate-limit correctness — those checklists apply to remediation branches, not to the audit's documentation. Reviewers of this branch confirm: (a) every spec FR is satisfied by the deliverables, (b) every finding carries the required fields and a proven/likely/hypothesis classification, (c) every code citation resolves at the pinned commit, (d) zero secret values appear in the text.

**Re-evaluation after Phase 1 design**: see [Post-Design Constitution Re-Check](#post-design-constitution-re-check) at the bottom of this plan.

## Project Structure

### Documentation (this feature)

```text
specs/004-security-audit/
├── plan.md                              # This file
├── research.md                          # Phase 0 — methodology decisions, severity calibration,
│                                        #   FR-001 coverage matrix; later re-used as the
│                                        #   audit's evidence notebook (per spec FR-014).
├── data-model.md                        # Phase 1 — formal entities (Finding, Threat Actor,
│                                        #   Asset, Trust Boundary, Coverage Item, Risk Score,
│                                        #   Evidence Note, Recommendation) with attributes,
│                                        #   relationships, and enumerations.
├── contracts/
│   ├── README.md                        # Why these are document-shape contracts, not API
│   │                                    #   contracts; intentional non-touch of shared/api-*.
│   ├── finding.contract.md              # Required fields and shape of a single Finding.
│   ├── security-md.contract.md          # Required structure of security.md (exec summary →
│   │                                    #   threat model → findings → ranking → quick wins
│   │                                    #   vs. structural → explicit non-issues).
│   ├── research-md.contract.md          # Required structure of research.md (per-claim
│   │                                    #   evidence keyed back to findings).
│   ├── priorities-md.contract.md        # Required structure of priorities.md (every finding
│   │                                    #   ranked by 5 inputs; partition into quick win /
│   │                                    #   structural / deferred).
│   └── quickstart-md.contract.md        # Required structure of quickstart.md (how the audit
│                                        #   was conducted; how to verify a finding).
├── quickstart.md                        # Phase 1 — *plan-validation* quickstart: how to
│                                        #   confirm THIS PLAN is correct before /speckit-tasks.
│                                        #   /speckit-implement will write the AUDIT's
│                                        #   quickstart.md as a deliverable separately
│                                        #   (overwriting this file is acceptable — see below).
├── checklists/
│   └── requirements.md                  # (already exists from /speckit-specify)
├── spec.md                              # (already exists from /speckit-specify)
└── tasks.md                             # Phase 2 — written by /speckit-tasks (NOT this command)
```

**Note on `quickstart.md`**: there is a deliberate naming collision. The plan template specifies a Phase 1 `quickstart.md` for plan validation, and spec FR-016 mandates a `quickstart.md` as one of the four audit deliverables. Both live at `specs/004-security-audit/quickstart.md`. Resolution: the file written here in Phase 1 documents how to verify _the plan_; when `/speckit-implement` runs, it overwrites the file with the _audit-deliverable_ quickstart per FR-016. The plan-validation quickstart is short-lived scaffolding by design — its job ends when the plan is reviewed.

### Source Code (repository root)

```text
# This feature ships no source code.
# No file outside specs/004-security-audit/ is created or modified by /speckit-plan,
# except for CLAUDE.md, where the SPECKIT-managed pointer is updated to reference
# specs/004-security-audit/plan.md (Phase 1 step 3, per the plan-template workflow).
```

**Structure Decision**: documentation-only. The audit lives entirely under `specs/004-security-audit/`. The pinned audit baseline is the `004-security-audit` branch HEAD at the moment `security.md` is finalized — that commit reference will be recorded in `quickstart.md` when `/speckit-implement` runs.

## Audit Methodology (this is the design Phase 0 + Phase 1 produce)

The audit proceeds in three internal stages, each producing visible artifacts:

1. **Coverage scaffolding** (Phase 0 of `/speckit-implement`, not of this plan) — every subsystem in spec FR-001 is enumerated as a row in a coverage matrix in `research.md`. Each row stays open until it carries one of: ≥1 finding ID, a non-issue note, or a coverage-gap note. This is what makes spec SC-003 enforceable rather than aspirational.
2. **Evidence gathering** — for each in-scope subsystem, the auditor reads the relevant source paths read-only, records observations in `research.md` as Evidence Notes (one note = one observation, with file path + line range or commit-pinned excerpt + behavior description). Evidence Notes are keyed by ID (`EN-001`, `EN-002`, …) and findings cite the EN-IDs. This makes spec FR-014 mechanically verifiable.
3. **Finding catalog** — for each cluster of converging Evidence Notes, a Finding is opened in `security.md`. Every Finding carries the required fields (spec FR-020), a proven / likely / hypothesis classification on each claim (spec FR-021), a severity from the 4-tier scale defined once in `security.md` (spec FR-050), and a single recommendation sized as quick win / structural / deferred (spec entity definition). The same Finding ID then appears in `priorities.md` with the five ranking inputs (severity × likelihood × blast radius × ease × business impact, per spec FR-051).

**Severity scale (defined once, used everywhere)** — Critical / High / Medium / Low. Calibration is recorded in `research.md` so the rating is auditable, not subjective:

- **Critical** — direct, currently exploitable path to: full account takeover at scale, ledger corruption, admin-state mutation by an unauthenticated user, or production secret exfiltration. Urgency = urgent.
- **High** — exploitable by a low-privileged authenticated user with realistic effort, OR a confirmed weakness in a defense-in-depth layer that is the primary control for an asset. Urgency = urgent (for finance/auth/admin) or can-wait (otherwise).
- **Medium** — exploitable only with non-trivial effort or chained conditions, or a defense-in-depth weakness with a redundant layer in front of it. Urgency = can-wait.
- **Low** — best-practice deviation with no current exploit path, or hardening opportunity. Urgency = can-wait or deferred.

**Hypothesis discipline** — a Finding marked hypothesis MUST record the specific proof-of-concept that would confirm it AND state why the audit did not run that PoC (typically: it would change state, would touch production, or requires access the auditor does not have). Hypotheses are not promoted to "likely" without the converging-signals test (spec FR-021); they are not promoted to "proven" without reproduction at the pinned commit.

**Coverage-gap discipline** — when a surface cannot be fully reached without additional access (e.g., the OpenWA host's internal config, the Cloudflare Tunnel edge rules, the Telegram bot platform's internal trust model), the row stays in the coverage matrix as a gap. The gap entry MUST name (a) the assumption the audit is making about the boundary's behavior, (b) the access that would be required to close the gap, and (c) the worst-case finding that would be unmasked if the assumption is wrong. This satisfies spec FR-032.

**Secret-handling discipline** — if a secret value is encountered in source, history, logs, or config, the Finding MUST record: secret type, location (path or log channel), and a recommendation to rotate. The Finding MUST NOT reproduce the value, paste an excerpt that contains the value, or reference a Sentry/Render URL that resolves to the value. This satisfies spec FR-042 and spec SC-008. A pre-publish scan of all four deliverables for high-entropy strings is part of the audit's done-when criteria.

## Phase 0: Outline & Research — what `research.md` will contain

`research.md` produced by this command is the **methodology document plus an empty-but-structured evidence notebook**. The methodology decisions are made now; the evidence rows are filled in by `/speckit-implement`.

Methodology decisions to lock in (each as Decision / Rationale / Alternatives Considered):

- **Severity scale = 4 tiers** (Critical / High / Medium / Low). Not CVSS. Calibrated above.
- **Classification = 3 tiers** (proven / likely / hypothesis). Per-claim, not per-finding — a finding may carry one proven claim and one hypothesis claim simultaneously.
- **Evidence-citation format** = Markdown link `path/to/file.ts:42–58` + 1–3 line excerpt block + behavior description; commit reference recorded once in `quickstart.md` rather than on every citation. Excerpts MUST exclude any secret value.
- **Finding ID scheme** = `F-NNN` zero-padded; stable across `security.md`, `priorities.md`, and `research.md` so cross-doc references survive renumbering. EN-IDs (Evidence Notes) and CG-IDs (Coverage Gaps) follow the same pattern.
- **Coverage matrix** = Table in `research.md` § "Coverage". Columns: subsystem, surface, status (open / covered / gap), Finding IDs, EN-IDs, CG-IDs, last-reviewed-at. The matrix closes spec FR-002 and spec SC-003 mechanically.
- **Reviewer-spot-check protocol** = the random sample for spec SC-005 is drawn against the final Finding list at audit sign-off; spot-check passes iff (a) cited path resolves, (b) cited behavior is present at the pinned commit, (c) classification is consistent with the evidence in `research.md`. Any failure halts sign-off.
- **No automated probes**: the audit will not run scripted requests against any environment. Static and configuration analysis only. `git log -p` and `git show` are permitted because they are read-only against the repo.
- **Out-of-repo scope**: Render dashboard, Cloudflare dashboard, Sentry dashboard, Neon console — accessed only if the auditor has pre-existing read credentials, and only for read-only inspection. Findings derived from those sources cite the source by name and timestamp; they do not embed dashboard URLs that may resolve to authenticated content.

**Output of Phase 0**: `research.md` with all methodology decisions locked + the coverage matrix template + the Evidence Notebook template, ready for `/speckit-implement` to populate.

## Phase 1: Design & Contracts — what `data-model.md`, `contracts/`, and `quickstart.md` will contain

`data-model.md` formalizes the eight entities the spec defined informally (Finding, Threat Actor, Asset, Trust Boundary, Coverage Item, Risk Score, Evidence Note, Recommendation) so that `/speckit-tasks` and `/speckit-implement` cannot drift from the spec when generating the deliverables. Each entity gets: required attributes, optional attributes, relationships to other entities, enumerations, and validation rules drawn from the spec FRs.

`contracts/` holds five **document-shape contracts**:

- `finding.contract.md` — the canonical structure of a single Finding (title, severity, subsystem, exploitability, impact, evidence (list of EN-IDs), reproduction-or-hypothesis, recommendation, urgency, classification per claim). This is the contract `/speckit-implement` MUST satisfy when writing each finding in `security.md`.
- `security-md.contract.md` — the section order of `security.md` mandated by spec FR-011 (executive summary → threat model → findings → risk ranking → quick wins vs. structural → explicit non-issues).
- `research-md.contract.md` — the section order of `research.md` (methodology decisions → severity calibration → coverage matrix → evidence notebook → external-source notes → secret-handling log).
- `priorities-md.contract.md` — the section order of `priorities.md` (ranking method → ranked table → quick wins → structural hardening → deferred items, each with one-line rationale).
- `quickstart-md.contract.md` — the section order of the audit-deliverable `quickstart.md` (audit baseline / pinned commit → how the audit was scoped → how the four documents relate → step-by-step finding-verification protocol → reviewer spot-check protocol).
- `README.md` — explains why these contracts are documents not APIs and why `shared/api-*` is intentionally not touched.

`quickstart.md` (this Phase 1's output, plan-validation flavor) tells the reader how to confirm the plan is correct before running `/speckit-tasks`.

**Output of Phase 1**: `data-model.md`, `contracts/*`, plan-validation `quickstart.md`, and an updated `CLAUDE.md` pointer.

## Post-Design Constitution Re-Check

After Phase 1 design, all five Constitution principles still PASS for the same reasons recorded above — the design does not introduce code, does not modify shared contracts in `shared/api-*`, does not change observability, does not weaken financial integrity, and does not introduce a new auth path. The Arabic-First deviation remains the single justified deviation, and it is dismissed as not requiring complexity-cost because the deliverables are not customer-facing. ✅ **GATE PASSES**.

## Complexity Tracking

| Violation                                                                                               | Why Needed                                                                                                                                                                                              | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit deliverables in English only (deviation from Constitution → Domain Constraints → Arabic-First UX) | Deliverables are internal-only documents for SubNation's product owner, engineering, and authorized reviewers (spec Assumptions §7). They describe attack paths and are explicitly not customer-facing. | An Arabic translation produces no stakeholder value here, doubles maintenance, and risks per-finding inconsistency between the two language versions. If leadership later wants an Arabic executive summary for a non-engineering audience, that is a follow-up task, separately scoped — not a hidden requirement of this audit. |
| Plan-validation `quickstart.md` shares a path with the audit-deliverable `quickstart.md`                | Spec FR-016 requires a `quickstart.md` deliverable; the plan template requires a Phase 1 `quickstart.md`.                                                                                               | Renaming either file desynchronizes a SPECKIT-template expectation. The collision is resolved by lifecycle: plan-validation quickstart is scaffolding, audit-deliverable quickstart overwrites it during `/speckit-implement`. The handoff is recorded in the Project Structure note above.                                       |
