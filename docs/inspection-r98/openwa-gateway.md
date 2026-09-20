# R98-A7 — openwa gateway deep audit (static, read-only)

- **Agent:** R98-A7 (openwa gateway audit)
- **Date:** 2026-09-21 (audit round 98)
- **Repo:** `/home/z/my-project/repos/openwa` @ `8616291` (HEAD, clean tree)
- **Scope:** route table, auth, credentials crypto (post key-separation), session lifecycle, delivery-log, error hygiene, tests, dist/src parity, deps
- **Method:** full static read of all 7 src files (3,744 lines) + dist greps + git history (`178cc23`, `676f0bb`, `8616291`) + pre-split `persist.ts` recovered from `676f0bb` for bit-exact compat proof. No builds, no tests run, nothing modified except this report.

**Verdict up front:** No P0. The key-separation crypto (8616291) is **verified bit-exact backward compatible, with correct transparent re-key and an honest recovery path**. Auth (timing-safe API key + signed-cookie dash + lockout + pre-gate rate limits) is solid. Two systemic P2s: (1) Express 4 has no async-rejection wrapper anywhere → unexpected async throws hang requests instead of 500; (2) `startSession` has a check-then-await TOCTOU → concurrent starts can build two Baileys sockets on one auth folder → WhatsApp conflict → possible credential wipe (session-loss chain, needs a concurrent-start trigger). Everything else is P3 hygiene.

---

## 1. Route table

### `/api` surface — all behind **rate limiter (mounted first)** + **X-API-Key gate** (`src/index.ts:632-637`)

| Route | Method | Auth | Input validation | Rate limit | Async errors | Status codes |
|---|---|---|---|---|---|---|
| `/api/docs` | GET | key | n/a | general 240/min/IP | sync handler | 200 |
| `/api/sessions` | GET | key | n/a | general | sync | 200 |
| `/api/sessions` | POST | key | **regex** `[A-Za-z0-9-]{3,50}` (index.ts:130, 666) | general | ❌ no try/catch, no wrapper (low-risk body) | 201 / 400 / 409 (dup name) |
| `/api/sessions/:id` | GET | key | id = map key lookup | general | sync | 200 / 404 |
| `/api/sessions/:id/start` | POST | key | 404 if unknown | general | ✅ res.json sent **before** `await startSession` which has try/catch (695-697) | 200 / 404 |
| `/api/sessions/:id/qr` | GET | key | none needed (id lookup) | general | ❌ `await import("qrcode")` + `toDataURL` unguarded (702-733) | 200 / 404 (JSON when no QR; HTML always 200) |
| `/api/sessions/:id/contacts/check/:number` | GET | key | digits stripped; ❌ **no length bounds** (742) | general | ✅ try/catch | 200 / 404 / 409 not-ready / 500 |
| `/api/sessions/:id/pair-code` | POST | key | digits-only, **10–15 length** (762-764) | **pair-code 5/h/IP** | ✅ try/catch | 200 / 400 / 404 / 409 not-started / 500 |
| `/api/sessions/:id` | DELETE | key | id lookup | general | ✅ `.catch()` + internal try/catch | 200 / 404 |
| `/api/sessions/:id/messages/send-text` | POST | key | chatId 8–15 digits + text ≤4096 (817-819, lib.ts:81-84) | **sends 60/min/IP** | ✅ engineSend internal try/catch; outer await unguarded (residual) | 200 / 400 / 404 / 409 / 500 |
| `/api/sessions/:id/messages/test` | POST | key | same, fixed text | sends | same | same |
| `/api/sessions/:id/delivery-log` | GET | key | id lookup | general | sync | 200 / 404 |
| `/api/*` fallback | ALL | key | n/a | general | sync | 404 JSON |

