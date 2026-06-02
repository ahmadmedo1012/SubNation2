---
description: "Task list — SubNation Security & Vulnerability Assessment (audit-only)"
---

# Tasks: SubNation Security & Vulnerability Assessment

**Input**: Design documents from `/specs/004-security-audit/`

**Prerequisites**:

- [`spec.md`](./spec.md) — feature specification (4 user stories, FR-001..FR-052, SC-001..SC-010)
- [`plan.md`](./plan.md) — audit methodology + Constitution Check
- [`research.md`](./research.md) — Phase 0: 10 methodology decisions, severity calibration, 47-row coverage matrix, evidence-notebook templates
- [`data-model.md`](./data-model.md) — 8 entities (Finding, Threat Actor, Asset, Trust Boundary, Coverage Item, Risk Score, Evidence Note, Recommendation), validation rules VR-F-01..VR-RS-03, closure conditions C-01..C-08
- [`contracts/`](./contracts/) — 5 document-shape contracts (`finding`, `security-md`, `research-md`, `priorities-md`, `quickstart-md`) + `README.md`

**Tests**: NOT applicable. This is an audit feature; the audit's "tests" are the C-01..C-08 closure rules in `data-model.md` §9 and the reviewer spot-check (`research.md` §1 D-06). No vitest specs are written, no code is shipped.

**Organization**: Tasks are grouped by user story to enable independent validation of each story. Because the audit ships only Markdown deliverables (no code), most "parallelism" is logical rather than practical — a single auditor will execute these sequentially.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different file, no dependency on incomplete tasks. Sparse here because most tasks append to the same handful of deliverables.
- **[Story]**: Maps to spec User Stories US1–US4. Setup, Foundational, and Polish phases carry no story label.
- File paths are absolute relative to repo root.

## Path Conventions

- All deliverables live under `specs/004-security-audit/`.
- The four audit-deliverable Markdown files are: `security.md`, `research.md` (final form), `priorities.md`, `quickstart.md` (audit form).
- No file outside `specs/004-security-audit/` is created or modified by this audit.

---

## Phase 1: Setup (Pin Baseline & Verify Prerequisites)

**Purpose**: lock the audit's pinned commit reference and confirm all plan artifacts are readable before evidence gathering begins.

- [x] T001 Record pinned commit reference (current `004-security-audit` HEAD) and audit window dates in a new "Audit baseline" header block at the top of `specs/004-security-audit/research.md`. Format: `**Audit baseline**: branch 004-security-audit @ <SHA>`, `**Audit window**: <start YYYY-MM-DD> to <ongoing>`. This is the single source for pinned-commit references across all four deliverables (FR-023).
- [x] T002 [P] Open and skim end-to-end: `specs/004-security-audit/spec.md`, `specs/004-security-audit/plan.md`, `specs/004-security-audit/data-model.md`, and the 5 files under `specs/004-security-audit/contracts/`. Confirm no `[NEEDS CLARIFICATION]` marker remains and the requirements checklist at `specs/004-security-audit/checklists/requirements.md` is fully ticked.
- [x] T003 Verify coverage matrix in `specs/004-security-audit/research.md` §3 has all 47 rows present and each is currently in `open` state — this is the baseline that Phase 2 will close.

**Checkpoint**: pinned commit recorded; methodology and contracts confirmed readable.

---

## Phase 2: Foundational — Evidence Gathering

**Purpose**: populate `research.md` §§4–7 (Evidence Notebook, External-Source Notes, Coverage Gaps, Secret-Handling Log), and close every row in `research.md` §3's coverage matrix with one of {≥1 F-NNN ID, `non-issue: <note>`, `CG-NN`}. **Without this phase complete, no user-story deliverable can be written** — every Finding cites at least one EN, every leadership-facing claim sits on top of those Findings.

**⚠️ CRITICAL**: SC-003 (every scope subsystem appears as a finding, non-issue, or coverage gap) is closed mechanically by the matrix at the end of this phase. A row left `open` here will fail audit sign-off.

**Discipline reminders** (from `research.md` §1 D-07 / D-08 / D-09):

- Read-only inspection only. No `curl`, no probes, no state-changing requests against any environment.
- Out-of-repo dashboard views (Render, Cloudflare, Sentry, Neon) only if read credentials already held; record as `XS-NN` external-source note, never embed dashboard URL.
- Never reproduce a secret value in any EN excerpt. SH-NN entries record type + location only.

