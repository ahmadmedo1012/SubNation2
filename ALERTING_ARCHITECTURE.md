# Alerting Architecture

This document describes the operational alerting subsystem (separate from the
existing business-event Telegram webhook in `backend/src/telegram.ts`).
Implemented in `backend/src/services/alerting.service.ts`. Started from
`backend/src/worker.ts` so the evaluator runs in a single worker process,
not in every web instance.

## 1. Taxonomy

| Severity   | Meaning                                    | Default channels                   |
| ---------- | ------------------------------------------ | ---------------------------------- |
| `info`     | informational, includes resolution events  | Telegram, Discord                  |
| `warning`  | service degraded, customer impact possible | Telegram, Discord, generic webhook |
| `critical` | customer-facing outage or data risk        | all channels, on-call paged        |

## 2. Rules (10 total)

| #   | Name                              | Severity | Window | Threshold     | Runbook anchor     |
| --- | --------------------------------- | -------- | ------ | ------------- | ------------------ |
| 1   | `api_5xx_rate_high`               | warning  | 5 min  | > 5%          | `#api-5xx`         |
| 2   | `auth_failure_rate_high`          | warning  | 5 min  | > 20%         | `#auth-failure`    |
| 3   | `firebase_verifyidtoken_failures` | critical | 5 min  | > 5           | `#firebase-verify` |
| 4   | `frontend_sentry_error_rate_high` | warning  | 1 min  | > 10/min      | `#fe-sentry`       |
| 5   | `redis_disconnect`                | info     | 60 s   | ≥ 1 event     | `#redis`           |
| 6   | `neon_connection_failure`         | critical | 60 s   | ≥ 1 failure   | `#neon`            |
| 7   | `worker_heartbeat_missing`        | critical | 2 min  | no heartbeat  | `#worker`          |
| 8   | `api_p95_latency_high`            | critical | 5 min  | p95 > 1500 ms | `#latency`         |
| 9   | `worker_job_failures_high`        | warning  | 5 min  | > 3 fails     | `#jobs`            |
| 10  | `abnormal_lockouts`               | warning  | 5 min  | ≥ 10 lockouts | `#lockouts`        |

The rule registry is exported as `ALERT_RULES` from
`backend/src/services/alerting.service.ts`.

> Rule **evaluation** is currently a no-op default — `checkRuleCondition()`
> returns `false`. Production wiring of metric reads (Prometheus aggregation
> or Redis time-series) is a P2 follow-up: the dispatch / dedup / rate-limit
> path is fully real and is exercised end-to-end by the admin test endpoint.

## 3. Channels

| Channel                     | Implementation                                                                                | Required env                             |
| --------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Telegram (primary)          | `POST https://api.telegram.org/bot{TOKEN}/sendMessage` with `disable_web_page_preview: false` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Discord webhook (secondary) | `POST {DISCORD_WEBHOOK_URL}` with `embeds` payload, severity-coloured                         | `DISCORD_WEBHOOK_URL`                    |
| Generic webhook (secondary) | `POST {GENERIC_ALERT_WEBHOOK_URL}` with raw `AlertEvent` JSON                                 | `GENERIC_ALERT_WEBHOOK_URL`              |

A channel without configured credentials short-circuits as `outcome:"skipped"`
and is **not** counted against the rate limit.

## 4. Delivery semantics

For each channel, dispatch follows:

```
isDeduped(dedupKey) → return outcome:"deduped"
isRateLimited()     → return outcome:"rate-limited"
sendChannel()        // 10 s timeout via AbortSignal.timeout
on failure:
   wait 5 s
   sendChannel()      // single retry
on retry failure:
   incrementAlertsDispatched(outcome:"failed")
   captureException to Sentry
   continue with other channels
```

Each channel is dispatched in `Promise.all` so a Telegram failure cannot
block Discord.

## 5. Production-Safe rate limit & dedup

| Mechanism         | Storage                                           | Window                           | Behaviour                           |
| ----------------- | ------------------------------------------------- | -------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| Per-key dedup     | Redis `SET alert:dedup:${rule}                    | ${stableHash(labels)} NX EX 300` | 5 min                               | second invocation within window → `outcome:"deduped"` |
| Global rate limit | Redis `INCR alert:global:${minute}` + `EXPIRE 70` | rolling 60 s                     | > 30/min → `outcome:"rate-limited"` |

Both fail open if Redis is unavailable: better to over-alert than to silently
drop critical events.

