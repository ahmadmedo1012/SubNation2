# Feature Specification: Auth and Wallet Anomaly Detection

**Feature Branch**: `003-anomaly-detection`
**Created**: 2026-06-02
**Status**: Draft (Design Only — awaiting review and approval before implementation)
**Input**: Proceed with AI Opportunity Pick #2 from the AI Opportunity
Assessment (`specs/001-ai-opportunity-assessment/assessment.md` §7.2).
Produce a complete technical design document. Do not implement, do
not create migrations, do not generate implementation tasks.

> **Scope of this document.** This is a design and decision
> artifact, not a plan to ship code. The downstream `/speckit-plan`
> and `/speckit-tasks` will follow only after the design is
> approved. The Constitution, the AI Opportunity Assessment, and
> this document together form the input to that downstream
> workflow.

---

## 1. User Scenarios & Testing *(mandatory)*

This is an **admin-facing** feature. The "users" are SubNation
operators (the founder and core maintainers) reviewing events in
the admin panel. The customer-facing surface is intentionally
minimal: legitimate customers see nothing; only abusive or
high-risk customers encounter a friction step (re-auth, throttling,
or hold).

### User Story 1 - Investigate a flagged event (Priority: P1)

An admin opens the daily review queue, clicks a high-risk event,
and within 30 seconds can answer: who did this, when, from where,
what did they try to do, and what should I do about it. The
investigation view shows the rule(s) that fired, the statistical
signal(s), and (in Phase 3) the ML score with top contributing
features. One click takes the admin from the event to the user's
full risk history.

**Why this priority**: This is the single most important
admin-facing surface. If investigation is slow or unclear, the
whole system fails its primary purpose.

**Independent Test**: A reviewer can answer the five questions
above (who/when/where/what/what-to-do) for a randomly selected
flagged event within 30 seconds of opening it.

**Acceptance Scenarios**:

1. **Given** a high-risk event in the review queue, **When** the
   admin opens it, **Then** the investigation view shows the user
   id, timestamp, IP/device fingerprint, attempted action, all
   rules that fired, all statistical signals, and (Phase 3) the
   ML score with top-3 contributing features.
2. **Given** a high-risk event, **When** the admin clicks "user
   history", **Then** they see the user's risk timeline
   (low → medium → high transitions), recent logins, recent
   top-ups, and recent orders.

---

### User Story 2 - Triage the daily review queue (Priority: P1)

A reviewer triages 30-60 events per day, batch-confirming obvious
false positives and escalating the rest. The review queue is
filterable by risk level, time, event type, and rule; bulk actions
let the reviewer confirm fraud or mark false positive for a batch
of similar events.

**Why this priority**: Daily triage is the steady-state workload.
If it is manual and slow, the system will accumulate backlog.

**Independent Test**: A reviewer can process 30 events (15
confirm-fraud, 15 mark-false-positive) in under 30 minutes.

**Acceptance Scenarios**:

1. **Given** the daily review queue, **When** the reviewer filters
   to "medium risk, last 24 hours", **Then** the queue shows only
   matching events.
2. **Given** a batch of similar events, **When** the reviewer
   selects 10 events and clicks "Mark all false positive", **Then**
   all 10 events are marked in one action, and the labels feed
   back into the model.

---

### User Story 3 - Configure risk thresholds and allowlists (Priority: P2)

An admin can tune the system without redeploying. Thresholds for
each risk level (low/medium/high/critical) and a small allowlist
(admin IPs, known corporate networks) are configurable from the
admin panel. Threshold changes are versioned and audit-logged.

**Why this priority**: Tuning is required for the rollout, but
the system is usable with safe defaults in the meantime.

**Independent Test**: An admin can change the high-risk threshold
from 60 to 70 from the admin panel, and the change takes effect
on the next event without a redeploy.

**Acceptance Scenarios**:

1. **Given** the threshold config screen, **When** the admin saves
   a new threshold, **Then** the change is written to the
   `risk_config` table, the audit log records who/when/what, and
   the new threshold is used for the next scored event.

---

### User Story 4 - Receive a critical alert (Priority: P2)

A critical event (score >= 85) triggers an immediate alert on the
existing `admin_alerts` channel (Telegram, Discord via the
existing `ALERTING_ENABLED` / `DISCORD_WEBHOOK_URL` infrastructure).
The alert includes the user id, the action attempted, the top
contributing features, and a one-click link to the investigation
view.

**Why this priority**: Critical events are time-sensitive; the
admin needs to act before the attacker does.

**Independent Test**: A synthetic critical event causes an alert
to appear in the configured channel within 60 seconds.

**Acceptance Scenarios**:

1. **Given** an event with score >= 85, **When** the scoring
   pipeline finishes, **Then** an alert is written to
   `admin_alerts` and broadcast via the existing alerting
   channel.

### Edge Cases

- **What if the scoring service is down?** The system MUST fall
  back to rules-only mode and MUST emit a Sentry error. The
  admin panel MUST show a banner indicating the degraded mode.
- **What if a known admin IP is the source of a high-risk event?**
  The allowlist MUST be consulted before any block action; the
  event is still logged but no block is applied.