- [x] T004 AUTH evidence pass — read `backend/src/routes/auth*`, `backend/src/middleware/auth*`, `backend/src/lib/firebase*`, `backend/src/lib/telegram*`, `backend/src/lib/openwa*`, and the corresponding session/JWT/cookie helpers. Append EN-NNN entries to `specs/004-security-audit/research.md` §4 covering Google login, Telegram HMAC widget + Mini App, OpenWA OTP flow, `auth_token` cookie handling, JWT verification & `SESSION_SECRET` strength, login state transitions, account-linking, and admin auth (argon2 + TOTP + lockout). Then close rows AUTH-1 through AUTH-8 in §3 with the resulting Finding-ID candidates / non-issue notes / CG references.
- [x] T005 AUTHZ evidence pass — read admin/role middleware, every state-changing route's auth/admin guard, and the IDOR surface (resources owned by user vs. accessible by ID). Append EN-NNN entries to `specs/004-security-audit/research.md` §4 for admin endpoint guards, user-own-resource enforcement, order endpoints, wallet endpoints, product/admin product-management endpoints, and IDOR/privilege-escalation surface. Close AUTHZ-1 through AUTHZ-6 in §3.
- [x] T006 WALLET evidence pass — read `backend/src/routes/wallet*`, `backend/src/services/wallet*`, the ledger module, coupon application, purchase flow, refund/adjustment paths, and any concurrency/optimistic-lock code. Append EN-NNN entries to `specs/004-security-audit/research.md` §4 for top-up flow (request + approval), balance-change atomicity, append-only ledger invariant (`balanceBefore`/`balanceAfter`), coupon application, purchase-flow single-transaction integrity, refund/adjustment, and replay/double-spend/race surface. Close WALLET-1 through WALLET-7 in §3. Per Constitution Principle I, this pass deserves the most careful evidence trail.
- [x] T007 API & input-handling evidence pass — read `shared/api-zod`, `backend/src/middleware/csrf`, `backend/src/middleware/cors`, request-validation entry points, webhook routes, and external-provider callback routes. Append EN-NNN entries to `specs/004-security-audit/research.md` §4 for Zod-schema coverage, query-parameter handling, route protection, CSRF Origin/Referer check, CORS allow-list (`APP_ORIGINS`), open redirects, unsafe URLs returned to clients, webhook input validation, and provider callbacks (Google / Telegram / OpenWA). Close API-1 through API-9 in §3.
- [x] T008 INFRA evidence pass — read Render service definitions (`render.yaml` or equivalent), `config/env.example`, the actual `process.env` consumers, Redis usage (rate-limit, leader-lock, socket adapter), Neon connection wiring, Cloudflare Tunnel config (where present in repo), Sentry init, log redaction, multi-tier rate-limit code, `/api/healthz`, `/status`. Append EN-NNN entries to `specs/004-security-audit/research.md` §4 for Render service config, Neon connection security, Redis usage, Cloudflare Tunnel/WAF assumptions, environment-variable surface, secret handling (storage + rotation + fail-fast), logging redaction & Sentry exposure, multi-tier rate limits, and health/readiness endpoints. Close INFRA-1 through INFRA-9 in §3. For surfaces unreachable from the repo alone (e.g., live Cloudflare WAF rules), file a `CG-NN` per T012.
- [x] T009 FRONTEND evidence pass — read frontend auth-state handling, every `dangerouslySetInnerHTML`, dynamic Markdown / HTML rendering paths, image-URL handling for user/external-supplied content, external-link `rel`/`target` posture, XSS sinks/sources, sensitive-data exposure in UI, and admin-only data leakage to non-admin clients. Append EN-NNN entries to `specs/004-security-audit/research.md` §4 for FE-1 through FE-8. Close those rows in §3.
- [x] T010 SUPPLY-CHAIN evidence pass — read `pnpm-lock.yaml` for known-CVE reachability, build-time/runtime assumptions, hidden debug paths, obsolete endpoints (incl. retired phone+password noted in Constitution Principle II), diagnostic logs, leftover testing hooks, and the `.gitleaks.toml` coverage. Append EN-NNN entries to `specs/004-security-audit/research.md` §4 for SUP-1 through SUP-6. Close those rows in §3.
- [x] T011 Secret-handling sweep — `git log -p` filtered for secret-shaped strings + scan of currently-committed config + (if reader has access) sample of recent log lines. Per spec FR-042 / SC-008, every hit produces an `SH-NN` entry in `specs/004-security-audit/research.md` §7 with secret type + location only — **never the value, never an excerpt that contains the value, never a URL that resolves to the value**. Each SH-NN also produces a candidate Finding for the §4 evidence list.
- [x] T012 Coverage-Gap pass — for every subsystem T004–T010 could not fully reach without additional access (typical examples: live Cloudflare WAF rule set, OpenWA host internal config, Telegram bot platform internal trust model), file a `CG-NN` entry in `specs/004-security-audit/research.md` §6 recording: assumption being made, access required to close the gap, and the worst-case finding if the assumption is wrong. Update the affected matrix rows in §3 to point at the CG-NN.

