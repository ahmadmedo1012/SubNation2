# Logging & Retention — Final Contract — SubNation

> Where logs live, what is redacted by design, how rotation is enforced, and
> the full retention map. Companion: `docs/operations/FINAL_MONITORING.md`
> (what to watch), `docs/COMPLIANCE.md` (policy windows).

## 1. Log format + where logs live

- **Format:** structured JSON via **pino** (`backend/src/lib/logger.ts:1-201`).
  Production output is JSON on stdout (no pretty transport — the
  `pino-pretty` transport is dev-only, `logger.ts:193-200`). Every line binds
  `service` (`web`/`worker`) + `version` (release SHA) at process start
  (`logger.ts:13-15,184-188`); request-scoped lines carry `requestId`/
  `correlationId` from AsyncLocalStorage. Category helpers exist for
  auth / worker / alerting / monitoring / cwv contexts.
- **Where:** Docker captures stdout per service. `docker logs subnation` /
  `docker logs openwa` (Coolify shows the same streams in its UI). Files:
  `/var/lib/docker/containers/<id>/<id>-json.log` + rotated siblings — you
  should never need to touch those directly.

## 2. Redacted / masked by design (verified in code)

- **Backend pino redaction** — the one true list, `REDACT_PATHS` +
  censor `[REDACTED]` (`backend/src/lib/logger.ts:71-179`):
  - HTTP headers: `req.headers.authorization`, `req.headers.cookie`,
    `res.headers["set-cookie"]`.
  - Passwords: `password`, `password_hash`, `passwordHash`,
    `current_password`, `new_password`, `account_password`, `accountPassword`.
  - Tokens: `token`, `access_token`, `refresh_token`, `id_token`,
    `auth_token`, `admin_token`, `session_token`.
  - OTP / 2FA: `otp`, `totp`, `totp_secret`.
  - Payment: `card_number`, `cvv`, `sender_account`. PII: `ssn`, `national_id`.
  - Secrets/keys: `secret`, `session_secret`, `encryption_key`, `api_key`,
    `apikey`, `private_key`, `firebase_service_account_json`,
    `telegram_bot_token`.
  - Nested shapes: `body.*` / `req.body.*` (id_token, token, access_token,
    refresh_token, temp_token, link_consent_token, initData, passwords, otp,
    totp_secret), top-level `initData`/`init_data`/`temp_token`/
    `link_consent_token`, fetch/axios error chains
    (`err.config.headers.authorization`, `err.cause.…`, set-cookie variants),
    and one-deep wildcards (`*.id_token`, `*.password`, `*.totp_secret`, …).
  The list is exported and pinned by
  `backend/src/lib/__tests__/logger-nested-redaction.test.ts`, and
  fast-redact validates every path at boot — an invalid path throws at
  startup, never fails silently (`logger.ts:58-59`).
- **OTP codes are never logged:** `services/whatsapp-otp.service.ts` has
  exactly two logger calls (lines 304 and 596) — both `.warn` carrying only
  the error message/category/attempt. The generated code (line 179) is never
  passed to any log call; only its purpose-scoped **hash** is stored
  (line 285). Auth-activity rows (identifier `wa:<phone>`) go to the
  `auth_activity` table — the auth audit surface — not into pino lines.
- **openwa phone masking:** the gateway masks digits to the last 4 in stdout
  logs — `maskDigits` / JID-aware `maskJid` (cites live in the **separate
  openwa repository** — `github.com/ahmadmedo1012/openwa`, not this repo;
  production pulls `ghcr.io/ahmadmedo1012/openwa` — `openwa/src/lib.ts:260-285`,
  masks the user part, keeps the domain suffix so LID routing stays
  readable); applied at every log site that carries account/chat digits
  (`openwa/src/index.ts:514-518, 1058-1060, 1073, 1085, 1104-1107` — same
  openwa repo). Full
  values stay only in the in-memory ring buffer and the encrypted DB blob —
  the log surface alone is redacted.
- **Wallet / money routes:** `routes/wallet.ts` logs only HTTP status and
  error objects (lines 586-588) — no secret or credential values; admin user
  routes log nothing per-request.

## 3. Docker rotation contract