- **What if the same user has many high-risk events (e.g.,
  traveling)?** The system MUST NOT auto-block a user for
  repeated medium events; the per-user aggregated profile
  considers the distribution of scores, not just the count.
- **What if a fraud pattern is novel?** The rule engine MUST
  allow quick addition of new rules from the admin panel without
  a deploy; the statistical engine MUST detect drift from
  baseline.
- **What if the model's prediction is confidently wrong?** The
  admin's "false positive" label MUST be persisted with
  provenance (which rule, which signal) and feed the next
  training run.

---

## 2. Threat Model

Each threat is named, the abuse pattern described, the business
risk quantified, and the data signals that would detect it listed.
This list is exhaustive of the threats this feature is designed
to address; threats outside this scope (e.g., supplier-side fraud,
admin-side compromise) are out of scope for this feature and
covered by existing controls.

### 2.1 Account Takeover (ATO)

**Pattern**: An attacker obtains a victim's credentials (phishing,
credential stuffing, SIM swap) and signs in. The attacker then
either purchases inventory for delivery, drains the wallet, or
uses the account as a mule.

**Business risk**: Direct loss of inventory (delivered to
attacker); chargeback exposure; customer trust loss; possible
processor penalties for high chargeback rates.

**Detection signals**:
- `login_attempts`: failed attempts spike before successful login.
- `auth_activity`: login from a new country / new device shortly
  after a successful login from elsewhere (impossible travel).
- `sessions`: multiple concurrent sessions from different IPs.
- `whatsapp_otps`: spike in OTP requests for the same phone number
  (OTP brute force or social engineering).
- `orders` after a fresh login from a new device: pattern of
  immediate high-value purchase.

### 2.2 Wallet Abuse (card testing, money mule)

**Pattern**: Stolen payment cards are tested with micro top-ups;
or a legitimate wallet is used as a money mule (rapid in-out).

**Business risk**: Payment-processor chargebacks; account bans
for the legitimate user; processor relationship risk; potential
loss of payment processing privileges.

**Detection signals**:
- `wallet_topups`: many small top-ups (e.g., 5 top-ups of 1.00
  LYD in 10 minutes) from the same user.
- `wallet_topups`: top-up → immediate full-wallet purchase →
  immediate delivery (cashout pattern).
- `orders`: high-value purchase shortly after first top-up
  from a new account.
- Cross-user: same card fingerprint used across multiple user
  accounts.

### 2.3 Suspicious Login Behavior

**Pattern**: Brute force on OTP, login from non-Arabic countries
with no prior history, scripted login attempts at unusual hours.

**Business risk**: OTP cost (WhatsApp OTP costs money per send);
infrastructure cost; noise that obscures real attacks.

**Detection signals**:
- `login_attempts`: failed attempts per IP, per phone, per user
  per unit time.
- `auth_activity`: distribution of login times vs user's history.
- `whatsapp_otps`: requests per phone per unit time.
- Geolocation distribution: sudden concentration of logins from
  a country that has no historical logins for this user.

### 2.4 Top-up Abuse (promotion stacking, refund-loops)

**Pattern**: User repeatedly tops up just under a threshold to
trigger a bonus; or claims a refund and re-tops-up to abuse a
new-user bonus.

**Business risk**: Direct margin loss; bonus pool drain.

**Detection signals**:
- `wallet_topups`: distribution of top-up amounts just below
  threshold values.
- `coupons`: same coupon used across multiple user accounts
  (see also 2.6).
- `wallet_ledger`: refund-then-top-up loops.

### 2.5 Automated Attacks (bots, credential stuffing)

**Pattern**: Bots attempt logins, OTPs, or purchases at a rate
no human could sustain. The rate-limit middleware already catches
the most egregious cases; this feature adds a smarter layer.

**Business risk**: Infrastructure cost; OTP cost; Sentry noise;
gives attackers a foothold if not detected.

**Detection signals**:
- `login_attempts`: requests per IP per second (sub-second
  cadence is almost certainly a bot).
- `auth_activity`: user-agent entropy — many distinct user
  agents from one IP in a short window is bot-shaped.
- TLS fingerprint: low-entropy JA3/JA4 is a strong bot signal.
- Behavior at the page level (no JavaScript, no mouse events).

### 2.6 Multi-account Abuse (promotion, referral, review)

**Pattern**: One person runs multiple accounts to stack
promotions, refer themselves, or manipulate reviews.

**Business risk**: Promotion leakage; referral-reward drain;
review integrity; brand-trust erosion.

**Detection signals**:
- `users` + `user_auth_identities`: same phone or same
  Telegram id or same Google account across multiple `users`.
- `users` + device fingerprint: same fingerprint across multiple
  accounts.
- `referral_events`: graph of referrals that closes a loop
  (A→B→C→A).
- `orders` + `coupons`: same coupon used across multiple accounts
  that share a fingerprint or IP.

---

## 3. Existing Data Sources

This feature is a **layer on top of existing signal**, not a new
pipeline. The tables and events below are already being written
by the current system; this feature reads them and produces
`risk_events`.

### 3.1 Database tables (already exist)