**Checkpoint**: zero rows in `research.md` §3 are still `open`; every row carries Finding-ID candidates, a non-issue note, or a CG-NN. Closes spec FR-002 / SC-003 mechanically.

---

## Phase 3: User Story 2 — Findings Catalog (Priority: P1) 🎯 MVP

**Goal**: produce the canonical, ID-stable, engineer-readable Findings catalog in `security.md` §3. Each Finding is self-contained per `contracts/finding.contract.md` so an engineer can locate the affected code, describe the attack path, and sketch a fix from the Finding alone.

**Independent Test**: pick three Findings at random; for each, confirm an engineer who has not seen the audit can (a) locate the cited path at the pinned commit, (b) describe the attack in their own words, (c) sketch a remediation direction — without consulting `research.md` for additional context. Spec SC-002.

**MVP rationale**: every other deliverable rests on the Findings list. US1's executive summary distills it. US3's `priorities.md` ranks it. US4's `quickstart.md` describes how to verify it. This phase is the audit.

### Implementation for User Story 2

- [x] T013 [US2] Create `specs/004-security-audit/security.md` with the header block (Audit baseline, window, severity-scale pointer to `research.md` §2, classification-scale pointer to `research.md` §1 D-10, distribution = internal-only) and empty section anchors §1 through §6 per `contracts/security-md.contract.md`.
- [x] T014 [US2] Promote AUTH-related Evidence Notes from `research.md` §4 into Finding entries `F-NNN` in `specs/004-security-audit/security.md` §3, each conforming to `contracts/finding.contract.md`: title, severity (per `research.md` §2 calibration), subsystem (matches matrix row ID), per-claim classification (proven / likely / hypothesis with `whyNotPromoted` for non-proven), evidence list (≥1 EN-NNN), reproduction-or-hypothesis block, recommendation (size + reversibility + dependencies + justification iff structural+), urgency. Update affected matrix rows in `research.md` §3 to list the F-NNN IDs.
- [x] T015 [US2] Same as T014, for AUTHZ-related Evidence Notes. Append to `specs/004-security-audit/security.md` §3; update §3 matrix rows.
- [x] T016 [US2] Same as T014, for WALLET-related Evidence Notes. Per Constitution Principle I, every wallet-touching Finding states explicitly whether reproduction would change ledger state — if yes, classification is `hypothesis` and `whyNotRun = "would mutate the append-only ledger"`. Append to `specs/004-security-audit/security.md` §3; update matrix rows.
- [x] T017 [US2] Same as T014, for API & input-handling Evidence Notes. Append to `specs/004-security-audit/security.md` §3; update matrix rows.
- [x] T018 [US2] Same as T014, for INFRA Evidence Notes — including any `SH-NN` secret-handling entries from `research.md` §7 that warrant their own Finding. Critical: the Finding text MUST NOT reproduce the secret value (FR-042 / VR-F-07). Append to `specs/004-security-audit/security.md` §3; update matrix rows.
- [x] T019 [US2] Same as T014, for FRONTEND Evidence Notes. Append to `specs/004-security-audit/security.md` §3; update matrix rows.
- [x] T020 [US2] Same as T014, for SUPPLY-CHAIN Evidence Notes. Append to `specs/004-security-audit/security.md` §3; update matrix rows.

