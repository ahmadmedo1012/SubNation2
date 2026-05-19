# SubNation Backend Observability — Sentry Integration

Single source of truth for the backend's Sentry pipeline. Updated whenever
the integration surface changes. For application-level docs see
`PLATFORM.md`; for security incident records see `SECURITY_FIXES.md`.

---

## 1. Quick links

| | |
|---|---|
| Sentry org | `subnation` (id `4511397349097472`) |
| Backend project | `subnation-backend` (EU ingest) |
| Production DSN | `https://11936f1c161b16bd27a9439dd2ce30ca@o4511397349097472.ingest.de.sentry.io/4511414239559760` |
| Frontend project | separate; DSN is `VITE_SENTRY_DSN` |
| Sample rates | `SENTRY_TRACES_SAMPLE_RATE=0.1`, `SENTRY_PROFILES_SAMPLE_RATE=0.1` (prod) |
| Init module | `backend/src/instrument.ts` (must be the first import in every entrypoint) |
| Config module | `backend/src/lib/sentry.ts` (single source of truth) |

---

## 2. What is instrumented

### 2.1 Auto-instrumented (Sentry SDK defaults, v10+)

The `@sentry/node` v10 SDK auto-patches modules at require time. As of this
release, the following are observed without per-call code:

- **HTTP** — every inbound request gets a transaction with `http.method`,
  `http.route`, `http.status_code`. Exceptions thrown from handlers are
  captured automatically by `Sentry.setupExpressErrorHandler(app)`.
- **Express** — middleware spans, route resolution.
- **PostgreSQL (`pg`)** — every query gets a `db.statement` span. Slow
  queries surface as long spans inside the parent HTTP transaction.
- **Redis** — every command gets a `cache.*` span.
- **fs**, **child_process**, **net**, **dns** — basic node spans.

### 2.2 Explicitly wired

| Subsystem | File | Captures |
|---|---|---|
| Boot migrations | `backend/src/lib/boot-migrations.ts` | Critical migration failures (NOT idempotent re-runs) with breadcrumbs at each phase. |
| Postgres pool errors | `backend/src/lib/db-instrumentation.ts` | Pool-level `error` events (DNS / TLS / auth failures, peer reset). Tagged `subsystem=postgres`. |
| Slow queries | `backend/src/lib/db-instrumentation.ts` | Queries above `SLOW_QUERY_THRESHOLD_MS` (default 250 ms) emit warn-log + appear in `pg_query_duration_seconds{slow="1"}`. Sentry sees them via the auto-instrumented span. |
| Redis client errors | `backend/src/lib/redis-client.ts` | Connection/command errors. Tagged `subsystem=redis`. Captured BEFORE `process.exit(1)` so the queue flushes. |
| Socket.IO auth | `backend/src/lib/socket.ts` | Every rejection adds a Sentry breadcrumb tagged `category: socket-auth`. NOT a captured event (would create noise from probe traffic). |
| Auth — Telegram | `backend/src/routes/auth-settings.ts` | Both branches: success breadcrumb + captureException on unexpected error. Tagged `auth_provider=telegram` via `captureAuthFailure`. |
| Auth — Firebase / Google / Phone OTP | `backend/src/routes/auth.ts` | `captureAuthFailure(provider, err)` on unexpected errors. Normal user-facing 401s are NOT sent. |
| Cron jobs | `backend/src/jobs/cron.ts` | `captureSchedulerFailure("low_stock_alert", err)` per cron task. |
| Watchers | `backend/src/jobs/{coupon,stock}Watcher.ts` | `captureSchedulerFailure("coupon_watcher" / "stock_watcher", err)`. |
| Cleanup script | `backend/src/jobs/cleanup-auth-activity.ts` | `captureSchedulerFailure("cleanup_auth_activity", err)` before `process.exit(1)`. |
| Process protection | `backend/src/instrument.ts` | `uncaughtException` + `unhandledRejection` handlers with explicit `Sentry.flush(2000)` before exit. |

---

## 3. PII sanitization

Sentry events are sanitized in three places. **Read this section before
any debugging session that involves looking at Sentry data.**