| Table | What it records | Threat relevance |
|---|---|---|
| `users` | Core user records, `created_at`, `isActive` | Account age, deactivation |
| `user_auth_identities` | Linked auth providers per user | Multi-account abuse |
| `auth_activity` | Every login event: provider, success/failure, IP, user agent, timestamp | ATO, suspicious login |
| `login_attempts` | Every login attempt including failures, with phone/email/IP | Brute force, credential stuffing |
| `sessions` | Active sessions: `sessionId`, `userId`, `expiresAt`, IP, user agent | Concurrent sessions, ATO |
| `whatsapp_otps` | OTP requests and verifications: phone, code, TTL, IP | OTP brute force, social engineering |
| `wallet_topups` | Top-up records: amount, method, status, timestamp | Card testing, money mule |
| `wallet_ledger` | Append-only balance history: `balanceBefore`, `balanceAfter`, `kind` | Wallet abuse, cashout pattern |
| `orders` | Orders: user, amount, status, products, delivery timestamp | ATO → purchase, cashout |
| `coupons` | Coupon definitions and usage | Coupon stacking |
| `referral_events` | Referral graph: referrer, referee, reward | Referral-loop abuse |
| `admin_alerts` | Existing alert infrastructure | Critical event alerting |
| `audit_logs` | Admin actions | Threshold-change audit |

### 3.2 Events and signals (already in flight)

- **HTTP request logs** (Pino structured): every request includes
  `requestId`, `userId` (if any), IP, route, status, latency.
  The new pipeline reads these for stateless signals (request
  rate per IP, route entropy).
- **Rate-limit Redis counters**: the existing
  `IP 600/min unauth`, `1200/min per user`, `10/15min auth`
  buckets are first-class signals. A user who is at the rate
  limit and continues attempting is suspicious.
- **Sentry breadcrumbs**: structured breadcrumbs already capture
  auth events and admin actions. They are a secondary signal.
- **Telegram login replay protection**: Telegram hashes stored
  in Redis with TTL are an existing anti-replay signal. They
  become a model feature.

### 3.3 New data structures required (design only, no migration yet)

> The following are proposed for the implementation phase. They
> are documented here so the design is reviewable end-to-end,
> but no migration is created in this branch.

- `risk_events`: one row per scored event. Fields: `id`,
  `userId`, `eventType` (login, top-up, order, otp_request),
  `score` (0-100), `level` (low/medium/high/critical),
  `confidence` (0-1), `ruleFired` (array), `statisticalSignals`
  (jsonb), `mlScore` (nullable, Phase 3), `topFeatures`
  (jsonb, Phase 3), `actionTaken` (log/soft-block/hard-block/alert),
  `createdAt`.
- `risk_rules`: rule definitions. Fields: `id`, `name`,
  `description`, `expression` (declarative), `enabled`,
  `version`, `createdBy`, `createdAt`, `updatedAt`.
- `risk_config`: singleton config. Fields: `thresholds`
  (low/medium/high/critical), `allowlist` (IPs, devices,
  phones), `autoBlockEnabled` (per level), `updatedBy`,
  `updatedAt`.
- `risk_labels`: human-confirmed labels. Fields: `riskEventId`,
  `label` (confirmed_fraud, false_positive, escalated),
  `labeledBy`, `labeledAt`, `notes`. Feeds the model
  retraining pipeline.

---

## 4. Detection Framework

The framework is layered, defense-in-depth, and Constitution-
compliant (Principle IV: each layer is independent; the
absence of one layer does not collapse the others).

### 4.1 Rules-based detection (Phase 1)

Hard thresholds and conjunctions. Deterministic, easy to audit,
easy to add to from the admin panel. Examples:

- "OTP requests for the same phone > 5 in 15 minutes" → block
  the channel for 1 hour.
- "Failed login attempts from same IP > 10 in 15 minutes"
  (already exists in rate limiter; promoted to a labeled
  signal here).
- "Login from new country + new device within 1 hour of
  last successful login from a different country" → medium risk.
- "First top-up > 100 LYD within 24h of account creation"
  → high risk; require admin approval before delivery.
- "Same card fingerprint across > 2 user accounts" → high
  risk; freeze all involved accounts pending review.

### 4.2 Statistical detection (Phase 2)

Per-user baselines; deviation from baseline is the signal.
All thresholds are configurable.

- **Z-score on top-up amount**: per user, over the last
  90 days. A top-up > 3σ from the user's mean is suspicious.
- **Z-score on hourly login rate**: per user. A burst > 3σ
  from baseline is suspicious.
- **Velocity**: number of orders in the last 1h / 6h / 24h
  vs the user's median. A 5x spike is suspicious.
- **Geolocation entropy**: number of distinct countries
  per user per 30 days. A sudden new country is suspicious.
- **Time-of-day deviation**: a customer's purchases usually
  cluster in 18:00-23:00 local; a purchase at 03:00 is
  anomalous for that user.

### 4.3 Lightweight ML (Phase 3)

A small gradient-boosted model (e.g., `lightgbm` or
`@xenova/transformers`-style) trained on labels collected in
Phases 1-2. Per-event fraud probability (0-1), per-user
aggregated risk score.

Features (sample):

- Event-type one-hot
- Per-user aggregates: account age, lifetime top-up count,
  lifetime order count, average top-up amount, std-dev
  top-up amount