### Dashboard surface — cookie auth (`src/dashboard-routes.ts`), mounted **before** the /api gate (correct: never uses the API key)

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/healthz` | GET | **none** (intentional) | returns counts only; no DB, no side effects; outside rate limits |
| `/` | GET | cookie → login page or dashboard | 200; disabledPage (404-style) when env unset |
| `/login` | POST | none + **lockout** 5 fails/15min → 15min lock | urlencoded 16kb; credentialsOk timing-safe; logs ip only |
| `/logout` | POST | none (clears own cookie) | redirect |
| `/dash/api/state` | GET | cookie | JSON 401 vs redirect for pages |
| `/dash/api/sessions` | POST | cookie + **Origin check** (index.ts:599-615) | regex validation duplicated ✅ |
| `/dash/api/sessions/:id/start` | POST | cookie + Origin | try/catch ✅ |
| `/dash/api/sessions/:id/pair-code` | POST | cookie + Origin | 10–15 digits ✅; ❌ **no rate limit** (P3-9) |
| `/dash/api/sessions/:id/qr` | GET | cookie | ❌ toDataURL unguarded (async-rejection hang risk) |
| `/dash/api/sessions/:id` | DELETE | cookie + Origin | try/catch ✅ |

**Ordering correctness verified:** rate limiter (632) → key gate (634) → routes → 404 JSON fallback (936). Dash mounted at 617 before gate — by design, cookie-authenticated. Security headers + CSP global (507-523). `express.json({limit:"256kb"})` (524) — adequate for all bodies (text ≤4096); **no multipart anywhere**; `/login` has its own urlencoded 16kb parser.

---

## 2. Auth deep-dive — verified

**API key (`src/index.ts:481-492`):**
- `timingSafeEqual` with a **necessary length pre-check** (`given.length === expected.length &&`) — `timingSafeEqual` throws on mismatched lengths, so the guard is the standard idiom. The length check leaks only the *length* of the key, not its content — accepted practice (P3-15 note).
- Key read **once at boot** (`index.ts:82` const; same in persist.ts:32). Rotation ⇒ restart — on Render an env change restarts the service anyway. ✅
- Gate ordering: limiter **before** key gate ⇒ unauthenticated key-guessing is bounded per IP (240/min general). Key space is high-entropy. ✅
- 401 body is constant text; no oracle.

**Dash (`src/dashboard.ts`):**
- Cookie `openwa_dash` = `v1.<ts>.<nonce12B>.<HMAC-SHA256>`; secret = `DASHBOARD_SESSION_SECRET` (≥32) **or** `scrypt(OPENWA_API_KEY,"openwa-dashboard-v1",32)` — memoized (33-48) so no per-request scrypt DoS. Signature compared with `timingSafeEqual` + length guard (73-75). TTL 12h checked inside the signed payload — a future-dated `ts` can't be forged without the secret. ✅
- Cookie flags: httpOnly, SameSite=Lax, Secure in prod, path=/ (81-90). ✅
- **Brute force:** `POST /login` — 5 failures / 15 min per IP → 15-min lock (94-127); IP = **rightmost** XFF entry (Render's appended true peer — the left entry is spoofable and documented as proven-live, 99-109); lockout map swept every 10 min (145-151, unref'd). `credentialsOk` is double timing-safe compare (134-142). Failed login logs IP only, never the submitted values (dashboard-routes.ts:130). ✅
- **Logout:** clears cookie client-side; stateless tokens have **no server-side revocation** — a stolen cookie stays valid ≤12h (P3-12, standard trade-off).
- **CSRF:** `/dash` non-GET Origin-vs-Host check (index.ts:599-615) + SameSite=Lax. `/login` and `/logout` are outside the check — login-CSRF/logout-CSRF nuisance only (P3-13).
- API key is never sent to the browser (verified: dashboard JS only calls `/dash/api/*`; no key in any template).

**Timing on invalid key:** no early-exit beyond the length check noted above; constant 401 text. No user-enumeration style oracles.

---

## 3. Credentials encryption — verified bit by bit (post-8616291)

Cross-checked against the **pre-split implementation recovered from `git show 676f0bb:src/persist.ts`**:

| Property | Code | Verdict |
|---|---|---|
| Algorithm | AES-256-GCM (`persist.ts:82, 92`) | ✅ |
| IV | `randomBytes(12)` **per encryption** (81) — 96-bit GCM IV, unique per blob | ✅ |
| Layout | `[IV(12) ‖ tag(16) ‖ ciphertext]` (84, 89-91) — **identical to pre-split** | ✅ |
| Auth tag | verified: `setAuthTag` + `decipher.final()` **throws** on mismatch (93-94) → wrong key = throw = fallback path | ✅ |
| KDF | `scryptSync(material, "openwa-gateway-creds-v1", 32)` (70) — **same salt+params as pre-split** (verified in 676f0bb) | ✅ |
| **Bit-exact fallback** | `CREDENTIALS_KEY` unset ⇒ `credentialsKeyMaterial() === API_KEY` (49-51) ⇒ derivation byte-identical to pre-split. Proven by test 1 of `persist-key-separation.test.mjs` (manual `createDecipheriv` with the old derivation) | ✅ |
| Legacy retry | only when `CREDENTIALS_KEY && CREDENTIALS_KEY !== API_KEY` (58-60); retry `decryptWith(blob, deriveKey(API_KEY))` (261) | ✅ |
| Transparent re-key | legacy success → re-encrypt with current key + `UPDATE` (278-281), tombstone respected (272-276), **re-key write failure still returns plaintext** (287-293) | ✅ |
| Recovery path | both keys fail → `null` (session re-pairs via QR), **blob left untouched** so an operator who set a wrong key can unset it and restart (238-239, 263-267). Test 4 pins this. Log is honest but not actionable (P3-4) | ✅ |
| scrypt memoize | `keyCache` Map keyed by material (66-74). Env read at boot ⇒ at most **2 entries** ever (API + CREDENTIALS) — bounded; invalidation-on-key-change is N/A (inputs immutable per process); module reload in tests creates fresh caches | ✅ |
| At rest | DB column stores only `encrypt(json)` ciphertext (148-152) | ✅ |
| `wipedAt` invariant | re-key path skips tombstoned names (272-275); doSave double-guard pre/post serialize (140-146) | ✅ |

Remaining crypto notes (P3): static scrypt salt is fine because the input is a high-entropy secret; `CREDENTIALS_KEY` shorter than 32 chars only **warns**, doesn't refuse (39-44) — enforcement would be better; `ensurePool` requires `API_KEY` (102) which is guaranteed by boot exit (index.ts:87-90).

**Conclusion:** the claimed state in the worklog ("bit-exact compat + transparent re-key + recovery + memoized scrypt, 70/70") is **accurate**.

---

## 4. Session lifecycle

State machine (`index.ts:94-101`): `created → initializing → qr_ready → ready → (disconnected ⇄ reconnect) | failed`. Note: **`authenticating` is declared but never assigned** (grep: only the type at line 98 + dashboard translation) — dead status value (P3-8 family).

- **QR polling cleanup:** all QR polling is client-driven (meta-refresh 3s/20s pages; dash modal `setInterval` cleared on close — dashboard-html.ts:311, 321). No server-side timers to leak. ✅
- **Evicted while in flight:** `engineSend` holds a local `sock`; concurrent DELETE ⇒ `socket.end()` ⇒ `sendMessage` throws ⇒ clean 500 `send_failed`. No leak (rs dropped from map). ✅
- **Re-pair while old session live:** name uniqueness enforced synchronously (`createSessionRecord`, 582 — check→set has no await between, so no TOCTOU on names). Delete → wipe (local + DB + tombstone) → recreate works; identity fields reset on loggedOut (lib.ts:234-242) so the new pairing never inherits old identity. ✅
- **Memory bounded per session:** deliveryLog ring buffer 500 entries (lib.ts:18), timeline 10 (lib.ts:25); `pending`/`lastSavedAt` pruned; `wipedAt` never pruned but bounded by distinct wiped names (P3-11). Session **count** itself unbounded (trusted callers only, P3-11).
- **Reconnect:** 5s timer, re-checks `cur && !cur.stopRequested && status==="disconnected"` (434-444). ✅
- **Boot self-heal:** restores every persisted name sequentially (954-975); logs "restored" even when `startSession` rejected (971 — cosmetic: the catch only logs, message can mislead; P3 nit).
- **SIGTERM/SIGINT flush:** 4s budget, double-signal guard, `Promise.race` (995-1018). ✅
- ⚠ **TOCTOU on start (P2-2):** both `POST /api/sessions/:id/start` (684-698) and the dash `start()` (548-553) do `if (rs.socket) … else await startSession(rs)`; `rs.socket` is only assigned at line 268 — **after** `useMultiFileAuthState` + `fetchLatestBaileysVersion` awaits (211, 245-251). Two overlapping calls both pass the check ⇒ two sockets on one auth folder. Also `POST /start` responds *before* awaiting, widening the retry window. Consequences: conflicting Baileys connections; if WhatsApp answers with `loggedOut`, the close handler **wipes credentials** (403-426) — a session-loss chain. Trigger requires concurrent starts (operator double-submit across surfaces, or start racing the reconnect timer — the timer's `status==="disconnected"` guard is also not atomic). Probability low, impact high ⇒ P2.

---

## 5. Delivery-log

- Memory-only (never hits disk/DB); ring-buffered: **500 entries/session, timeline 10/entry** (lib.ts:18, 25) — strictly bounded. ✅ No rotation needed (RAM), no pagination (P3 — 500 small entries ≈ worst-case ~100-200KB response, acceptable).
- `chatId` = full JID with phone digits ⇒ **PII in API responses** (key-gated, consumed by SubNation's OTP polling — by design). PII also in stdout logs: `[send]` logs chatId (index.ts:871-880), `[session] connected` logs accountDigits (385-394). Render retains logs. P3-5 — consider digit redaction or documented retention.
- Status semantics: monotonic max-rank (WA-04), regressions recorded but never lower authority — clean design, unit-tested.

---

## 6. Body limits & response surfaces

- `express.json 256kb` adequate (max legit body = 4096-char text + ids); no multipart; `/login` urlencoded 16kb. ✅
- **`GET /api/sessions` field table (the leak check the scope asked for):**

| Field | Type | Emitted when | Sensitive? |
|---|---|---|---|
| `id` | `sess_<nanoid16>` | always | no |
| `name` | regex-validated | always | no |
| `status` | enum string | always | no |
| `createdAt` | ISO string | always | no |
| `lastReadyAt` | ISO string | only if ever ready | no |
| `lastDeliveryStatus` | WAProto status code | only if acked | no |
| `accountDigits` | linked account phone digits | only when connected | **PII (operator phone)** — key-gated, used by consumer for self-send |
| `accountName` | WhatsApp profile name | only when connected | PII — key-gated |
| `connectedAt` | ISO string | only when connected | no |
| `persistAgeMs` | number | only when persisted | no |

  **NOT returned (verified against `publicView`, index.ts:136-156):** credentials, `qrString`, `socket`, `accountLidDigits`, `stopRequested`, `deliveryLog`, persist hooks. **No credential leak in list/get.** The QR JSON (`/qr`) does return the pairing secret — key-gated and that is its purpose. Dash `/dash/api/state` returns the same safe field set.
- ❌ **`Cache-Control: no-store` only covers `/dash/`, `/`, `/login`** (index.ts:519-521) — `/api` responses (QR secret, phone digits) carry no cache directive; heuristic intermediary caching is unlikely on Render but cheap to close (P3-3).

---

## 7. Error hygiene

- **No stack traces in responses:** every 500 is a generic code (`send_failed`, `check_failed`, `pair_code_failed`, `تعذر…`); real errors go to pino. Dockerfile sets `NODE_ENV=production` so Express's default sync-error handler also hides stacks. ✅
- `console.error`/`console.warn` with sensitive data: **none found** — login failure logs IP only; persist logs err objects (crypto messages, no key material). ✅
- Process guards: `uncaughtException`/`unhandledRejection` log loudly and keep serving (981-986) — deliberate, documented. ✅
- ❌ **P2-1 (systemic):** Express 4 does not route async rejections to the error handler, and there is **no 4-arg error middleware and no `next(err)` anywhere** (grep verified). Handlers that can reject without their own try/catch: `GET /api/sessions/:id/qr` (`await import("qrcode")` + `toDataURL`, 702-733), `GET /dash/api/sessions/:id/qr` (dashboard-routes.ts:225-239), and the outer awaits of `POST /api/sessions` / send-text / dash-create if their callees ever throw unexpectedly. Result: the unhandledRejection guard logs it, the **HTTP request hangs forever** (no 500, no response). Fix: a tiny `asyncHandler` wrapper + a final error middleware.

---

## 8. Tests (70/70 at 8616291 — counts re-verified from file contents)

| File | Tests | Covers |
|---|---|---|
| `lib.test.mjs` | 28 | normalizeChatId, account/LID extraction, resolveSendJid (self-send/LID), delivery ranks/regression, timeline + ring-buffer caps |
| `rate-limit.test.mjs` | 28 | window math, per-IP/per-rule isolation, sweep, path classification, IP resolution incl. forged-XFF/CF (H11), middleware 429 shape |
| `logged-out-reset.test.mjs` | 9 | WA-02 close semantics: identity reset, no flush on wipe, reconnect arming, re-pair epochs |
| `persist-key-separation.test.mjs` | 5 | key separation: bit-exact legacy derivation (manual decipher), separation, legacy fallback, both-fail, memoization |

**Gaps (P3):** no HTTP-level tests at all (route status codes, 401/429/409 shapes, `/qr` HTML/JSON duality); **`src/dashboard.ts` has zero tests** (token issue/verify/TTL, lockout escalation, credentialsOk); the DB re-key path of `loadCreds` is untested (only pure crypto — the `UPDATE`+tombstone logic at persist.ts:272-294 has no mock-pool test); no pair-code route flow test; no concurrent-start test (would have caught P2-2); no SIGTERM budget test. Note `npm test` rebuilds dist first, which keeps dist fresh at test time.

---

## 9. dist ↔ src parity — verified

- `178cc23` removed self-ping from src; **`676f0bb` is the dist-only rebuild** (`git show --stat`: only `dist/index.js`). ✅
- `8616291` (key separation) includes `dist/persist.js` in the same commit. ✅
- Grep of `dist/index.js`: **no setInterval/fetch self-ping code** — only the explanatory comment block (784-794) + the `/healthz` route. ✅
- Grep of `dist/persist.js`: `OPENWA_CREDENTIALS_KEY`, `CREDENTIALS_KEY`, `legacyKeyAvailable`, `__cryptoForTest`, `scryptSync` all present (lines 35-60, 227-249, 307). ✅
- Route registrations: src and dist match **1:1** (all `app.get/post/delete/use` compared; dashboard 10 + api 13 + middleware chain identical).
- mtimes: every `dist/*.js` (00:08:04) newer than every `src/*.ts` (latest 00:06:55). ✅

**Parity: CONFIRMED** — deployed dist contains both the self-ping removal and the key separation.

---

## 10. Dependencies

| Package | Declared | Locked | Notes |
|---|---|---|---|
| express | ^4.21.2 | **4.22.2** | 4.x line with current patches; ⚠ Express 4 **does not auto-catch async rejections** (that's v5) — the root of P2-1 |
| @whiskeysockets/baileys | ^6.7.9 | **6.7.24** | matches the version referenced in code comments; multi-file store `set(null)` delete semantics as documented |
| pg | ^8.23.0 | 8.23.0 | fine |
| pino | ^9.6.0 | 9.14.0 | fine |
| nanoid | ^5.0.9 | 5.1.16 | used (session ids) |
| qrcode | ^1.5.4 | 1.5.4 | dynamic import in both QR routes |
| **@types/pg** | dependencies | 8.23.1 | ❌ should be devDependencies (P3-10) — ships types into the runtime image layer |

- Unused deps: **none** — every dependency is imported by runtime code (verified).
- `npm audit` not run (offline + read-only mandate) — static review only; no known unpatched advisory pattern in the locked versions as of knowledge cutoff. Recommend one `npm audit --package-lock-only` pass when network is available.
- Dockerfile: non-root `node` user, healthcheck on /healthz, `NODE_ENV=production`, no secrets baked. ✅

---

## Findings

**P0: 0** — no credential leak (publicView excludes creds/qr; DB stores ciphertext only), no auth bypass, no deterministic session loss.

### [P2-1] Async rejections are never converted to 500 — requests hang
- **Where:** `src/index.ts:702-733` (`GET /api/sessions/:id/qr`), `src/dashboard-routes.ts:225-239` (`GET /dash/api/sessions/:id/qr`), systemic (no `next(err)` / no 4-arg error middleware anywhere in the repo; Express 4.22.2 does not catch promise rejections).
- **Evidence:** handlers `await import("qrcode")` / `QRCode.toDataURL` with no try/catch; `process.on("unhandledRejection")` (index.ts:984) only logs.
- **Why:** any unexpected throw in an async handler → response never sent → client hangs until timeout; the operator sees nothing but a stuck request; SubNation's readiness logic would misclassify the gateway as down.
- **Fix (minimal):** `const ah = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next)` wrapper for async handlers + terminal `app.use((err,_req,res,_next) => { log; res.status(500).json({error:"internal"}) })` (JSON for `/api`, HTML for dash).

### [P2-2] `startSession` check-then-await TOCTOU → duplicate sockets → possible credential wipe
- **Where:** `src/index.ts:684-698` (POST /start responds before awaiting), `:548-553` (dash start), `:434-444` (reconnect timer), `rs.socket` assigned only at `:268` after awaits at `:211`/`:245-251`.
- **Evidence:** two concurrent calls both observe `!rs.socket`, both run `startSession` ⇒ two `makeWASocket` on the same auth folder; WhatsApp may answer the conflict with `DisconnectReason.loggedOut` ⇒ `wipeCredentials()` (index.ts:414-426) deletes local + persisted creds ⇒ **session loss / forced re-pair**.
- **Why:** state machine has no in-flight start guard; the retry window is widened because the route responds before start completes and `fetchLatestBaileysVersion` can take seconds.
- **Fix (minimal):** memoize the in-flight promise on the record — `rs.starting ??= startSession(rs).finally(() => { rs.starting = undefined })`; guard both the route and the reconnect timer with it.

### [P3-1] `/api` responses have no `Cache-Control: no-store`
- **Where:** `src/index.ts:519-521` — no-store applied only to `/dash/`, `/`, `/login`.
- **Evidence/why:** QR pairing secret + account phone digits leave with no cache directive; heuristic caching by intermediaries is unlikely on Render but free to close.
- **Fix:** extend the condition to `|| _req.path.startsWith("/api")`.

### [P3-2] "Both keys failed" log is not actionable
- **Where:** `src/persist.ts:263-267`.
- **Evidence/why:** recovery exists (fix env, restart — blob untouched) but the log never names `OPENWA_CREDENTIALS_KEY`; an operator hitting it after a key rotation mistake gets no pointer.
- **Fix:** include the env var names + "unset the wrong key and restart; the stored blob is untouched" in the warn.

### [P3-3] PII (phone digits) in stdout logs
- **Where:** `src/index.ts:871-880` (`[send]` logs `chatId` JID), `:385-394` (connected logs `accountDigits`); delivery-log responses carry chatIds (by design, key-gated).
- **Fix:** log last-4-digits or a hash for `chatId`/`accountDigits`; document log retention.

### [P3-4] QR route JSON/HTML status inconsistency
- **Where:** `src/index.ts:709-720` — HTML "no QR" ⇒ 200; JSON ⇒ 404 (unless ready).
- **Fix:** return 200 + `qr:null` on the JSON path (or document the 404-means-waiting contract).

### [P3-5] `contacts/check/:number` lacks digit-length bounds
- **Where:** `src/index.ts:742` — strips non-digits but accepts any length (pair-code and send-text enforce 8–15).
- **Fix:** same 8–15 bounds ⇒ 400.

### [P3-6] Dashboard pair-code endpoint has no rate limit
- **Where:** `src/dashboard-routes.ts:206-223` — the `/api` twin is 5/h/IP; the dash route is only cookie-gated (operator-only surface, still an abuse-sensitive issuance).
- **Fix:** reuse the `pairCode` rule in a dash-side limiter or per-session cooldown.

### [P3-7] Stale comments vs code
- **Where:** `src/index.ts:119-120` ("cap 25") and `:928` ("حتى 25 رسالة") vs `lib.ts:18` `DELIVERY_LOG_CAP = 500`; the `authenticating` status (index.ts:98, README lifecycle) is never assigned.
- **Fix:** comment/status cleanup.

### [P3-8] Unbounded-ish bookkeeping
- **Where:** `persist.ts:133` `wipedAt` never pruned (grows with distinct wiped names — tiny); `index.ts:134` sessions map has no count cap (trusted callers; rate-limited 240/min/IP).
- **Fix:** prune `wipedAt` in `deletePersisted` after a grace period; optional `MAX_SESSIONS`.

### [P3-9] Stateless dash cookie — no server-side revocation
- **Where:** `src/dashboard.ts:60-79`. Stolen token valid ≤12h; logout clears the client cookie only. Standard trade-off; a revocation epoch (version number inside the signed payload) would close it.
- Related: `/login` + `/logout` sit outside the `/dash` Origin check (index.ts:599) — login-CSRF/logout-CSRF nuisance only.

### [P3-10] `@types/pg` in `dependencies`
- **Where:** `package.json:18` — types belong in devDependencies (image-layer hygiene; no runtime impact).

### [P3-11] `fetchLatestBaileysVersion` has no timeout
- **Where:** `src/index.ts:245-251` — a hung registry fetch stalls `startSession` indefinitely (status stuck `initializing`); has try/catch but a hang is not an exception. Baileys-internal; note for awareness (combined with P2-2's missing start guard).

### [P3-12] `requireKey` length pre-check leaks key length (accepted)
- **Where:** `src/index.ts:486` — necessary for `timingSafeEqual`; length-only leak, standard practice. Documented as accepted, no change requested.

---

## Counts & attestation

- **Findings: 0 P0 · 2 P2 · 12 P3** (P3-12 is an accepted-risk note).
- **Files audited (14):** `src/index.ts` (1018), `src/persist.ts` (355), `src/lib.ts` (304), `src/rate-limit.ts` (340), `src/dashboard.ts` (181), `src/dashboard-routes.ts` (254), `src/dashboard-html.ts` (364), `tests/{lib,rate-limit,logged-out-reset,persist-key-separation}.test.mjs` (928 lines, 70 tests counted), `package.json` + `package-lock.json` (versions), `Dockerfile`, `tsconfig.json`, `dist/*.js` (parity greps), git history (178cc23/676f0bb/8616291 + pre-split persist.ts).
- **Claimed-state verification:** self-ping removed ✅ (src + dist), key separation ✅ (src + dist + tests, bit-exact compat proven against pre-split code), 70 tests counted ✅ (28+28+9+5), dist/src parity ✅ (routes 1:1, both changes present, dist newer).
- **Top risks to fix first:** P2-1 (async wrapper + error middleware), P2-2 (start guard), then P3-1 (no-store on /api) and P3-2 (actionable decrypt log).
