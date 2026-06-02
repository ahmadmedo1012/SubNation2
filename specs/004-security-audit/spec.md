# Feature Specification: SubNation Security & Vulnerability Assessment

**Feature Branch**: `004-security-audit`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Full security and vulnerability assessment for SubNation before any hardening work. Design-and-audit phase only — no fixes, no migrations, no code changes, no production behavior changes. Cover authentication (Google / Telegram / OpenWA OTP), authorization, wallet & financial integrity, API/input handling, infrastructure (Render, Neon, Redis, Cloudflare Tunnel, Sentry), frontend, and supply chain. Produce decision-grade outputs: `security.md`, `research.md`, `priorities.md`, `quickstart.md`. Be conservative and evidence-based — hypotheses must be marked as such; non-issues must be called out. Final goal: a clear map of real vs. likely vs. non-issue, with remediation priority."

## User Scenarios & Testing *(mandatory)*

<!--
  Stakeholders here are: (a) the product owner/leadership making the go/no-go call
  on a hardening sprint, (b) engineers who will eventually implement remediations,
  and (c) reviewers verifying findings before any fix lands. Stories are ordered
  by which audience the audit must serve first.
-->

### User Story 1 - Leadership gets a decision-grade security posture (Priority: P1)

The product owner needs to know, in a single sitting, whether SubNation is safe to keep running as-is, what the worst three things on the platform are right now, and which fixes — if any — must happen before the next launch window. They cannot read code; they need a written assessment that names the risks, their likelihood, and what each one would cost the business if exploited, so they can authorize a hardening budget.

**Why this priority**: Without this, no remediation work can be funded or sequenced. Every other deliverable depends on the same evidence base, but the leadership-facing summary is the artifact that unblocks decisions today.

**Independent Test**: A non-engineer stakeholder reads `security.md`'s executive summary and threat-model sections only, and can answer: (1) is the platform safe enough to operate today, (2) what are the top three risks, (3) what should be fixed first, (4) what is explicitly not a problem. If they can answer all four without opening any other artifact, the story is delivered.

**Acceptance Scenarios**:

1. **Given** the assessment is complete, **When** a stakeholder opens `security.md`, **Then** the executive summary states the overall posture (safe / at-risk / critical), names the top three risks in plain language, and lists what is urgent vs. what can wait.
2. **Given** the threat-model section, **When** a stakeholder reads it, **Then** they can identify the likely attacker types, the highest-value assets, and the trust boundaries the assessment used as scope, without needing engineering context.
3. **Given** a risk is called out, **When** the stakeholder asks "is this real or theoretical?", **Then** the document explicitly labels each finding as proven, likely, or hypothesis.

---

### User Story 2 - Engineers can act on findings without re-investigating (Priority: P1)

When a hardening sprint is approved, the engineering team needs every finding to be self-contained: which subsystem is affected, what the exploit path looks like, what the evidence is in the codebase, and what a fix would look like at the design level. They must not have to re-run discovery — the audit should leave them with enough context to start work the same day.

**Why this priority**: A finding without evidence and a reproduction sketch is not actionable; it becomes another investigation ticket. The whole point of the audit is to compress investigation time so the fix work can begin immediately when funded. This is co-equal in priority with Story 1 because the two artifacts ship together — leadership decides, engineers execute, both off the same document.

**Independent Test**: An engineer who has never seen the audit picks any one finding from `security.md`, follows only what is written in that finding, and can: (1) locate the affected code or configuration, (2) describe the attack path in their own words, (3) sketch a remediation approach. No additional discovery work is needed.

**Acceptance Scenarios**:

1. **Given** a finding in `security.md`, **When** an engineer reads it, **Then** the finding includes title, severity, affected subsystem, exploitability rating, business impact, code/architecture evidence, reproduction path (or a labelled hypothesis if reproduction was not attempted), and a recommended remediation direction.
2. **Given** the finding cites code, **When** the engineer cross-references it, **Then** the cited file paths and behaviors match what is in the repository at the time of the audit.
3. **Given** the audit could not prove a problem, **When** that finding is recorded, **Then** it is explicitly labelled as a hypothesis with the reason it could not be confirmed, and what would be needed to confirm it.
4. **Given** a finding involves an external integration (Google, Telegram, OpenWA, Cloudflare, Neon, Redis, Sentry), **When** the engineer reads it, **Then** the trust-boundary assumption being violated is named — not just the symptom.

---

### User Story 3 - Remediation work can be sequenced and budgeted (Priority: P2)

Once findings exist, someone has to decide what to fix this week, what to schedule for the quarter, and what to defer. The audit must produce a ranked plan that separates small reversible fixes from larger structural work, and explicitly flags items that should not be touched yet.

**Why this priority**: The decision-grade summary tells leadership *what* matters; the ranked plan tells them *in what order*. It is P2 because it is derived from Stories 1 and 2 — it cannot exist without their evidence — but it is the artifact that converts the assessment into a sprint plan.

**Independent Test**: A planner reads `priorities.md` only and can fill a hardening sprint with the right items in the right order, knowing for each one whether it is a quick win, a structural change, or a deferred item, and why.

**Acceptance Scenarios**:

1. **Given** `priorities.md` is generated, **When** a planner reads it, **Then** every finding from `security.md` appears with a rank derived from severity, likelihood, blast radius, ease of exploitation, and business impact.
2. **Given** the rankings, **When** the planner segments work, **Then** quick wins (small, low-risk, reversible) are listed separately from structural hardening and from deferred items, each with a one-line rationale.
3. **Given** a recommended fix, **When** the planner reviews it, **Then** the recommendation does not call for a large rewrite unless the document explicitly justifies why a smaller fix would not work.

---

### User Story 4 - Reviewers can verify findings and reuse the threat model (Priority: P3)

A second engineer (or external reviewer) needs to spot-check the audit's claims, confirm reproduction steps, and use the threat model as a baseline for future audits. The audit must therefore expose its evidence trail and review procedure, not just its conclusions.

**Why this priority**: This story protects the audit's credibility and longevity. It is P3 because Stories 1–3 deliver business value on their own; this story prevents the audit from decaying into folklore. Without it, the next audit will start from zero.

**Independent Test**: A reviewer who did not participate in the audit picks three findings at random and uses `quickstart.md` plus `research.md` to (a) navigate to the evidence in the codebase, (b) verify or refute the finding, and (c) record their verdict — without contacting the original author.

**Acceptance Scenarios**:

1. **Given** `quickstart.md` is generated, **When** a reviewer reads it, **Then** it explains how the audit was conducted, how to navigate the four documents, and how to verify a finding step by step.
2. **Given** `research.md` is generated, **When** a reviewer cross-checks a claim, **Then** they find the supporting evidence — code paths, configuration files, log excerpts, or external-provider behavior notes — recorded in a way that can still be located later.
3. **Given** the explicit-non-issues section, **When** a future audit revisits the same surface, **Then** they can see what was looked at and dismissed, with the reasoning, so the same ground is not re-litigated.

---

### Edge Cases

- **Audit cannot reach an external surface** (e.g., the OpenWA host or Cloudflare Tunnel side is opaque from the repo alone): the assessment must record this as a coverage gap, name the assumption it is making about that boundary, and flag what additional access would be needed to close the gap. It must not silently mark the surface as safe.
- **A scope item produces zero findings**: the assessment must still record that the surface was inspected, what was checked, and why nothing was flagged — otherwise consumers cannot tell coverage from omission.
- **A finding's severity is contested between criteria** (e.g., low likelihood but catastrophic blast radius): the ranking must show all five inputs (severity, likelihood, blast radius, ease of exploitation, business impact) and the resolution rule used, so the rank is auditable.
- **Evidence in the codebase changes during the audit window**: the assessment must pin every code citation to a commit hash or branch state at the time of the finding, so a fix landing mid-audit does not invalidate or appear to invalidate findings.
- **A risk requires confirmation by running code** (e.g., a suspected race condition in wallet top-up): the audit must not run destructive or state-changing tests; it must record the risk as a hypothesis with the proof-of-concept that would confirm it, and leave execution to a later, authorized phase.
- **Secrets are discovered in source, history, or logs during the audit**: the finding must name the secret type and location but must not reproduce the secret value in any deliverable; rotation is recommended but not performed by this assessment.