### 3.1 `beforeSend` (every captured event)

`backend/src/lib/sentry.ts:beforeSend` does, in order:

1. **Strip cookie + Authorization headers** verbatim. `event.request.cookies`
   is removed. `headers.cookie`, `headers.authorization`, and their
   uppercase variants are deleted.
2. **Sanitize the URL** via `sanitizeUrl()`. Token-shaped query params
   (`?token=`, `?id_token=`, `?access_token=`, `?refresh_token=`,
   `?auth_token=`, `?admin_token=`, `?code=`, `?otp=`) are replaced with
   `[REDACTED]`. URL fragments containing `token` are entirely replaced.
3. **Deep-walk `event.request.data`, `event.extra`, `event.contexts`** via
   `deepSanitize()`. Field names matched against the sensitive set (see
   below) have their VALUES replaced with `[REDACTED]`. Nested objects
   and arrays are walked to depth 6.
4. **Detect JWT-shaped strings** anywhere in the event payload (3
   base64url segments separated by dots) and redact them — defends
   against a token leaking into a free-form message via
   `console.error(token)` or similar.

### 3.2 Sensitive field names (case-insensitive substring match)

Edit `SENSITIVE_FIELD_NAMES` in `backend/src/lib/sentry.ts` to extend.
Current set (substring, so `passwordHash` matches `password`):

```
password, current_password, new_password, password_hash, passwordhash,
code, otp, totp, totp_secret,
token, id_token, access_token, refresh_token, auth_token, admin_token,
session_token,
cookie, set-cookie, authorization,
secret, session_secret, encryption_key, api_key, apikey, private_key,
firebase_service_account_json, telegram_bot_token
```

Note: substring matching means `code` matches `couponCode` too — accepted
over-redaction in exchange for a 100% guarantee on OTP / verification
code privacy.

### 3.3 Helper functions also sanitize at call site

`captureSubsystemException`, `captureAuthFailure`,
`captureSchedulerFailure`, `breadcrumbSubsystem` all run `deepSanitize`
on the `extras` argument before attaching it to the scope. The
`beforeSend` hook will catch leaked PII anyway, but call-site sanitization
prevents sensitive values from sitting briefly in the SDK's internal
queue.

---

## 4. Error grouping (tags)

Every event automatically carries:

- `environment` — `production` / `staging` / `development`
- `release` — first 7 chars of `RENDER_GIT_COMMIT`
- `correlation_id` — request-scoped UUID from `AsyncLocalStorage`
  (echoed back as `x-request-id` HTTP header, so a user-reported error
  can be matched to the Sentry issue)

Process-level tags from Render env (set once at init):

- `instance_id` ← `RENDER_INSTANCE_ID`
- `service_id` ← `RENDER_SERVICE_ID`
- `deploy_id` ← `RENDER_DEPLOY_ID`
- `region` ← `RENDER_REGION`
- `git_branch` ← `RENDER_GIT_BRANCH`
- `subsystem` — `web` (default) or `worker` (when `WORKER_ROLE=true`)

Per-call tags via the helper functions:

- `captureSubsystemException(subsystem, …)` → `subsystem=<name>`
- `captureAuthFailure(provider, …)` → `subsystem=auth`, `auth_provider=<name>`
- `captureSchedulerFailure(jobName, …)` → `subsystem=scheduler`, `job_name=<name>`

In the Sentry UI, group issues by `subsystem` for clean buckets:
auth, postgres, redis, scheduler, socket, web.

---

## 5. Sample rates

| Type | Production | Dev | Override env |
|---|---|---|---|
| Errors | 100% (`tracesSampler` only governs traces, not error events) | 100% | n/a |
| Traces (transactions) | 10% | 100% | `SENTRY_TRACES_SAMPLE_RATE` |
| Profiles | 10% | 0% | `SENTRY_PROFILES_SAMPLE_RATE` |

`tracesSampler` skips these paths entirely (returns 0):

- `/api/healthz` — Render edge probes every 30s
- `/api/metrics` — Prometheus scrape
- `/health` — Docker / k8s liveness
- `/api/cwv` — Core Web Vitals beacon