**Checkpoint**: every Finding in `specs/004-security-audit/security.md` §3 satisfies VR-F-01 through VR-F-08; every coverage-matrix row in `research.md` §3 closed by Findings carries the actual F-NNN IDs (not just "candidates"). Closes spec FR-020.

---

## Phase 4: User Story 1 — Leadership Artifact (Priority: P1)

**Goal**: produce the leadership-readable sections of `security.md` — executive summary, threat model, and explicit non-issues. A non-engineer stakeholder can answer the four spec-User-Story-1 questions in 5 minutes by reading §1 + §2 + §6 alone.

**Independent Test**: a non-engineer stakeholder reading only §1 and §2 of `security.md` can state, in five minutes: (a) overall posture, (b) top three risks (by F-NNN), (c) what is most urgent, (d) what is explicitly not a problem. Spec SC-001.

**Dependency**: requires US2 (Phase 3) complete — exec summary distills the Findings, threat model frames them, non-issues section is constrained by what the audit explicitly inspected.

### Implementation for User Story 1

- [x] T021 [US1] Draft `specs/004-security-audit/security.md` §2 Threat Model — at minimum 4 Threat Actor profiles (`unauthenticated internet user`, `authenticated low-privilege buyer`, `malicious admin`, `compromised external-provider tenant`), their goals + capabilities + `realismFloor`, the 7 Trust Boundaries from `data-model.md` §4, and the highest-value Asset list from `data-model.md` §3. Cross-references the matrix in `research.md` §3 for attack surfaces in scope.
- [x] T022 [US1] Draft `specs/004-security-audit/security.md` §1 Executive Summary (≤ 600 words). Required content: overall posture (one of: solid / acceptable-with-caveats / at-risk / critical), top three risks in plain language with their F-NNN IDs, what is safe enough today, what is most urgent, and a one-paragraph statement of what this audit did NOT do. Readable by a non-engineer in 5 minutes — no security jargon outside what is necessary to name the risks.
- [x] T023 [US1] Draft `specs/004-security-audit/security.md` §6 Explicit Non-Issues — for every coverage-matrix row that closed with a `non-issue: <note>` in Phase 2, write a paragraph naming what was inspected, why it is not a Finding, and which Evidence Notes (EN-NNN) support the dismissal. Closes spec FR-030.

**Checkpoint**: `security.md` is leadership-readable end-to-end. Stakeholder spot-check (1 reader, 5-minute timer) confirms SC-001.

---

## Phase 5: User Story 3 — Sprint Plan (Priority: P2)

**Goal**: produce `priorities.md` so a planner can fill a hardening sprint without re-reading `security.md`.

**Independent Test**: a planner reading only `priorities.md` can produce a hardening sprint plan — quick wins this week, structural this quarter, deferred — without consulting `security.md`. Spec SC-006.

**Dependency**: US2 (Phase 3) complete — every Finding must exist before it can be ranked. US1 (Phase 4) does not block this phase.

### Implementation for User Story 3

- [x] T024 [US3] Create `specs/004-security-audit/priorities.md` with the header (linked assessment, generation date) and §1 Ranking Method per `contracts/priorities-md.contract.md`. §1 names all five inputs (severity, likelihood, blast radius, ease of exploitation, business impact), the ordering rule, the contested-severity resolution rule, and points to `data-model.md` §6 for full enumerations.
- [x] T025 [US3] Populate `specs/004-security-audit/priorities.md` §2 Ranked Table — every F-NNN from `security.md` §3 appears exactly once with all five ranking inputs visible (FR-051), severity matching `security.md` (FR-052 / VR-RS-02), partition (`quick-win` / `structural` / `deferred`), and urgency. Sort per §1 ordering rule.
- [x] T026 [US3] Populate `specs/004-security-audit/priorities.md` §3 Quick Wins — one subsection per Finding with `partition = quick-win`. Each subsection re-states severity, recommendation direction (from the Finding), reversibility, dependencies, and a one-sentence "why this is a quick win, not structural."
- [x] T027 [US3] Populate `specs/004-security-audit/priorities.md` §4 Structural Hardening — one subsection per Finding with `partition = structural`. Each subsection re-states severity, recommendation direction, reversibility, dependencies, **and** a required one-sentence "why a quick win is insufficient" line (closes FR-024 / SC-009 / VR-F-06). For any `large`-size recommendation, attach an explicit Justification.
- [x] T028 [US3] Populate `specs/004-security-audit/priorities.md` §5 Deferred Items — one subsection per Finding with `partition = deferred`. Each subsection names the deferral reason and the trigger that would un-defer it (typically a CG-NN closure or a future audit phase).
- [x] T029 [US3] Run the §6 Cross-Document Consistency Check checklist in `specs/004-security-audit/priorities.md`: every F-NNN appears exactly once in §2, severities match `security.md`, no `urgent` finding in §5, no `deferred` finding in §3, every §4 entry has the required "why insufficient" line, every `large` recommendation has Justification. Tick each box. Closes C-03 / VR-RS-01 / VR-RS-02 / VR-RS-03.