## Requirements *(mandatory)*

### Functional Requirements

#### Coverage

- **FR-001**: The assessment MUST cover every subsystem named in scope: Google authentication, Telegram authentication, WhatsApp/OpenWA OTP authentication, session/cookie/JWT handling, account linking and identity mapping, authorization for admin/user/order/wallet/product endpoints, wallet integrity (top-ups, approval, balance changes, ledger, coupons, purchase, refund/adjustment, replay/double-spend/race), API input handling (validation, query parameters, route protection, CSRF, CORS, open redirects, unsafe URLs, webhooks, provider callbacks), infrastructure (Render config, Neon connection, Redis usage, Cloudflare Tunnel/WAF assumptions, environment variables, secrets, logging/Sentry exposure, rate limits, health endpoints), frontend (client-side auth state, unsafe rendering, dynamic HTML/markdown, image URLs, external links, XSS, sensitive-data exposure, admin-only data leakage), and supply chain / operational security (dependencies, build-time and runtime assumptions, hidden debug paths, obsolete endpoints, diagnostic logs, leftover testing hooks).
- **FR-002**: For each scope subsystem, the assessment MUST explicitly state either the findings discovered there, or that the surface was inspected and produced no findings, with a one-line note on what was checked. Silent omission is not acceptable.
- **FR-003**: The assessment MUST give special attention to admin access control, wallet integrity, account-takeover risk, abuse of the top-up flow, leaked secrets/tokens, session fixation/token replay, missing CSRF or origin protection, misuse of external provider callbacks, Cloudflare/OpenWA/Telegram trust boundaries, and any surface where a user could influence money, authentication, or admin state.

#### Deliverables

- **FR-010**: The assessment MUST produce four deliverables in the feature directory: `security.md` (full assessment), `research.md` (evidence notes), `priorities.md` (ranked remediation plan), and `quickstart.md` (how to review and verify the findings).
- **FR-011**: `security.md` MUST contain, in order: an executive summary, a threat model, a findings catalog, a risk ranking, a quick-wins-vs-structural section, and an explicit-non-issues section.
- **FR-012**: The executive summary in `security.md` MUST state overall security posture, the top three risks in plain language, what is safe enough today, and what is most urgent — and it MUST be readable without engineering context.
- **FR-013**: The threat model in `security.md` MUST name likely attacker types, attacker goals, attack surfaces, trust boundaries used as scope, and the highest-value assets being protected.
- **FR-014**: `research.md` MUST record the evidence supporting each non-trivial claim in `security.md` — code locations, configuration excerpts, observed behavior, or external-provider documentation — in a form that can be navigated to and re-verified later.
- **FR-015**: `priorities.md` MUST list every finding with a rank derived from severity, likelihood, blast radius, ease of exploitation, and business impact, and MUST partition the list into quick wins, structural hardening, and deferred items.
- **FR-016**: `quickstart.md` MUST describe how the audit was scoped and conducted, how the four documents relate, and the step-by-step procedure for a reviewer to verify a finding.

#### Finding Quality