If quota becomes a concern, drop `SENTRY_TRACES_SAMPLE_RATE` to `0.05`
or `0.02`. Errors are unaffected.

---

## 6. Verification (post-deploy)

The `/api/admin/diagnostics/sentry-debug` endpoint is admin-only and
provides four verification modes:

```bash
# 1. Snapshot — confirms init state without sending events.
curl -H "Cookie: admin_token=<token>" \
     https://subnation.ly/api/admin/diagnostics/sentry-debug
# Expect JSON with: dsnConfigured: true, environment: "production",
# release: "<7-char hash>", processTags: {instance_id, service_id, …}

# 2. Send a captureMessage event.
curl -H "Cookie: admin_token=<token>" \
     "https://subnation.ly/api/admin/diagnostics/sentry-debug?mode=message"
# Expect: a new issue in Sentry with title "[sentry-debug] admin-triggered
# test message", level=error, tagged subsystem=web.

# 3. Send a subsystem-tagged exception.
curl -H "Cookie: admin_token=<token>" \
     "https://subnation.ly/api/admin/diagnostics/sentry-debug?mode=subsystem"
# Expect: a new issue tagged subsystem=test, with extras.triggered_by =
# "diagnostics endpoint".

# 4. Trigger an Express-caught exception (proves the full pipeline).
curl -H "Cookie: admin_token=<token>" \
     "https://subnation.ly/api/admin/diagnostics/sentry-debug?mode=throw"
# Expect: HTTP 500 response + new issue in Sentry, captured via
# setupExpressErrorHandler. The stack trace should resolve to readable
# TypeScript via the uploaded source maps.
```

---

## 7. Operator runbook

### 7.1 Deploying a new environment

1. Create a Sentry project (or reuse the existing one).
2. Copy the DSN from Sentry → Settings → Client Keys (DSN).
3. In the Render Dashboard, set:
   - `SENTRY_DSN` = the value from step 2
   - `SENTRY_AUTH_TOKEN` (for source map uploads — generate via
     `npx @sentry/wizard@latest -i sourcemaps --saas --org subnation
     --project subnation-backend`)
   - `SENTRY_ORG=subnation`, `SENTRY_PROJECT=subnation-backend`
4. Trigger a deploy.
5. Run the verification gauntlet in §6.

### 7.2 Investigating a regression

1. Open the Sentry issue.
2. Note the `release` tag — that's the 7-char git commit hash.
3. Note the `correlation_id` tag — search Pino logs for the same id to
   see the full request flow.
4. Note the `subsystem` tag — narrows the responsible module.
5. If the issue is too noisy: filter by `subsystem=<name>` AND
   `release=<old-hash>` to isolate, then mark resolved-on-next-release.

### 7.3 Tuning sampling for an incident window

1. Bump `SENTRY_TRACES_SAMPLE_RATE` to `1.0` in the Render Dashboard.
2. Save. Render rolls a new deploy.
3. Investigate.
4. **Revert immediately** when done (drift to 100% sampling burns
   the monthly quota in days).

### 7.4 What to do if quota is exhausted

- Drop `SENTRY_TRACES_SAMPLE_RATE` to `0.02`.
- Drop `SENTRY_PROFILES_SAMPLE_RATE` to `0.0`.
- Errors continue at 100%.
- The next quota cycle (1st of month UTC) restores normal flow.

---

## 8. Known limitations / future work

- **No alerts wired to Slack / Discord.** Sentry has alert rules in
  the project settings; configure based on issue volume / severity.
- **No release health.** Release-tracking commands (`sentry-cli releases
  new` / `set-commits` / `finalize`) run automatically as part of the
  source-map upload step. If you ship without that step, releases will
  appear as "unknown" in the issue list.
- **No environment-aware sampling.** Staging and production use the
  same rates today. If staging traffic grows, override the env vars
  per-service in render.yaml.
- **No per-user error budget.** Sentry Issues group by stack-trace
  fingerprint, not by user. A single broken user can silently dominate
  one issue's event count.

---

_Last updated: 2026-05-19. When extending the integration, update §2 +
§3 + §6 in the same commit so this file stays the source of truth._
