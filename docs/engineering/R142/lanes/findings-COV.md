# R142 Lane COV — BLOCKED-coverage closure (findings + per-file audit notes)

Agent: lane-COV subagent · Read-only for source · HEAD `a9f5e83` + uncommitted R142 fix work in tree.
Scope: the 38 files Wave A left BLOCKED (Lane C: 17, Lane E: 21). All 38 deep-read in full this lane; zero source edits.

**Closure: 38/38 — 33 COMPLETE, 5 FINDING_OPEN (all P4, report-only). Zero P0–P3.**

Working-tree note: exactly ONE of the 38 files differs from its coverage-recorded blob — `frontend/src/lib/admin-session.ts` (worktree `4c82bbe61baf` vs recorded `7a8b0613e19b`): the R142 D-3 timeout-contract fix is in the tree. Deep-read was performed on the working-tree version (277 lines); noted in its coverage record.

## Findings (5 — all P4)

**COV-1 (P4) — `backend/src/lib/encryption.ts:415` — safeDecrypt warn field is a constant `true`.**
- What: the failure warn logs `looksWellFormed: isEncrypted(value)`, but the branch is only reachable when `isEncrypted(value) === true` (guard at :388).
- Case: a v2-shaped corrupt blob (`v2:zz:yy:xx`) logs `looksWellFormed: true` — the operator is told the ciphertext is structurally fine while it is garbage; during a key-rotation incident this is the one diagnostic that points the wrong way.
- Fix: drop the field or log a real shape signal (v2 prefix present + parseable 3-segment body). One line.
- If skipped: misdiagnosed rotation incidents (operator re-checks keys when the row is corrupt).

**COV-2 (P4) — `backend/src/lib/risk-dsl.ts:118-124` (vs :221-222) — windowed-operator rules can be saved mis-shaped and then silently never fire.**
- What: `parseDsl` validates value shape for the 8 simple operators but accepts the 2 windowed operators (`count_in_last_N_minutes` / `distinct_count_in_last_N_hours`) with any value.
- Case: a rule saved as `{field:"event.ip", operator:"count_in_last_N_minutes", value:5}` parses OK, stores, and evaluates to `"unknown"` on every scoring pass (`evalClause` requires `value.n` to be a number) — the rule never fires, no error ever surfaces.
- Fix: in `parseDsl`, require the windowed value to be `{n: number}` and reject otherwise (~3 lines, same error shape as the other clause checks).

**COV-3 (P4) — `backend/src/lib/forecast/redis-flags.ts:30,42,52,68` — unbounded Redis commands in the forecast pipeline.**
- What: all four Redis ops are raw client calls with no `withRedisCommandTimeout` wrapper, unlike account-link-consent.ts and scheduler-coordinator.ts (both bounded after the r103 gray-zone incident).
- Case: client isReady but socket black-holed (the documented r103 gray zone) → the scheduled forecast run hangs on the flag read until the socket errors; the try/catch here catches errors, not hangs, so the pipeline stalls instead of degrading.
- Fix: wrap the ops with `withRedisCommandTimeout` and degrade on timeout (same warn + fallback posture as today's catch blocks).

**COV-4 (P4) — `frontend/src/lib/firebase-auth.ts:80-90,116-122` — sign-in fetches lack the 20 s timeout contract and a guarded JSON parse.**
- What: `exchangeFirebaseIdToken` / `refreshFirebaseSession` use raw `fetch` (no timeout) + unguarded `res.json()`.
- Case: a stalled backend hangs the Google sign-in flow until the browser's ~300 s TCP timeout — the exact class R142 D-3 just fixed for the admin surface (`adminFetch`'s 20 s `DEFAULT_REQUEST_TIMEOUT_MS`); a non-JSON 502 body throws an English `SyntaxError` into the Arabic error-toast path. The refresh listener's circuit breaker limits frequency, not duration.
- Fix: `AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS)` + `res.json().catch(() => null)` with a fallback error, mirroring `adminFetchJson`'s shape.

**COV-5 (P4) — `frontend/src/lib/validation.ts:10` vs `:16-17` — the two Libyan-phone helpers disagree on 9-digit input.**
- What: `isValidLibyanPhone` normalizes a 9-digit entry to 10 digits before testing; `libyanPhoneError` does not.
- Case: `"913456789"` → first helper says valid, second returns «رقم الهاتف يجب أن يتكون من 10 أرقام» — a form wired to `libyanPhoneError` rejects, with a misleading message, exactly the input its sibling accepts.
- Fix: apply the same 9→10 normalization inside `libyanPhoneError` (one line).

## Per-file one-line audit notes (all 38)