- **FR-020**: Each finding in `security.md` MUST include: title, severity, affected subsystem, exploitability rating, business impact, evidence drawn from code or architecture, a reproduction path (or, when reproduction was not possible without state change, a labelled hypothesis with the proof-of-concept that would confirm it), a recommended remediation direction, and an urgency flag (urgent / can-wait / deferred).
- **FR-021**: Every claim in a finding MUST be classified as **proven** (reproduced or directly evident), **likely** (consistent with multiple converging signals but not reproduced), or **hypothesis** (plausible but not confirmed) — and the classification MUST appear next to the claim.
- **FR-022**: Findings MUST NOT include generic security advice that is not grounded in a specific observation in the SubNation codebase, configuration, or integration. If no observation supports the advice, it does not appear as a finding.
- **FR-023**: Code citations in findings MUST reference file paths and behaviors that exist in the repository at audit time; the audit MUST record the commit reference (branch + hash) it was performed against.
- **FR-024**: Recommendations MUST NOT call for a large rewrite unless the finding explicitly justifies why a smaller, scoped fix is insufficient.

#### Non-Issues and Hypotheses

- **FR-030**: The assessment MUST include an explicit-non-issues section listing surfaces that were inspected, looked risky on first reading, and were determined to be acceptable — each with the reasoning that led to dismissal — so future audits and onboarding do not re-litigate them.
- **FR-031**: Hypotheses (unproven concerns) MUST be recorded separately from confirmed findings, or visibly labelled, so consumers do not mistake one for the other.
- **FR-032**: Coverage gaps (surfaces the audit could not fully reach without additional access, e.g., an opaque OpenWA or Cloudflare side) MUST be recorded with the assumption being made and the access that would be needed to close the gap.

#### Audit Discipline

- **FR-040**: The assessment MUST NOT change source code, database state, migrations, infrastructure configuration, or any other production behavior. Findings are written; nothing else.
- **FR-041**: The assessment MUST NOT execute destructive or state-changing tests against production or shared environments — including but not limited to wallet mutations, admin-action invocations, or authentication-state writes. Read-only inspection of source, configuration, and (where available) logs is permitted.
- **FR-042**: When a secret value is discovered in source, history, logs, or configuration, the deliverables MUST identify the secret type and location but MUST NOT reproduce the secret value. Rotation is recommended in the finding; rotation is not performed.
- **FR-043**: The assessment MUST be evidence-based. Concerns that cannot be supported with an observation are excluded from the findings catalog or marked as hypotheses per FR-031.

#### Severity and Ranking

- **FR-050**: Each finding MUST carry a severity rating from a single, documented four-tier scale (e.g., Critical / High / Medium / Low) defined once in `security.md` and applied consistently across all findings.
- **FR-051**: The risk ranking in `priorities.md` MUST show, for each finding, the inputs that produced its rank (severity, likelihood, blast radius, ease of exploitation, business impact) so the order is auditable, not just stated.
- **FR-052**: The same finding MUST receive the same severity in `security.md` and the same rank inputs in `priorities.md` — the two documents do not disagree.

### Key Entities