**Checkpoint**: `priorities.md` is planner-readable; cross-doc consistency confirmed.

---

## Phase 6: User Story 4 — Reviewer Artifact (Priority: P3)

**Goal**: overwrite the plan-validation `quickstart.md` with the audit-deliverable form per `contracts/quickstart-md.contract.md`. An independent reviewer can verify three random Findings using only `quickstart.md` + `research.md`, without contacting the audit author.

**Independent Test**: an independent reviewer follows the §4 step-by-step procedure on three random Findings drawn per the §5 spot-check protocol, without contacting the audit author. Spec SC-007.

**Dependency**: US2 (Phase 3), US1 (Phase 4), and US3 (Phase 5) complete — quickstart references all three.

### Implementation for User Story 4

- [x] T030 [US4] Overwrite `specs/004-security-audit/quickstart.md` (currently the plan-validation form) with the audit-deliverable header block (audience, audit baseline = pinned SHA from T001, audit window) and §§1–2 (How the audit was scoped, How the audit was conducted) per `contracts/quickstart-md.contract.md`. The plan-validation collision is intentional and documented in `plan.md` → "Project Structure".
- [x] T031 [US4] Add §§3–4 to `specs/004-security-audit/quickstart.md`: How the four documents relate (security.md / research.md / priorities.md / quickstart.md), and the numbered step-by-step Finding-verification procedure (8 steps from `contracts/quickstart-md.contract.md` §4).
- [x] T032 [US4] Add §§5–8 to `specs/004-security-audit/quickstart.md`: reviewer spot-check protocol (verbatim from `research.md` §1 D-06 — sample size 10% min 3, drawn uniformly at random, any single failure halts sign-off, reviewer is independent), pinned commit reference + reproduction commands (from T001), what this audit did NOT do (restating FR-040 / FR-041 / FR-042), and how to use the audit for a future hardening sprint.

**Checkpoint**: `quickstart.md` is reviewer-actionable end-to-end; the four deliverables now exist (`security.md`, `research.md`, `priorities.md`, `quickstart.md`) — closes FR-010.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: complete the inter-document summary sections in `security.md`, run mechanical closure rules, perform the reviewer spot-check, and confirm sign-off. This phase is not optional — it is what converts "the four files exist" into "the audit is signed off."