### Lane E carryovers (backend) — security-adjacent read first
| File (lines read) | Verdict |
|---|---|
| `lib/encryption.ts` (427) | AES-256-GCM, fresh 12-byte IV, strict 128-bit tag gate on every decrypt funnel, boot fail-fast, decrypt-only PREV-key rotation ladder, safeDecrypt nulls failures without logging credential material — **FINDING COV-1 only**. |
| `lib/account-link-consent.ts` (449) | 256-bit one-shot tokens (GETDEL / atomic DELETE-RETURNING), token deleted before validation (anti-retry), UID-hash binding to the verified identity, bounded Redis ops + PG fallback, leak-free masks — **clean, no findings**. |
| `lib/firebase-admin.ts` (187) | Lazy gated init, quote/newline-normalized service-account parse, no key material in logs — clean. |
| `lib/pg-advisory-lock.ts` (259) | Dedicated lock-pool client, bounded unlock with destroy-on-failure, saturation → retryable busy, race-observed losing promise — clean. |
| `lib/pg-leader-lease.ts` (275) | Single-statement CAS acquire/refresh/release, DB-clock expiry, never-throw outcomes, idempotent DDL memo — clean. |
| `lib/scheduler-coordinator.ts` (578) | Retry-loop election, demotion-on-loss, PG-lease fallback + clean Redis hand-back, bounded ops, orphan-lock guard — clean (non-atomic GET→EXPIRE refresh is self-correcting). |
| `lib/scheduler-state.ts` (74) | Trivial clone-on-read snapshot singleton — clean. |
| `lib/inspection-runner.ts` (544) | Recorder retry budget honored before schedule completion, one record per call incl. failure, swallowed sink errors; runInspection skeleton is consumed by scripts/inspect.ts — clean. |
| `lib/audits/neon-audit.ts` (727) | Constant read-only SQL, basename-validated persister, transport-quirk-tolerant parsers — clean (UTF-16-vs-bytes truncate nit below reporting bar). |
| `lib/audits/context7-audit.ts` (561) | R10.4 validation before write, idempotent by-id merge, tmp+rename atomic write — clean. |
| `lib/audits/ruflo-audit.ts` (464) | Anchored main-entry regex, distinct zero/ambiguous error codes, idempotent upsert store — clean. |
| `lib/metrics.ts` (450) | Bounded-label catalog, singleton registry, safe* wrappers counting their own failures — clean. |
| `lib/metrics-snapshot.ts` (449) | Pure transform, Prometheus-style quantile interpolation, bounded aggregations — clean. |
| `lib/db-instrumentation.ts` (255) | Idempotent patch, both callback/promise shapes timed, pool-error → Sentry — clean. |
| `lib/risk-dsl.ts` (227) | Closed operator set, tri-state unknowns — **FINDING COV-2 only**. |
| `lib/loyalty-policy.ts` (105) | Pure single-source money policy, floor() award, whole bundles — clean. |
| `lib/slugify.ts` (160) | Deterministic Arabic transliteration, bounded length, empty-safe — clean. |
| `lib/copilot/ids.ts` (39) | ULID with bias-free %32 mapping — clean. |
| `lib/forecast/dates.ts` (41) | Pure UTC date math — clean. |
| `lib/forecast/metrics.ts` (85) | Swallowed-catch telemetry helpers — clean. |
| `lib/forecast/redis-flags.ts` (77) | Documented degrade posture — **FINDING COV-3 only**. |

### Lane C carryovers (frontend)
| File (lines read) | Verdict |
|---|---|
| `lib/admin-session.ts` (277, **worktree blob ≠ coverage blob** — R142 D-3 fix in tree) | 401 choke point with dedupe/exemptions, caller-signal-wins 20 s timeout, guarded error parse, sentinel error — clean. |
| `lib/admin/user-display.ts` (191) | Placeholder-phone hiding, degradation chain, badge priority — clean. |
| `lib/analytics.ts` (84) | Opt-in GA4 with id-shape validation before any beacon — clean. |
| `lib/api-config.ts` (62) | Split-deployment compat, path-safe rewrite rules, single-shot patch — clean. |
| `lib/auth-token-holder.ts` (40) | Sentinel-filtered in-memory JWT holder — clean. |
| `lib/boot-sentry.ts` (410) | Sync error buffering, mirrored sticky replay roll, later-of(load,pointerdown) gate, DSN-less skip — clean. |
| `lib/chart-theme.ts` (78) | CSS-var→hsl resolution + MutationObserver theme flips — clean. |
| `lib/csv.ts` (39) | OWASP CSV-injection guard, the shared B3-F2 escaper — clean. |
| `lib/firebase-auth.ts` (216) | Typed 409 consent-gate error, JWT-shape guard, refresh circuit breaker — **FINDING COV-4 only**. |
| `lib/firebase.ts` (64) | Lazy gated client SDK init, app dedupe — clean. |
| `lib/inventory-parser.ts` (240) | Auto-detect parser with code-only support, mirrored backend dedup contract — clean. |
| `lib/sentry-replay.ts` (58) | Sole replay importer, PII masking preserved — clean. |
| `lib/transfer-code.ts` (77) | Round-not-floor amount, %23 tel: encoding — clean. |
| `lib/validation.ts` (23) | Prefix allowlist consistent — **FINDING COV-5 only**. |
| `lib/web-vitals.ts` (312) | Batched beacons with MIME Blob, event-driven flushes, session sampling — clean. |
| `pages/onboarding.tsx` (303) | Honest 2-step welcome, non-fatal completion POST with finally-navigate, guest skeleton + redirect preservation — clean. |
| `pages/terms.tsx` (341) | Hash-tab deep-links, replaceState back-button behavior, fragment-less canonical — clean. |

## Verdict

The 38 Wave-A BLOCKED files are now fully deep-read. The two security-adjacent carryovers (`encryption.ts`, `account-link-consent.ts`) are genuinely well-hardened — key handling, IV/tag discipline, one-shot consent tokens and scope binding all hold; nothing above P4 anywhere in this set. The five P4s are small consistency gaps (a constant log field, a parse-time validation gap, missing command bounds, a missing frontend timeout contract, a helper asymmetry) — each a 1–4 line fix in an existing house idiom, none touching validation, auth or money paths.

Not checked: nothing — all 38 assigned files were read end-to-end at source level; no tests were executed this lane (green suites for encryption/account-link-consent/transfer-code/api-config/boot-sentry/web-vitals were verified as existing by Wave A inventories, not re-run).