`docker-compose.yml` enforces bounded json-file logs on BOTH services
(FH-A8 F1 — "a log-heavy incident or debug-level deployment can never eat the
boot volume"):

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

- `subnation`: `docker-compose.yml:113-117` · `openwa`: `docker-compose.yml:174-178`.
- Ceiling per service: 3 files × 10 MB = ~30 MB (+ compressible JSON overhead in the raw file).
- The block is explicit so plain `docker compose up -d` on the VM is bounded
  too — the default json-file driver is UNBOUNDED without it.
- **Coolify caveat:** Coolify deploys either read the image/compose definition
  or apply its own defaults. The explicit json-file 10m×3 block in compose is
  the guarantee — if Coolify ever overrides it, verify with
  `docker inspect <container> | grep -A4 LogConfig` that a max-size exists.

## 4. Retention summary

| What | Window | Mechanism / schedule | Where |
|---|---|---|---|
| `login_attempts` | **7 d** idle | daily cron `05:00 UTC` | `jobs/auth-audit-retention.ts:24` |
| `audit_logs` | **180 d** | daily cron `05:00 UTC` | `jobs/auth-audit-retention.ts:25` |
| `whatsapp_otps` | **24 h** (TTL is 5 min) | opportunistic prune: throttled 60-min fire in `startOtp()` + leader boot one-shot | `services/whatsapp-otp.service.ts:606-619` |
| `notifications` | read **90 d** / unread **180 d** | daily cron `05:00 UTC` + boot one-shot | `jobs/notifications-retention.ts:24-25` |
| `idempotency_keys` | **48 h** (cache horizon 24 h) | daily cron `00:00 UTC` | `jobs/idempotency-retention.ts:17` |
| `admin_alerts` | unread >14 d → auto-read; read >30 d → deleted | daily cron `00:00 UTC` | `jobs/cron.ts:57-77` |
| sessions (user) | expired rows | daily cron `05:00 UTC` | `jobs/cron.ts:143-164` |
| admin sessions | expired >24 h / revoked >30 d | daily cron `05:00 UTC` | `jobs/cron.ts:165-179` |
| `auth_activity` | **90 d** | daily cron `04:30 UTC` + boot one-shot | `jobs/cron.ts:388-414` |
| `risk_events` | 90 d unlabeled / 97 d labeled grace | daily cron `03:30 UTC` | `jobs/cron.ts:273-299` |
| forecast / enrichment artifacts | 90 d | daily cron `03:35` / `04:00 UTC` (worker-tier gated, dormant here) | `jobs/cron.ts:325-386` |
| DB backups (on-VM) | newest **14** dumps (`--keep`, `BACKUP_KEEP`) — only exact `subnation-<ISO>.sql.gz` names pruned, only after a fully successful run | host cron `15 3 * * *` (03:15 UTC — deliberately NOT 04:30, which is the in-app auth_activity retention slot) → `scripts/backup-cron.sh` | `docs/DISASTER_RECOVERY.md` §Automated backups |
| Docker logs (both services) | **10 MB × 3 files** per service | json-file rotation (§3 above) | `docker-compose.yml:113-117,174-178` |
| Off-VM backup copies | lifecycle rule on the bucket (e.g. daily 30 d) — operator-owned | not managed by this repo | `docs/DISASTER_RECOVERY.md` §Off-VM copy |

All retention DELETEs run in bounded ctid batches of 1000 — a catch-up purge
holds a lock for seconds, not minutes.

## 5. The never-log list + how to extend it

**Never log:** OTP codes, passwords (any spelling), session/admin/JWT/id
tokens, TOTP secrets, wallet/account credentials, API keys, encryption keys,
Firebase service-account JSON, Telegram bot tokens, card data, national IDs.

**Enforcement (layers):**

1. pino `redact.paths` — `REDACT_PATHS` in `backend/src/lib/logger.ts:71-177`
   (censor `[REDACTED]`), pinned by `logger-nested-redaction.test.ts`; an
   invalid path throws at boot.
2. Call-site hygiene in secret-bearing code — verified for the OTP path
   (`whatsapp-otp.service.ts`: hash-only storage, warn-only logging) and the
   wallet routes; openwa masks digits at every log site.
3. Sentry's deepSanitize JWT heuristic for arbitrary key names pino cannot
   path-match (`logger.ts:66-69` — documented, accepted residual).

**When you add new secret-bearing code:** add the new field names to
`REDACT_PATHS` (top level + `body.*`/`req.body.*` + one-deep `*.name`
variants, mirroring the existing shape), keep logger call-sites to
non-secret fields, and extend the redaction test with the new path. A secret
name absent from the list is a bug, not a style choice.