- [x] T033 Add `specs/004-security-audit/security.md` §4 Risk Ranking summary table — compact `| ID | Title | Severity | Urgency | Partition |` table sourced from `priorities.md` §2 (every F-NNN, same severities). This is the at-a-glance reference inside `security.md`.
- [x] T034 Add `specs/004-security-audit/security.md` §5 Quick Wins vs. Structural — leadership-readable summary (≤ 5 bullets per subsection), each citing F-NNN. Sourced from `priorities.md` §§3–4. Items not appearing here are deferred (they live in `priorities.md` §5 only).
- [x] T035 Run pre-publish entropy scan on all four deliverables — `specs/004-security-audit/security.md`, `specs/004-security-audit/research.md`, `specs/004-security-audit/priorities.md`, `specs/004-security-audit/quickstart.md`. Use a high-entropy-string detector (e.g., `gitleaks detect --source <file>` or equivalent). Record the result (CLEAN / specific finding) in a "Pre-publish entropy scan" subsection at the bottom of `specs/004-security-audit/research.md` §8 done-when checklist. Closes C-05 / SC-008. **Audit cannot ship if this is not CLEAN.**
- [x] T036 Run the cross-document consistency checklist (C-01 through C-08 from `specs/004-security-audit/data-model.md` §9) and record pass/fail per item in a new "Cross-document closure" subsection at the bottom of `specs/004-security-audit/research.md` §8. Any FAIL halts sign-off and points back to the offending phase. Closes C-01 (no `open` matrix rows), C-02 (every Finding has ≥1 EN + ≥1 Claim + Repro-or-Hypothesis), C-03 (severity matches across docs), C-04 (every EN path resolves at pinned commit), C-06 (every `large` rec has Justification), C-07 (every Hypothesis Finding records `whatWouldConfirm` + `whyNotRun`), C-08 (every CG-NN records assumption + access + worst-case).
- [x] T037 Perform reviewer spot-check per `research.md` §1 D-06 — draw a uniform-random 10% sample of the Finding list (minimum 3). For each sampled Finding, an independent reviewer verifies: (a) every cited path resolves at the pinned commit (`git show <SHA>:<path>`), (b) every cited behavior is present at the pinned commit, (c) per-claim classification is consistent with the linked Evidence Notes. Record reviewer name, sample list, and pass/fail per Finding in a "Reviewer spot-check" subsection at the bottom of `specs/004-security-audit/research.md` §8. Any single failure halts sign-off. Closes SC-005 / SC-007.
- [x] T038 Re-validate `specs/004-security-audit/checklists/requirements.md` against the finalized deliverables — all 16 items must remain ticked, with any post-audit notes appended. Closes spec quality gate.
- [x] T039 Final sign-off block — append a "Sign-off" subsection at the very bottom of `specs/004-security-audit/research.md` §8 stating: pinned SHA, audit window dates, auditor name, reviewer name, all C-NN results, all SC-NN results, entropy-scan result, spot-check verdict. Once this block is filled with all PASS, the audit is complete and the four deliverables are publishable internally.

**Checkpoint**: audit signed off; four deliverables ready for internal distribution.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: no dependencies; T001 must complete before any Phase 2 task (other tasks need the pinned SHA).
- **Phase 2 Foundational**: depends on Phase 1; T011 (secret sweep) and T012 (coverage gaps) can start once any T004–T010 surface that touches secrets / opaque boundaries has produced its first ENs, but realistically T011 / T012 run last in Phase 2.
- **Phase 3 (US2 — Findings catalog)**: blocks on Phase 2 entirely. Findings cite ENs; no ENs ⇒ no Findings.
- **Phase 4 (US1 — Leadership artifact)**: blocks on Phase 3. Exec summary names top three risks by F-NNN.
- **Phase 5 (US3 — Sprint plan)**: blocks on Phase 3. Ranking needs Findings; does **not** block on Phase 4.
- **Phase 6 (US4 — Reviewer artifact)**: blocks on Phases 3, 4, 5. Quickstart references all three other deliverables.
- **Phase 7 Polish**: blocks on Phase 6 (T033 / T034 mirror priorities.md sections; T035 / T036 / T037 require all four deliverables exist).

### User Story Dependencies

- **US2 (P1, MVP)**: independent of other stories; depends only on Phase 2 evidence.
- **US1 (P1)**: depends on US2 (top-three-risks summary).
- **US3 (P2)**: depends on US2 (ranks Findings); independent of US1.
- **US4 (P3)**: depends on US2, US1, US3 (quickstart references all three).

### Within Each User Story

- Tests do not apply (audit is documentation; closure is mechanical via C-NN rules).
- Header / skeleton tasks (T013, T024, T030) come before content tasks in the same phase.
- Cross-doc summary tasks (T033, T034, T036) come last in Phase 7.

### Parallel Opportunities

- **Phase 1**: T002 [P] runs in parallel with T001/T003 (different operations).
- **Phase 2**: subsystem passes T004–T010 write to the SAME file (`research.md` §4) so are practically serial; T011 and T012 also write to `research.md` (§7 and §6 respectively) — serial as well. No [P] markers in Phase 2.
- **Phase 3**: tasks T014–T020 all write to `security.md` §3 — serial.
- **Phase 4**: T021 (§2) → T022 (§1) → T023 (§6); T021 must precede T022 because the exec summary references the threat model. Serial.
- **Phase 5**: T024 → T025 (table) → T026 / T027 / T028 (could in principle parallelize because they target different §3/§4/§5 subsections of the same file — but a single auditor will sequence them) → T029.
- **Phase 6**: serial — same file.
- **Phase 7**: T033 / T034 (security.md edits) → T035 (entropy scan) → T036 (closure check) → T037 (spot-check) → T038 → T039.
- **Cross-phase**: with multiple auditors, US1 / US3 / US4 could run in parallel after Phase 3 completes — but US4 still waits on US3 because quickstart references priorities.