- **Finding**: A single audit observation. Carries title, severity, affected subsystem, exploitability rating, business impact, evidence, reproduction or hypothesis path, recommended remediation, and urgency flag. Has exactly one classification (proven / likely / hypothesis).
- **Threat Actor**: A described attacker profile (e.g., unauthenticated internet user, authenticated low-privilege buyer, malicious admin, compromised external-provider tenant) with goals and capabilities relevant to SubNation's surface.
- **Asset**: A thing of value to be protected (e.g., user wallet balance, admin session, OAuth token, ledger consistency, payment-provider trust). Each finding affects one or more assets.
- **Trust Boundary**: A named seam between zones of differing trust (e.g., browser ↔ app, app ↔ Cloudflare Tunnel, app ↔ OpenWA host, app ↔ Telegram, app ↔ Neon, app ↔ Redis). Findings often live at boundaries.
- **Coverage Item**: A scope subsystem that was inspected. Carries either references to its findings or an explicit "no findings, here is what was checked" note.
- **Risk Score**: The five-input ranking of a finding (severity, likelihood, blast radius, ease of exploitation, business impact). Drives ordering in `priorities.md`.
- **Evidence Note**: A single supporting observation in `research.md` — code citation, configuration excerpt, behavior note, or external-doc reference — keyed to one or more findings.
- **Recommendation**: The remediation direction attached to a finding. Sized as quick win / structural / deferred. Does not include implementation code.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A non-engineer stakeholder reading only the executive summary and threat-model sections of `security.md` can answer, in five minutes or less: (a) overall posture, (b) top three risks, (c) what is most urgent, (d) what is explicitly not a problem.
- **SC-002**: An engineer picking any one finding at random from `security.md` can locate the affected code or configuration, describe the attack path, and sketch a remediation direction without performing additional discovery — measured by spot-check on at least three randomly chosen findings before sign-off.
- **SC-003**: 100% of the scope subsystems listed in FR-001 appear in the assessment as either a finding, a non-issue, or a coverage gap. No scope subsystem is silently omitted.
- **SC-004**: 100% of findings are classified as proven, likely, or hypothesis, and 100% carry all required fields (title, severity, subsystem, exploitability, impact, evidence, reproduction-or-hypothesis, recommendation, urgency).
- **SC-005**: 100% of code citations in findings point to file paths and behaviors that exist at the audit's recorded commit reference — verified by a reviewer spot-checking at least 10% of findings.
- **SC-006**: A planner reading only `priorities.md` can produce a hardening sprint plan — quick-wins-this-week vs. structural-this-quarter vs. deferred — without consulting `security.md` again.
- **SC-007**: A reviewer following only `quickstart.md` can verify or refute three randomly chosen findings without contacting the original author of the audit.
- **SC-008**: Zero secret values appear in any deliverable; secret types and locations may appear, values may not — verified by a final pre-publish scan of all four documents.
- **SC-009**: Zero deliverables recommend a large rewrite without an accompanying justification for why a scoped fix is insufficient.
- **SC-010**: The assessment is complete when all four deliverables (`security.md`, `research.md`, `priorities.md`, `quickstart.md`) exist in the feature directory, cross-reference each other consistently (same findings, same severities, same ranks), and pass the requirements checklist for this feature.

## Assumptions

- **Audit-only posture**: This feature does not include code changes, migrations, infrastructure changes, secret rotation, or any production-behavior change. Remediation work is a separate, future phase that will be authorized after leadership reviews this assessment.
- **Read-only access to evidence**: The audit operates on the repository, committed configuration, and any logs/dashboards the auditor already has read access to. It does not request new production access, does not run destructive or state-changing probes, and does not perform live exploitation.
- **External-provider opacity is acceptable as a coverage gap**: For surfaces the audit cannot directly inspect (e.g., the OpenWA host's internal configuration, Cloudflare Tunnel's edge rules, the Telegram bot platform's internal trust model), the audit records the assumption it is making about that boundary and lists it as a coverage gap rather than guessing.
- **Severity scale**: A documented four-tier scale (Critical / High / Medium / Low) is sufficient for stakeholder decisions; a formal CVSS vector is not required, though one may appear inside a finding's evidence if it sharpens the description.
- **Hypothesis labelling is preferable to silence**: Where a concern is plausible but cannot be confirmed without state change, the audit records it as a hypothesis rather than dropping it. This keeps the findings catalog conservative without losing signal.
- **Audit baseline**: The audit pins to the repository state at branch `004-security-audit`'s base commit; findings will reference that state. Code that lands during the audit window is out of scope unless it materially changes a finding.
- **Stakeholder distribution**: The deliverables are intended for SubNation's product owner, engineering, and any reviewer the owner authorizes. They are not intended to be published externally as-is, because they describe attack paths.
- **Documentation language**: Deliverables are written in English (matching the existing `specs/` directory). Translations are out of scope.
- **Existing prior work is preserved**: Earlier specs (`001-ai-opportunity-assessment`, `003-anomaly-detection`) and any unrelated UX/SEO improvements are not modified by this audit; the audit only reads them where they overlap a security surface.