- Time features: hour-of-day, day-of-week, days-since-signup
- Geo features: country of IP, is-new-country-for-user
- Recent activity: failed-login-count-last-1h,
  otp-request-count-last-1h, top-up-amount-last-1h,
  order-count-last-1h
- Cross-user: same-fingerprint-account-count-last-7d,
  same-card-account-count-last-7d

The model is **small** and **explainable**: a per-event
prediction is accompanied by the top-3 contributing features
(SHAP values, simplified for latency). The model is **never
on the critical path of a purchase** (Constitution Principle
I): it scores after the fact and decides on a follow-up
action, never gates the transaction.

### 4.4 Explainability requirements

Every score MUST be explainable. Specifically:

- Every scored event has a `ruleFired` array (the rules that
  triggered, with their thresholds).
- Every scored event has a `statisticalSignals` jsonb
  capturing which statistical signals fired and by how much.
- In Phase 3, every scored event has `topFeatures` (top-3
  SHAP values) and the model's `confidence`.
- The admin investigation view MUST be able to render a
  human-readable explanation: "This event was scored 78
  (high) because: 4 failed logins in last 10 min, login
  from a new country, top-up +500 LYD within 1h of
  account creation."
- The model MUST NOT be a black box. If the explanation
  is not intelligible, the model is not deployed (kill
  criterion).

---

## 5. Risk Scoring System

### 5.1 Score range

- **0-100**, integer. Higher = more risky. The scale is
  intuitive (0 = safe, 100 = definitely fraud) and bounded
  (no outliers, no log-scale confusion).
- A separate **confidence** value (0.0-1.0) expresses how
  sure the scorer is. Low confidence + medium score is
  treated differently from high confidence + medium score.

### 5.2 Risk levels

| Level | Score | Action |
|---|---|---|
| **Low** | 0-29 | Log only; no action. |
| **Medium** | 30-59 | Log; write to `admin_alerts` with low priority; surface in the review queue. |
| **High** | 60-84 | Log; alert; soft-block (force re-auth on next action); surface at top of review queue. |
| **Critical** | 85-100 | Log; alert (Telegram/Discord); hard-block on the action that triggered; immediate admin notification. |

The mapping is configurable in `risk_config` so the admin can
tune without redeploy.

### 5.3 Confidence scoring

A separate `confidence` value (0-1) modifies how aggressively
the system acts:

- High score + high confidence → action as above.
- High score + low confidence → log only, no block. The
  event is still in the review queue.
- Medium score + high confidence → log + alert; no block.
- Medium score + low confidence → log only.

This separates "we saw something" from "we believe it",
which is the core defense against false positives.

### 5.4 False-positive mitigation

Multiple orthogonal mechanisms:

- **Allowlist** in `risk_config`: admin IPs, known corporate
  networks, known good devices. Events from allowlisted
  sources are still logged but never trigger blocks.
- **Confidence threshold** for auto-block: a per-level
  minimum confidence is required to act. Phase 1 ships with
  conservative defaults; the admin can raise them.
- **Whitelist for new geographic regions** during the first
  30 days of rollout: a new country is a medium signal, not
  a high one, until the user has a stable history there.
- **Admin override**: any block can be lifted; the override
  is recorded in `audit_logs` and feeds the model.
- **Per-user aggregated profile**: the per-event score is
  combined with the user's recent score history. A user
  with persistent low scores is not auto-blocked on a
  single medium event; a user whose score trend is rising
  is escalated earlier.
- **Constitution compliance**: no new auth path; blocks
  are friction steps (re-auth, throttling, hold), not
  customer lockouts without recourse.

---

## 6. Admin Experience

The admin experience is layered on the existing admin panel
(`backend/src/routes/admin/*`, `frontend/src/components/Admin*`).
No new admin product is built; this feature extends the
existing surface.

### 6.1 Dashboard layout

A new "Risk & Fraud" tab in the admin panel. The dashboard
shows:

- **Top-line metrics** (today vs 7-day average):
  - Events scored
  - % flagged (medium + above)
  - Confirmed-fraud rate
  - False-positive rate (over labeled events)
- **Live risk feed**: top 10 high-risk events in the last
  hour, with a one-click link to the investigation view.
- **User risk heatmap**: a list of the 20 users with the
  highest aggregated risk in the last 24h.
- **Rule health**: which rules have fired most in the last
  24h; which rules are stale (haven't fired in 30+ days
  and may be too narrow).

### 6.2 Review queue

A filterable, sortable list of events:

- Filters: risk level, event type, time range, rule fired,
  user search.
- Bulk actions: confirm-fraud, mark-false-positive,
  escalate, dismiss.
- Per-row quick actions: lock account, force re-auth,
  require admin approval for next top-up.

### 6.3 Investigation workflow

Per-event view:

- **Header**: user id, score, level, confidence, action
  taken, timestamp.
- **Rule panel**: which rules fired, with their
  thresholds and the values that triggered.
- **Statistical signals panel**: z-scores, velocity,
  time-of-day deviation, geo-entropy.
- **ML panel** (Phase 3): score, confidence, top-3
  contributing features with one-line explanations.
- **User timeline**: risk score over time, recent
  logins, recent top-ups, recent orders.
- **Action panel**: lock, force re-auth, require approval,
  dismiss. Each action is audit-logged.

### 6.4 Alert workflow