---

## Parallel Example: Phase 2 (single auditor, sequential)

```bash
# Single auditor — execute in dependency order:
Task: T004 AUTH evidence pass → research.md §4
Task: T005 AUTHZ evidence pass → research.md §4
Task: T006 WALLET evidence pass → research.md §4 (Constitution Principle I — most careful trail)
Task: T007 API evidence pass → research.md §4
Task: T008 INFRA evidence pass → research.md §4
Task: T009 FRONTEND evidence pass → research.md §4
Task: T010 SUPPLY-CHAIN evidence pass → research.md §4
Task: T011 Secret-handling sweep → research.md §7
Task: T012 Coverage-Gap pass → research.md §6
```

## Parallel Example: Cross-story (multi-auditor, after Phase 3)

```bash
# After T013–T020 complete:
Auditor A: Phase 4 (T021 → T022 → T023)
Auditor B: Phase 5 (T024 → T025 → T026 → T027 → T028 → T029)
# Auditor B's Phase 5 blocks on Phase 3 only, not on Phase 4.

# After A and B complete:
Auditor C (or A): Phase 6 (T030 → T031 → T032)
# Phase 6 references all three other deliverables.
```

---

## Implementation Strategy

### MVP First (Findings Catalog Only — End of Phase 3)

1. Phase 1 Setup — pin commit, verify prereqs.
2. Phase 2 Foundational — populate the evidence notebook end-to-end.
3. Phase 3 US2 — write the Findings catalog in `security.md` §3.
4. **STOP and VALIDATE**: spot-check 3 random Findings. If an engineer can act on each from the Finding alone, MVP is real (SC-002 holds even before exec summary, priorities, or quickstart exist).
5. The MVP is technically deliverable here as a single-file artifact, but is **not** stakeholder-ready — that requires Phase 4.

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation laid (matrix closed, ENs gathered).
2. Phase 3 (US2) → Findings catalog → engineer-actionable MVP.
3. Phase 4 (US1) → exec summary + threat model → leadership-readable.
4. Phase 5 (US3) → priorities.md → planner-actionable.
5. Phase 6 (US4) → quickstart.md → reviewer-actionable.
6. Phase 7 (Polish) → cross-doc summaries + closure checks + spot-check + sign-off → publishable.

### Parallel Team Strategy

With multiple auditors, after Phase 3 completes:

- Auditor A: Phase 4 (US1 leadership artifact)
- Auditor B: Phase 5 (US3 sprint plan)
- A or B: Phase 6 (US4 reviewer artifact) once both A and B finish
- One auditor performs Phase 7 sign-off; reviewer spot-check (T037) MUST be a _different_ auditor than the one who wrote the Findings.

### When to STOP (constitutional reminder)

This audit ships **no code, no migration, no infrastructure change, no secret rotation**. After T039 (sign-off) the audit is complete. Remediation work is a separate, future, separately-authorized branch — and remediation does **not** modify the audit deliverables. The audit is the snapshot the remediation references.

---

## Notes

- [P] markers are sparse here on purpose — most tasks append to one of four Markdown files, so they serialize naturally.
- [Story] labels appear only on Phases 3–6 per the template.
- "Tests" are the C-01..C-08 closure rules + the SC-005 reviewer spot-check + the SC-008 pre-publish entropy scan. They are mechanical, not vitest specs.
- Commit cadence: per the user's standing project preference, commit after each phase locally (no push). Final push to `main` happens once T039 is signed off.
- `CLAUDE.md` already points to `specs/004-security-audit/plan.md` (set during `/speckit-plan`). It is **not** in this branch's commit set because it was untracked at session start (mirroring the 003 precedent).
- Avoid: reproducing secret values anywhere, recommending a large rewrite without justification, leaving any `open` row in the coverage matrix, signing off without spot-check.
