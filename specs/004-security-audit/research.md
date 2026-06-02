# Phase 0 Research: SubNation Security Audit Methodology

**Feature**: [004-security-audit](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-06-02

This document locks in the methodology decisions the audit will use, defines the severity and classification scales, and provides the empty-but-structured matrices that `/speckit-implement` will populate during the audit itself. Phase 0 produces this structure; Phase 2 (`/speckit-tasks`) decomposes it into ordered work; Phase 3 (`/speckit-implement`) fills in the evidence and findings.

The audit pins to the `004-security-audit` branch HEAD at the time `security.md` is finalized — the exact commit reference will be recorded in `quickstart.md` (audit-deliverable version) per spec FR-023.

---

## 1. Methodology Decision Log

Each decision is recorded as **Decision / Rationale / Alternatives Considered** so a future audit can revisit it on its merits, not its momentum.

### D-01 — Severity scale: 4 tiers (Critical / High / Medium / Low)

- **Decision**: Use a 4-tier ordinal scale, defined once below in §2 and applied to every Finding.
- **Rationale**: Spec Assumption §4 explicitly mandates a 4-tier scale; spec FR-050 requires it be defined once and applied consistently. 4 tiers is enough resolution for stakeholder decisions ("must fix this week" vs. "schedule for the quarter") without false precision. CVSS would add precision but also add domain-specific noise (attack vector / complexity / privileges-required vectors are not intuitive to non-engineers, and SC-001 requires a non-engineer to read the executive summary in 5 minutes).
- **Alternatives considered**:
  - **CVSS v3.1 scoring** — rejected: too much detail for the leadership-readable artifact (spec User Story 1, SC-001), and the scoring vectors do not map cleanly to "ledger corruption" or "wallet replay" which are SubNation's distinctive risks.
  - **3 tiers** — rejected: collapses High and Medium, which makes the quick-wins-vs-structural partition harder to draw in `priorities.md`.
  - **5 tiers (adding Informational)** — rejected: anything below "Low" is not a finding under spec FR-022; it would either be a non-issue or it does not appear in the assessment at all.

### D-02 — Per-claim classification: 3 tiers (proven / likely / hypothesis)

- **Decision**: Classify every claim inside a Finding (not just the Finding overall) as one of: **proven**, **likely**, **hypothesis**. A single Finding may carry mixed classifications.
- **Rationale**: Spec FR-021 requires this. Per-claim is stronger than per-finding because real Findings often combine a proven primary observation with secondary inferences that cannot be confirmed without state change — e.g., "the route is missing a CSRF check (proven)" + "an attacker on a hostile origin can therefore force a top-up approval (hypothesis, would require running the cross-origin POST against staging)." Collapsing those to one classification either over-claims or under-claims.
- **Alternatives considered**:
  - **Binary (confirmed / unconfirmed)** — rejected: erases the useful middle ground of "multiple converging signals but no single reproducible trigger." That middle ground is exactly where many SubNation findings will land (e.g., "the OpenWA OTP flow does not appear to record replay-protection state in the code we can see, AND the Telegram-replay pattern uses Redis TTL — so this is *likely* a gap, not a *hypothesis*"). Spec FR-031 explicitly requires hypothesis to be visibly distinct.
  - **Likelihood percentages** — rejected: false precision; reviewers would argue about whether something is 60% or 75% rather than about whether the evidence supports the claim.

### D-03 — Evidence-citation format

- **Decision**: A citation is `path/to/file.ts:42-58` followed by a 1–3 line excerpt block and a behavior description. Excerpts MUST exclude any secret value (FR-042). The pinned commit reference is recorded once in the audit's `quickstart.md` rather than on every citation, to keep finding text readable.
- **Rationale**: Spec FR-014 requires evidence be "navigable to and re-verified later." File:line references survive re-verification at the pinned commit; per-citation hashes would be noise. The 1–3 line excerpt limit prevents accidental secret reproduction.
- **Alternatives considered**:
  - **Permalink to GitHub UI at commit** — rejected: the audit's distribution is internal-only (spec Assumptions §7); we should not assume the document will be opened in an environment that has GitHub access at the pinned commit, and permalinks rot under repo-rename or fork-move.
  - **Full-file embeds** — rejected: balloons document size, multiplies the secret-reproduction risk surface.

### D-04 — ID schemes

- **Decision**: Three stable ID prefixes that survive renumbering across documents:
  - **Finding**: `F-NNN` (e.g., `F-014`)
  - **Evidence Note**: `EN-NNN` (e.g., `EN-031`)
  - **Coverage Gap**: `CG-NN` (e.g., `CG-04`)
- **Rationale**: `security.md`, `priorities.md`, and `research.md` all cross-reference findings; if IDs were positional the cross-references would silently break on insertion. Zero-padding to 3 (or 2 for gaps, which are rarer) keeps tables aligned.
- **Alternatives considered**:
  - **Section-derived IDs (`AUTH-1`, `WALLET-3`)** — rejected: a Finding can plausibly be reclassified mid-audit (e.g., a CSRF gap that turns out to be a wallet-flow issue), which would break its ID. Subsystem is a *field* on the Finding, not part of its identity.

### D-05 — Coverage matrix as the closure mechanism for FR-001 / FR-002 / SC-003

- **Decision**: A single table in §3 of this file enumerates every subsystem and surface from spec FR-001. Each row stays open until it is closed by `≥1 Finding ID`, an explicit non-issue note, or a `CG-NN` coverage gap. The audit cannot be signed off until every row is closed.
- **Rationale**: Without an explicit closure mechanism, "we audited X" decays into "X is not mentioned, was it audited or skipped?" — exactly the failure mode SC-003 ("100% of scope subsystems appear as a finding, non-issue, or coverage gap") is designed to prevent.
- **Alternatives considered**:
  - **Implicit coverage from finding-list density** — rejected: produces silent omissions when a subsystem yields no finding (the most dangerous case, because it looks like coverage).

### D-06 — Reviewer-spot-check protocol (closes SC-005)

- **Decision**: At sign-off, draw a uniform-random 10% sample of the finalized Finding list (minimum 3 findings, even if 10% rounds lower). For each sampled Finding, an independent reviewer verifies: (a) every cited path resolves at the pinned commit, (b) every cited behavior is present at the pinned commit, (c) the per-claim classification is consistent with the linked Evidence Notes. Any single failure halts sign-off; the audit is not complete until every sampled Finding passes.
- **Rationale**: Spec SC-005 measures audit *quality*, not audit *output*. Without an enforced sampling protocol, "spot-checked by a reviewer" is unfalsifiable. The 10% / minimum-3 floor handles small-finding-count audits without inflating effort on large ones.
- **Alternatives considered**:
  - **Reviewer reads everything** — rejected: doubles audit cost without proportional risk reduction.
  - **Author-self-check only** — rejected: defeats the purpose; SC-007 also requires an *independent* reviewer.

### D-07 — No automated probes

- **Decision**: The audit performs no scripted requests against any environment (production, staging, or local-with-shared-state). Static analysis of source and committed configuration only. `git log -p`, `git show`, and `git grep` are permitted because they are read-only against the repository.
- **Rationale**: Spec FR-041 forbids state-changing tests. Even seemingly-read-only HTTP requests can mutate state via logging, rate-limit counters, or auth-failure lockouts; the safe rule is "no probes at all this phase."
- **Alternatives considered**:
  - **Read-only HTTP probes against staging** — rejected on the rule above. A future, separately authorized phase may add this.

### D-08 — Out-of-repo source handling

- **Decision**: Render dashboard, Cloudflare dashboard, Sentry dashboard, and the Neon console may be inspected **only** if the auditor already has read credentials, and **only** for read-only viewing. Findings that derive from those sources cite the source by name and the date/time the auditor read it; they do not embed dashboard URLs that may resolve to authenticated content for other readers.
- **Rationale**: Spec FR-032 requires coverage gaps to be named when access is missing. Spec FR-042 forbids reproducing secrets — many dashboard URLs encode session or query state that effectively contains secrets. Naming the source by name + timestamp gives a reviewer a clear next step ("log in to Sentry yourself, navigate to project SubNation, …") without leaking the auditor's session.

### D-09 — Secret-handling discipline (closes SC-008)

- **Decision**: When a secret value (any of: API key, JWT signing secret, database connection string with password, OAuth client secret, OpenWA token, Telegram bot token, encryption key, Sentry DSN with project keys) is encountered in source / git history / logs / config, the Finding records: secret type, location (path or log channel name), and a recommendation to rotate. The deliverable does not contain the value, an excerpt that contains the value, or a URL that resolves to the value. A pre-publish entropy scan of all four deliverables is part of the audit's done-when criteria.
- **Rationale**: Spec FR-042 + spec SC-008. The pre-publish scan is the mechanical enforcement.
- **Alternatives considered**:
  - **Trust the author to remember the rule** — rejected: humans miss this exactly when it matters most (under deadline, under fatigue, when a secret looks "obviously redacted but isn't"). A deterministic check is cheaper than a missed leak.

### D-10 — Hypothesis promotion rules

- **Decision**:
  - A claim is **proven** iff it is reproduced (read-only) at the pinned commit, or iff a single read-only inspection makes the claim self-evident (e.g., a missing middleware in a route file that is committed at the pinned hash).
  - A claim is **likely** iff there are **≥2 independent converging signals** in `research.md` and no contrary evidence at the pinned commit.
  - A claim is **hypothesis** iff it is plausible from the architecture or one observed signal but cannot meet the bar above without state change.
- **Rationale**: Operationalizes spec FR-021. The "≥2 converging signals" rule for **likely** prevents one weak signal from being inflated past its evidence.

---

## 2. Severity Scale Calibration

The 4 tiers below are the canonical definitions. They appear once here and are referenced (not redefined) in `security.md` per spec FR-050.

| Tier | Trigger conditions | Default urgency |
|------|--------------------|-----------------|
| **Critical** | Direct, currently exploitable path to one or more of: (a) full account takeover at scale (not just one account), (b) ledger corruption or balance mutation that bypasses the append-only invariant, (c) admin-state mutation by an unauthenticated user, (d) production secret exfiltration. | urgent |
| **High** | Exploitable by a low-privileged authenticated user with realistic effort, OR a confirmed weakness in the *primary* defense-in-depth layer for an asset listed in the threat model. Includes: missing CSRF on a state-changing route the customer can reach, broken IDOR on a wallet/order resource, replay-window in the OTP/Telegram-login flow that is wider than its TTL, leaked secret in code or history. | urgent for finance / auth / admin; can-wait otherwise |
| **Medium** | Exploitable only with non-trivial effort or chained conditions, OR a defense-in-depth weakness with a redundant layer in front of it (e.g., CSP missing a directive that Origin/Referer already covers). | can-wait |
| **Low** | Best-practice deviation with no current exploit path; hardening opportunity. | can-wait or deferred |

**Calibration anchors** (so the scale stays consistent across findings):
- A leaked production database connection string in git history → **Critical**, regardless of whether the auditor has confirmed the secret is still valid.
- A missing CSRF check on a wallet top-up endpoint that is reachable from the browser → **Critical** if the unauthenticated case allows it; **High** if it requires an authenticated user.
- A logger redaction gap on an admin-only debug route → **Medium** at most (admin-only narrows blast radius), unless evidence shows a low-privileged user can reach it.
- Outdated dependency with a published CVE but no demonstrated reachable code path in SubNation → **Low** until the reachability is proven.

**Resolution rule for contested severity** (spec edge case): when a finding's severity is contested between criteria (e.g., low likelihood × catastrophic blast radius), `priorities.md` shows all five ranking inputs (severity, likelihood, blast radius, ease of exploitation, business impact) so the rank is auditable. The severity tier in `security.md` resolves toward whichever input represents the **largest possible loss**, not the most likely outcome — Critical is reserved for things that *can* happen, not things that *will* happen on average.

---

## 3. Coverage Matrix (FR-001)

Every cell below MUST be closed before audit sign-off. Each open cell is either: a list of `F-NNN` IDs, the literal string `non-issue` followed by a one-line note, or a `CG-NN` coverage-gap reference. Silent emptiness fails the audit.

`/speckit-implement` is responsible for filling the **Status** and **Findings / Notes / Gap** columns. Subsystems and surfaces are frozen by this Phase 0 — they are not edited at audit time without an amendment to spec FR-001.

| # | Subsystem | Surface | Status | Findings / Notes / Gap |
|---|-----------|---------|--------|------------------------|
| **AUTH-1** | Authentication | Google login (Firebase) | open | — |
| **AUTH-2** | Authentication | Telegram login (HMAC widget + Mini App) | open | — |
| **AUTH-3** | Authentication | WhatsApp OTP via OpenWA | open | — |
| **AUTH-4** | Authentication | Session cookie (`auth_token`) handling | open | — |
| **AUTH-5** | Authentication | JWT verification & secret strength (`SESSION_SECRET`) | open | — |
| **AUTH-6** | Authentication | Login state transitions (sign-in, sign-out, refresh) | open | — |
| **AUTH-7** | Authentication | Account linking / identity mapping across providers | open | — |
| **AUTH-8** | Authentication | Admin auth (argon2, TOTP 2FA, lockout, `_admin` cookie) | open | — |
| **AUTHZ-1** | Authorization | Admin endpoints role/permission boundary | open | — |
| **AUTHZ-2** | Authorization | User endpoints (own-resource) | open | — |
| **AUTHZ-3** | Authorization | Order endpoints | open | — |
| **AUTHZ-4** | Authorization | Wallet endpoints | open | — |
| **AUTHZ-5** | Authorization | Product / admin product-management endpoints | open | — |
| **AUTHZ-6** | Authorization | IDOR / privilege-escalation surface | open | — |
| **WALLET-1** | Wallet & Financial Integrity | Top-up flow (request, approval) | open | — |
| **WALLET-2** | Wallet & Financial Integrity | Balance change atomicity & optimistic lock | open | — |
| **WALLET-3** | Wallet & Financial Integrity | Append-only ledger invariant (`balanceBefore` / `balanceAfter`) | open | — |
| **WALLET-4** | Wallet & Financial Integrity | Coupon application | open | — |
| **WALLET-5** | Wallet & Financial Integrity | Purchase flow (single-transaction integrity) | open | — |
| **WALLET-6** | Wallet & Financial Integrity | Refund / adjustment paths | open | — |
| **WALLET-7** | Wallet & Financial Integrity | Replay / double-spend / race conditions | open | — |
| **API-1** | API & Input Handling | Request validation (Zod schemas in `shared/api-zod`) | open | — |
| **API-2** | API & Input Handling | Query-parameter handling | open | — |
| **API-3** | API & Input Handling | Route protection (auth/admin guards) | open | — |
| **API-4** | API & Input Handling | CSRF (Origin / Referer check) | open | — |
| **API-5** | API & Input Handling | CORS allow-list (`APP_ORIGINS`) | open | — |
| **API-6** | API & Input Handling | Open redirects | open | — |
| **API-7** | API & Input Handling | Unsafe URLs handed to clients | open | — |
| **API-8** | API & Input Handling | Webhook inputs | open | — |
| **API-9** | API & Input Handling | External-provider callbacks (Google / Telegram / OpenWA) | open | — |
| **INFRA-1** | Infrastructure & Deployment | Render service config (web / worker / redis) | open | — |
| **INFRA-2** | Infrastructure & Deployment | Neon connection (string handling, TLS, IP allow-list) | open | — |
| **INFRA-3** | Infrastructure & Deployment | Redis usage (rate-limit, leader-lock, socket adapter) | open | — |
| **INFRA-4** | Infrastructure & Deployment | Cloudflare Tunnel / WAF assumptions | open | — |
| **INFRA-5** | Infrastructure & Deployment | Environment variables surface (`config/env.example` vs. real env) | open | — |
| **INFRA-6** | Infrastructure & Deployment | Secret handling (storage, rotation, fail-fast on missing) | open | — |
| **INFRA-7** | Infrastructure & Deployment | Logging redaction & Sentry exposure | open | — |
| **INFRA-8** | Infrastructure & Deployment | Multi-tier rate limits (anonymous / authenticated / auth routes) | open | — |
| **INFRA-9** | Infrastructure & Deployment | Health / readiness endpoints (`/api/healthz`, `/status`) | open | — |
| **FE-1** | Frontend Security | Client-side auth state handling | open | — |
| **FE-2** | Frontend Security | Unsafe rendering (`dangerouslySetInnerHTML` and equivalents) | open | — |
| **FE-3** | Frontend Security | Dynamic HTML / Markdown rendering | open | — |
| **FE-4** | Frontend Security | Image URL handling (user-supplied / external) | open | — |
| **FE-5** | Frontend Security | External-link `rel`/`target` posture | open | — |
| **FE-6** | Frontend Security | XSS surface (sinks vs. sources) | open | — |
| **FE-7** | Frontend Security | Sensitive-data exposure in UI | open | — |
| **FE-8** | Frontend Security | Admin-only data leakage to non-admin clients | open | — |
| **SUP-1** | Supply Chain & Operational | Dependency tree & known-CVE reachability | open | — |
| **SUP-2** | Supply Chain & Operational | Build-time / runtime assumptions | open | — |
| **SUP-3** | Supply Chain & Operational | Hidden debug paths or dev-only routes left enabled | open | — |
| **SUP-4** | Supply Chain & Operational | Obsolete endpoints (e.g., retired phone+password mentioned in Constitution Principle II) | open | — |
| **SUP-5** | Supply Chain & Operational | Diagnostic logs / leftover testing hooks | open | — |
| **SUP-6** | Supply Chain & Operational | Pre-commit / gitleaks coverage gaps | open | — |

**Total**: 47 surfaces. Each MUST be closed at sign-off.

---

## 4. Evidence Notebook (template)

`/speckit-implement` populates this section. Each entry is one observation; multiple observations may roll up into one Finding.

```
### EN-NNN — <one-line title>

**Subsystem (matrix row)**: <e.g., AUTH-3>
**Path & range**: `path/to/file.ts:LL-LL`
**Excerpt** (≤ 3 lines, no secret values):
```ts
// excerpt here
```
**Behavior**: <what the code does, in plain language>
**Linked Findings**: <F-NNN, F-NNN…>
**Classification of the observation itself**: proven / likely / hypothesis
**Notes**: <reviewer-relevant context, conflicting signals, links to other ENs>
```

(No entries yet — population is the audit's job, not the plan's.)

---

## 5. External-Source Notes (template)

For each out-of-repo dashboard the auditor inspected, record one entry.

```
### XS-NN — <source name> — <date YYYY-MM-DD HH:MM TZ>

**Source**: <Render | Cloudflare | Sentry | Neon | …>
**Reader's access level**: <e.g., admin read-only>
**What was inspected**: <e.g., Render service env-var inventory for the `subnation-web` service>
**What was observed (no secret values)**: <plain-language description>
**Linked Findings or Gaps**: <F-NNN, CG-NN…>
```

(No entries yet.)

---

## 6. Coverage Gaps (template)

For each surface that cannot be fully reached without additional access.

```
### CG-NN — <one-line title>

**Subsystem (matrix row)**: <e.g., INFRA-4>
**What we cannot see from inside the repo**: <e.g., live Cloudflare WAF rule set>
**Assumption the audit is making**: <plain-language assumption>
**Access required to close the gap**: <e.g., read-only Cloudflare dashboard access>
**Worst-case finding if the assumption is wrong**: <severity tier + one-line description>
```

(No entries yet.)

---

## 7. Secret-Handling Log (template)

Every secret-class observation lands here AND in its own Finding. Per spec FR-042 and §1 D-09, values are never reproduced.

```
### SH-NN — <secret type> in <location>

**Secret type**: <API key | JWT signing secret | DB conn string | OAuth client secret | OpenWA token | Telegram bot token | encryption key | Sentry DSN | other>
**Location**: <path or log channel name; never the value>
**How the audit found it**: <git history scan | config inspection | log sample | dashboard view>
**Recommendation**: rotate (no exceptions), then remove from history if applicable.
**Linked Finding**: <F-NNN>
```

(No entries yet.)

---

## 8. Done-When (Phase 0)

This `research.md` is complete for Phase 0 when:

- [x] Methodology decisions D-01 through D-10 are recorded with Decision / Rationale / Alternatives.
- [x] §2 severity scale is defined with explicit calibration anchors.
- [x] §3 coverage matrix enumerates every surface from spec FR-001 (47 surfaces).
- [x] §§4–7 carry the empty-but-structured templates for evidence, external sources, gaps, and secrets.
- [x] No live findings are recorded (those belong to `/speckit-implement`, not Phase 0).

`research.md` will be appended to (not rewritten) by `/speckit-implement` as findings accumulate.