`stableHash` is a 16-char SHA-1 prefix of the JSON-stringified labels —
deterministic, no PII.

## 6. Resolution events

When a rule transitions back to healthy for two consecutive 60 s evaluation
intervals, the service emits a `severity: "info"` event with `resolvedAt`
and `durationSec`. Same channels, same dedup window applies — so a flapping
rule does not produce repeated resolution noise.

## 7. Dark-launch gate

`ALERTING_ENABLED=false` (env var, default `true`):

- Evaluator still runs.
- Rule conditions still evaluate.
- Dispatch is short-circuited: each channel records `outcome:"would-dispatch"`
  in `alerts_dispatched_total`, no outbound HTTP is made.

This lets the operator ramp alerts safely. Flip to live by setting
`ALERTING_ENABLED=true` (or unsetting the var). Recommended ramp:

1. `ALERTING_ENABLED=false` for 24 h. Inspect `alerts_dispatched_total{outcome:"would-dispatch"}` for sanity.
2. `ALERTING_ENABLED=true` after 0 false positives.

## 8. Synthetic test endpoint

`POST /api/admin/alerts/test`, body `{ rule?: string }`. Returns:

```json
{
  "alert": { "rule": "...", "severity": "warning", ... },
  "delivery": [
    { "channel": "telegram", "outcome": "delivered", "attempts": 1 },
    { "channel": "discord", "outcome": "skipped", "attempts": 0 },
    { "channel": "webhook", "outcome": "skipped", "attempts": 0 }
  ]
}
```

The test endpoint **uniquifies the dedup key** with `:test:${Date.now()}` so
repeated invocations during validation are not silently suppressed.

## 9. Escalation policy

| Severity   | First responder                     | Escalate after                      |
| ---------- | ----------------------------------- | ----------------------------------- |
| `info`     | none — log only                     | n/a                                 |
| `warning`  | on-call eng. via Telegram           | 30 min unacked → Discord channel    |
| `critical` | on-call eng. via Telegram + Discord | 10 min unacked → escalation contact |

Escalation contacts and rotations live in `OPERATIONS_RUNBOOK.md` (per-rule
sections referenced by `runbookSection` in each `AlertEvent`).

## 10. Architecture diagram

```
                ┌────────────────────────────────────────────────────┐
                │  Worker process (subnation-worker)                 │
                │                                                    │
                │   alertingService.start()                          │
                │   ┌────────────┐ every 60 s ┌─────────────────┐   │
                │   │ evaluator  ├───────────►│ ALERT_RULES.map │   │
                │   └────────────┘            └────────┬────────┘   │
                │                                       │            │
                │              ┌────────────────────────▼─────────┐  │
                │              │ checkRuleCondition(rule)         │  │
                │              │   (P2: pluggable; default false) │  │
                │              └─────────────┬───────────────────┘   │
                │                            │ true                  │
                │              ┌─────────────▼────────────────┐      │
                │              │ buildAlertEvent(rule)        │      │
                │              └─────────────┬────────────────┘      │
                │                            │                       │
                │              ┌─────────────▼────────────────┐      │
                │              │ dispatchAlert(event)         │      │
                │              │   if ALERTING_ENABLED=false  │      │
                │              │     → record would-dispatch  │      │
                │              │   else parallel:             │      │
                │              │     dispatchToChannel(t)     │      │
                │              │     dispatchToChannel(d)     │      │
                │              │     dispatchToChannel(w)     │      │
                │              └─────────────┬────────────────┘      │
                │                            │                       │
                │   ┌────────────────────────▼─────────┐             │
                │   │ Redis SETNX EX 300 dedup         │             │
                │   │ Redis INCR alert:global:{min}    │             │
                │   │   EXPIRE 70                      │             │
                │   └────────────────────────┬─────────┘             │
                └────────────────────────────┼─────────────────────────┘
                                             │
                ┌────────────┬───────────────┼───────────────┐
                ▼            ▼               ▼               ▼
         Telegram Bot   Discord     Generic webhook     Sentry
         (10 s timeout, retry-once-after-5s, capture-on-retry-fail)
```

## 11. Metrics & logs

- `alerts_dispatched_total{rule, severity, channel, outcome}` —
  `outcome ∈ {delivered, deduped, rate-limited, failed}`.
- Pino lines tagged `category:"alerting"` for every dispatch / dedup /
  rate-limit / retry / failure event.