- **Critical events** (score >= 85) trigger an immediate
  alert via the existing `admin_alerts` infrastructure
  (Telegram bot, Discord webhook when `ALERTING_ENABLED=true`).
- The alert includes: user id, attempted action, top
  contributing features, link to the investigation view.
- **Daily digest** (composes with the O1 "Daily admin
  alert digest" pick from the assessment): one Telegram
  message at admin-local morning time with the day's
  top-10 highest-risk events, the day's confirmed-fraud
  count, and the false-positive rate over the last 7
  days.

### 6.5 Risk history per user

A per-user view:

- **Risk timeline**: score over the last 90 days, with
  the level transitions highlighted.
- **Event log**: every scored event for this user, with
  its score, level, action, and admin labels.
- **Feature snapshot at time of flag**: what the user's
  profile looked like when they crossed from low to
  medium (or medium to high). This is the artifact an
  investigator uses to reconstruct what happened.
- **Action history**: every admin action on this user
  (lock, force re-auth, approval) with the actor and
  timestamp.

---

## 7. Operational Design

### 7.1 Cost estimate

The cost target is **< $5/day at expected volume** (estimated
50K events/day scored).

- **Phase 1 (rules-only)**: negligible cost. Rule evaluation
  is in-process, sub-millisecond per event.
- **Phase 2 (statistical)**: negligible cost. Z-score
  computation is in-process. The data for baselines is
  already in Postgres.
- **Phase 3 (ML)**: per-event inference on a small model
  is on the order of sub-cent per 1000 events when
  self-hosted; ~$0.001-$0.01 per 1000 events on a cheap
  hosted inference API. At 50K events/day, ~$0.05-$0.50/day.

The cost is bounded by the per-event ceiling in the cost
test (10% of monthly ROI) — this is a low-cost-band feature.

### 7.2 Performance impact

- **Sync paths** (login, OTP verification, checkout):
  - Phase 1: < 5ms added p95 latency (rule eval is cheap).
  - Phase 2: < 20ms added p95 (statistical aggregates are
    in-memory after first read).
  - Phase 3: < 50ms added p95 for non-critical events; for
    critical paths (checkout), the score is **observed
    after the transaction** and acts on the next action,
    not the current one. Constitution Principle I is
    preserved.
- **Async paths** (post-event scoring, daily digest):
  the scoring job runs in a queue (`subnation-worker`),
  not on the request path.

### 7.3 Storage impact

- `risk_events`: ~1KB per row, 50K events/day = ~50MB/day
  = ~18GB/year. Mitigated by a 90-day retention policy
  with a 7-day extension for labeled events (model
  training data).
- `risk_rules` and `risk_config`: negligible.
- `risk_labels`: ~10K labels/day (post-triage) = ~5MB/day
  = ~2GB/year. Kept indefinitely; this is the training
  data.

### 7.4 Monitoring requirements

- **Sentry**: every scoring job failure, every rule
  evaluation exception, every alert delivery failure.
- **Prometheus** (`/metrics`):
  - `risk_events_scored_total{event_type, level}` counter.
  - `risk_scoring_duration_seconds{event_type}` histogram.
  - `risk_rule_fired_total{rule_id}` counter.
  - `risk_alerts_sent_total{channel, level}` counter.
  - `risk_labels_total{label}` counter (for false-positive
    rate calculation).
- **`/status`** page: includes the risk-scoring service
  health (green/yellow/red), the queue depth, and the
  false-positive rate over the last 24h.
- **Grafana dashboards** (extending the existing
  observability): risk dashboard, rule health,
  per-user top-10.

### 7.5 Failure modes

| Failure | Behavior |
|---|---|
| Scoring service down | Fall back to **rules-only**; emit Sentry error; show degraded-mode banner in admin panel. |
| Redis (rate-limit / sessions) unavailable | Existing rate-limit degrades; new scoring layer also degrades. Existing rate-limit fallback (in-memory in dev) applies. |
| Postgres read lag | Statistical aggregates read from a slightly stale snapshot; the staleness is bounded and surfaced. |
| Queue (`subnation-worker`) down | Async scoring backlog grows; alert admin. Sync paths (login, checkout) use the sync fast-path with rules-only. |
| ML model fails to load | Phase 1 + Phase 2 still operate; Phase 3 is disabled until model is restored. Kill switch in `risk_config`. |
| Alert channel (Telegram/Discord) down | Critical events still logged in `admin_alerts`; the existing runbook escalation applies. |

---

## 8. Rollout Plan

Three phases, each independently shippable, each with its own
kill criterion.

### 8.1 Phase 1: Rules-only (target: 2-3 weeks)

**Scope**:
- Implement the rule engine. ~5-10 initial rules covering the
  most obvious patterns (OTP brute force, impossible travel,
  new-account-large-top-up).
- No new tables. Rules live in code; admin panel exposes a
  toggle per rule.
- Admin investigation view: rule panel + user timeline +
  action panel.
- All actions log to `admin_alerts` and `audit_logs`.
- Constitution Principle IV check: rules are independent
  layers; rate-limit, CSP, CSRF, redaction, 2FA remain
  unchanged.

**Labels**: admin-confirmed-fraud and admin-marked-false-
positive become first-class actions in the admin panel. The
labels are stored in `audit_logs` for now (no new table in
Phase 1) and are migrated to `risk_labels` in Phase 2.

**Kill criterion**: if rules-only causes >= 1% legitimate-
user throttle in any 7-day window, raise the rule
thresholds or revert.

### 8.2 Phase 2: Statistical detection (target: 4-6 weeks)

**Scope**:
- Add `risk_events`, `risk_rules`, `risk_config`, `risk_labels`
  tables (migrations only here, with strict review).
- Implement z-score and velocity signals.
- Admin investigation view: statistical signals panel.
- Review queue: filterable, sortable, bulk actions.
- Daily digest (composes with O1 from the assessment).
- Critical-event alerting via `admin_alerts`.

**Labels**: now persisted in `risk_labels`. The dataset
becomes the training corpus for Phase 3.

**Kill criterion**: if statistical signals add < 10%
detection precision over rules-only (measured on
admin-labeled events), stop and ship Phase 1 as the
final form.

### 8.3 Phase 3: ML-assisted scoring (target: 8-12 weeks)

**Scope**:
- Train a small gradient-boosted model on the labels
  collected in Phases 1-2.
- Per-event fraud probability + per-user aggregated
  score.
- SHAP-based explanation; top-3 contributing features
  in the investigation view.
- Confidence-aware auto-block; allowlist + confidence
  thresholds prevent the model from over-acting.

**Labels**: the model retrains weekly on the latest
labeled dataset. The training pipeline is auditable
(version, data slice, hyperparameters).

**Kill criterion**: if the model AUC < 0.7 on hold-out,
or if the SHAP explanations are unintelligible to a
non-technical admin in a user test, the model is not
deployed. Phase 2 is the fallback.

---

## 9. Success Metrics

The feature is **successful** when all of the following are
sustained over a 90-day window. The metrics are reviewed
monthly in `PLATFORM.md`.

### 9.1 Fraud reduction

- **FR-1**: 50% drop in confirmed-fraud chargebacks in 90
  days post-Phase-3, compared to the 90-day pre-Phase-1
  baseline.
- **FR-2**: 30% drop in OTP-cost per active user per month
  in 90 days post-Phase-1 (fewer brute-force requests
  getting through to OTP dispatch).

### 9.2 Detection accuracy

- **DA-1**: Precision >= 0.80 on confirmed-fraud events
  (i.e., when the model says "fraud", it is fraud >= 80%
  of the time).
- **DA-2**: Recall >= 0.60 on confirmed-fraud events
  (i.e., the model catches >= 60% of fraud).
- **DA-3**: AUC >= 0.85 on hold-out, sustained across
  two consecutive retrains.

### 9.3 False-positive rate

- **FP-1**: < 1% of legitimate users throttled in any
  7-day rolling window.
- **FP-2**: < 0.1% of legitimate users hard-blocked in
  any 30-day rolling window.
- **FP-3**: Admin "false positive" rate on medium-risk
  events <= 30% in any 30-day window (i.e., the
  medium-risk queue is mostly signal, not noise).

### 9.4 Admin workload impact

- **AW-1**: Average triage time per event <= 30 seconds
  (measured by `risk_labels.createdAt - risk_event.shownAt`).
- **AW-2**: Daily review workload <= 30 minutes for one
  reviewer (i.e., < 60 events/day assuming 30s/event).
- **AW-3**: Alert-to-action time on critical events
  <= 15 minutes median, <= 60 minutes p95.

---

## 10. Kill Criteria

The feature is **retired** if any of the following are true
sustained over a 30-day window. Retirement is reversible
(rules can be re-enabled) but the decision to retire is
made by the founder + a maintainer, audit-logged.

### Per-phase kill criteria

- **Phase 1**: if rules-only causes >= 1% legitimate-user
  throttle in 7 days, raise the rule thresholds or revert.
- **Phase 2**: if statistical signals add < 10% detection
  precision over rules-only, stop and ship Phase 1 as the
  final form.
- **Phase 3**: if the model AUC < 0.7 on hold-out, or if
  SHAP explanations are unintelligible in user testing, do
  not deploy the model. Phase 2 is the fallback.

### Global kill criteria

- **GK-1**: if cumulative cost (engineering maintenance +
  admin triage time + ongoing inference) exceeds the
  recovered fraud loss for any 30-day window, retire.
- **GK-2**: if the false-positive rate (FP-1) is exceeded
  for two consecutive 7-day windows, freeze the system
  and audit thresholds before re-enabling.
- **GK-3**: if the model introduces a new class of
  customer-facing failure (e.g., a legitimate customer
  locked out without recourse) that the Constitution's
  defense-in-depth framework does not catch, retire.
- **GK-4**: if the system becomes a single point of
  failure (e.g., the scoring service is required for
  checkout to succeed), retire and ship Phase 1 as the
  final form. The Constitution explicitly forbids the
  AI from being a gate on the purchase path.

---

## 11. Comparison with Other Picks

This section explains why this pick should (or should not)
be the first AI feature implemented in SubNation. It
references the AI Opportunity Assessment
(`specs/001-ai-opportunity-assessment/assessment.md`).

### 11.1 Why this should be the first pick

| Dimension | Pick 1 (forecasting) | Pick 2 (anomaly detection) | Pick 3 (enrichment) |
|---|---|---|---|
| Impact (assessment §5) | 5 | **5** | 4 |
| Complexity | 3 | 3 | 3 |
| Operating cost | 1 | **1** | 1 |
| Maintenance | 2 | 2 | 2 |
| Cost band | statistical / small-model | **statistical → small-model** | batched-llm + small CV |
| Defends a Constitution principle | (no direct defense) | **IV (Defense in Depth)** | (no direct defense) |
| Data substrate | orders + inventory | auth_activity + login_attempts + wallet_topups + orders | products + image URLs |
| Data quality risk | medium (never audited) | **low (clean labeled signals)** | medium (Arabic quality variable) |
| Time to value | weeks (stockout predictions) | **days (label-collection)** | days (per-product batch) |
| Reversibility | high (predictions are advisories) | **medium (false-blocks hurt customers)** | high (per-product) |
| Risk to legitimate users | low | **medium** | low |

**Summary**: Pick 2 has the same impact as Pick 1 (both 5/5)
and the same cost band, but **defends a Constitution
principle** (IV: Defense in Depth) and **layers on top of
existing signal** (the rate-limit, audit, and 2FA stack).
It is the pick that most directly **earns its place** in
the security-hardened stack that already exists in
SubNation.

### 11.2 Why not Pick 1 (Demand Forecasting) first

- **Data quality is unverified**. The orders and inventory
  data has never been audited for the kind of clean
  time-series signal that forecasting depends on. An
  inventory-forecasting model that is built on noisy data
  is worse than no model.
- **Longer time-to-value**. A stockout prediction has to
  be acted on (restock ordered, delivered) for weeks
  before the prediction is verified. Anomaly detection
  has a feedback loop measured in days.
- **Lower reversibility** (paradoxically). A wrong
  forecast leads to overstocking (working capital lock)
  or understocking (lost sales). A wrong anomaly
  detection leads to a friction step (re-auth) that
  the customer can resolve. The blast radius of a wrong
  forecast is larger in the long run.
- **Lower alignment with Constitution**. Forecasting is
  not defense-in-depth. It is an operational
  optimization. Anomaly detection is.

### 11.3 Why not Pick 3 (Enrichment) first

- **Lower impact** (4 vs 5). The lever is conversion
  uplift, which is a long, noisy, hard-to-attribute
  metric. Anomaly detection has a clean before/after
  on chargeback rate.
- **Higher maintenance burden** in practice: admin
  override rate is the explicit kill criterion, and
  Arabic-quality output requires ongoing human review.
- **No Constitution principle defended**. Enrichment is
  a quality-of-life feature; anomaly detection is a
  security feature.
- **Bigger engineering surface** (LLM integration, image
  CV, admin UI for review). Anomaly detection is
  primarily a back-end pipeline; enrichment is back-end
  + admin UI + customer-facing impact.

### 11.4 Final recommendation

**Pick 2 (Auth and Wallet Anomaly Detection) is the right
first AI feature for SubNation**, because:

1. It has the highest impact and lowest cost of the three
   picks, in absolute terms.
2. It directly defends a Constitution principle (IV:
   Defense in Depth), which is the principle most
   aligned with the existing security-hardened stack.
3. It has the cleanest data substrate and the fastest
   feedback loop.
4. It does not require a customer-facing UI, a new auth
   path, or a model on the purchase critical path — all
   of which are explicit Constitution no-gos for this
   project.

The other two picks are excellent follow-ons but should
not be the first. Pick 1 has unverified data quality;
Pick 3 has higher maintenance and lower impact.

---

## 12. Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST score all login attempts,
  top-ups, and orders against baseline behavior and
  produce a 0-100 risk score per event.
- **FR-002**: The system MUST classify each event into
  one of four risk levels (low, medium, high, critical)
  with configurable thresholds.
- **FR-003**: The system MUST support a soft-block
  (force re-auth) and a hard-block path; the action
  taken is derived from the level and confidence, both
  configurable.
- **FR-004**: The system MUST log every scored event
  with a human-readable explanation: the rules that
  fired, the statistical signals, and (Phase 3) the
  top-3 SHAP features.
- **FR-005**: The system MUST allow the admin to
  configure thresholds and allowlist from the admin
  panel without redeploying; changes are audit-logged.
- **FR-006**: The system MUST provide a daily review
  queue with filters, sort, and bulk actions
  (confirm-fraud, mark-false-positive, escalate).
- **FR-007**: The system MUST alert on critical events
  via the existing `admin_alerts` channel (Telegram,
  Discord) within 60 seconds of scoring.
- **FR-008**: The system MUST persist human labels
  (`confirmed_fraud`, `false_positive`, `escalated`) for
  every reviewed event, and those labels MUST feed the
  next model retrain.
- **FR-009**: The system MUST be Constitution-compliant:
  no new auth path (Principle II), no AI on the
  purchase critical path (Principle I), defense-in-depth
  (Principle IV), full observability (Principle V).
- **FR-010**: The system MUST be safe by default: if
  the scoring service is down, the system MUST fall
  back to rules-only and MUST NOT block legitimate
  customers.

### Key Entities

- **RiskEvent**: A scored event. Fields: `id`, `userId`,
  `eventType`, `score` (0-100), `level`
  (low/medium/high/critical), `confidence` (0-1),
  `ruleFired` (array), `statisticalSignals` (jsonb),
  `mlScore` (nullable), `topFeatures` (jsonb),
  `actionTaken` (log/soft-block/hard-block/alert),
  `createdAt`.
- **RiskRule**: A rule definition. Fields: `id`, `name`,
  `description`, `expression` (declarative), `enabled`,
  `version`, `createdBy`, `createdAt`, `updatedAt`.
- **RiskConfig**: A singleton configuration. Fields:
  `thresholds` (low/medium/high/critical), `allowlist`
  (IPs, devices, phones), `autoBlockEnabled` (per level),
  `updatedBy`, `updatedAt`.
- **RiskLabel**: A human-confirmed label. Fields:
  `riskEventId`, `label` (confirmed_fraud /
  false_positive / escalated), `labeledBy`, `labeledAt`,
  `notes`. Feeds the model retraining pipeline.

---

## 13. Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Fraud)**: 50% drop in confirmed-fraud
  chargebacks in 90 days post-Phase-3, vs the 90-day
  pre-Phase-1 baseline (FR-1).
- **SC-002 (Detection accuracy)**: Precision >= 0.80
  and recall >= 0.60 on confirmed-fraud events, AUC
  >= 0.85 on hold-out, sustained across two consecutive
  retrains (DA-1, DA-2, DA-3).
- **SC-003 (False positives)**: < 1% legitimate-user
  throttle in any 7-day rolling window (FP-1);
  < 0.1% legitimate-user hard-block in any 30-day
  window (FP-2).
- **SC-004 (Admin workload)**: Average triage time
  per event <= 30 seconds (AW-1); daily review workload
  <= 30 minutes for one reviewer (AW-2).
- **SC-005 (Critical alert latency)**: Critical-event
  alert appears in the admin channel within 60 seconds
  of scoring; admin-to-action time on critical events
  <= 15 minutes median, <= 60 minutes p95 (AW-3).
- **SC-006 (Constitution compliance)**: Zero new auth
  paths introduced (Principle II check); zero AI on
  purchase critical path (Principle I check); every
  shipped rule/pipeline is observable on `/status`
  (Principle V check).

---

## 14. Assumptions

- The existing data substrate (`auth_activity`,
  `login_attempts`, `wallet_topups`, `orders`, `users`,
  `user_auth_identities`, `sessions`, `whatsapp_otps`,
  `wallet_ledger`, `coupons`, `referral_events`,
  `admin_alerts`, `audit_logs`) is sufficient to
  detect all threats listed in §2 without new
  instrumentation. If a signal is found missing during
  Phase 1 or Phase 2, an additional data-collection
  step is required and is part of the implementation
  plan, not the design.
- The admin team can dedicate ~30 minutes per day to
  review the queue, and 5-10 minutes per critical
  event for investigation. The workload is bounded by
  AW-2.
- The existing `admin_alerts` channel (Telegram bot,
  Discord webhook via `ALERTING_ENABLED` and
  `DISCORD_WEBHOOK_URL`) is the alert path; this design
  does not introduce a new alerting system.
- Phase 1 ships with conservative defaults. The admin
  can tune thresholds from the panel. The system is
  safe-by-default; raising aggressiveness is opt-in.
- The model in Phase 3 is **off-the-shelf small**
  (e.g., `lightgbm` or a hosted equivalent), not a
  custom deep model. The cost/ROI test (10% cap on
  inference vs monthly ROI) is satisfied trivially.
- The Constitution (`.specify/memory/constitution.md`)
  is ratified and binding. Any conflict between this
  design and the Constitution is resolved in favor of
  the Constitution.
- This feature is the *first* AI feature in SubNation.
  The success or failure of this pick sets the
  precedent for future AI work; the kill criteria
  exist precisely to retire the feature if it does
  not earn its keep.

---

## Appendix A — Cross-references

- **AI Opportunity Assessment**:
  `specs/001-ai-opportunity-assessment/assessment.md` §7.2
  (Top Pick 2), §4.3 (Automation AI), §6 (Rejections),
  §8 (Roadmap).
- **AI Opportunity Research**:
  `specs/001-ai-opportunity-assessment/research.md` §1
  (Auth), §2 (Wallet & Top-Ups).
- **AI Opportunity Data Model**:
  `specs/001-ai-opportunity-assessment/data-model.md`
  (Opportunity / TopPick / RubricDimension / SubsystemAnchor).
- **Constitution**:
  `.specify/memory/constitution.md` Principles I, II, III,
  IV, V; Domain Constraints (Arabic-First, Stack).
- **Project state**:
  `README.md`, `PROJECT_OVERVIEW.md` (architecture and
  known gaps), `PLATFORM.md` (production-readiness
  scoring), `OPERATIONS_RUNBOOK.md` (alerting and
  escalation).

> **Implementation note.** This document is design-only.
> No migrations, no code, and no implementation tasks
> are produced in this branch. The next phase is
> approval. If approved, `/speckit-plan` and
> `/speckit-tasks` will run on a follow-up branch
> against this design, with the migrations
> intentionally split out for review.
