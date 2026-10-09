# R126-A3 — Admin Ops / Security / Settings Deep Audit (Round 126)

**Scope:** `frontend/src/pages/admin/{login, admins, security, risk, risk-event, alerts, system, settings}.tsx` (6,569 lines) + the backend surfaces they ride (`routes/admin/auth.ts` login/2FA/change-password/profile, `routes/admin/security.ts`, `routes/admin/risk.ts`, `routes/admin/alerts.ts`, `routes/auth-settings.ts` provider PATCH) + the pinning tests + the shared error pipeline (`lib/errors.ts`, `lib/admin-session.ts`, `shared/api-client-react/custom-fetch.ts`). **The two split candidates audited file-by-file:** `frontend/src/pages/admin/settings.tsx` (now **1,678** lines — grew from 1,493 in R125) and `backend/src/routes/auth-settings.ts` (**1,275** lines — the ledger's "auth-settings 1,267 split" resolves to this BACKEND god-file per R124-A9 #8; no frontend auth-settings file exists).

**Method:** full line-by-line read of all 8 pages + both split candidates at HEAD `186b131` (clean tree); state-machine walkthrough per surface (load → edit → save → reload round-trip, error, stale-refresh, empty, RBAC-less deep link); backend route reads to verify every contract the UI depends on; R124→R125 diffs (`git diff 09857fc..186b131`) to separate *residuals of findings R125 documented but never executed* from *new* defects; 5 guest-level live GETs against https://subnation.ly (admin endpoints 401 ✓, providers 200 ✓); raw-fetch + text-primary + text-yellow-400 enumerations via grep. Read-only: no source modified, no builds, no test runs. Rubric: audit.md + craft-floor; predecessors R125-A3/A6.

---

## A. R125 verification on my pages (held — do not re-fix)

| R125 fix | Verdict | Evidence @ 186b131 |
|---|---|---|
| 2FA rotate re-auth gate (A3-1) | **HELD — structurally sound** | settings.tsx:383-692: enrolled probe (417-428, cancelled-guard), client-side empty-password gate (433-436), password in POST body only when enrolled (448-449), belt-and-braces 400→rotate flip (463-466), rotation-semantics disclosure (607-610), state reset after verify (488-490). Backend gate verified: auth.ts:809-905 (S5 gate, `admin-2fasetup:` lockout with Arabic 429 incl. minutes, argon2 verify, audit rows). **One messaging defect survives — finding 3.** |
| Risk hasMore cursor (A4-B-6) | **HELD** | risk.tsx:143-162 infinite query on `next_cursor`; LoadMoreButton 488-497 |
| Risk error≠empty (A3-2) | **HELD** | risk.tsx:326-365 full chain (skeleton / page error / stale-refresh banner / empty) |
| Risk RBAC honest card (A3-11) | **HELD on risk only** | risk.tsx:107/201-209 (`canViewRisk`); **system.tsx + risk-event.tsx got nothing — finding 7** |
| Security «عرض N» + race guard (A3-5) | **HELD** | security.tsx:52/88-89 (seq token + AbortController), 133-176 (stale drop + first-load gate), 390-404 (honest count + 100-cap disclosure), CSV title disclosure 251 |
| Security/admins skeletons (A3-4) | **HELD on security + admins** | security.tsx:258-280 page-shaped w/ role=status; admins.tsx:202-207 TableSkeleton. **risk-event.tsx was in the same fix-order item and got nothing — finding 6** |
| aria-pressed chip bars (A6-B-10) | **HELD** | alerts.tsx:518/553, risk.tsx:303 |
| alerts deleteAll→useConfirm (A3-6c) | **HELD** | alerts.tsx:398-415 (count-naming dialog) |
| alerts missing type filters (A3-6b) | **HELD** | alerts.tsx:97-111 (all 8 filters incl. system + forecast_stockout) |
| document.title per route (A6-B-1) | **HELD** | layout.tsx:1094-1109 (restore-on-unmount included) |
| Alerts focus-reveal (A6-B-2) | **HELD** | alerts.tsx:730 (`sm:group-focus-within:opacity-100`) |
| Read-row contrast + sr-only unread (A6-B-15) | **HELD** | alerts.tsx:664-699 |
| Settings role Arabic mapping (A3-9a) | **HELD** | settings.tsx:375-383, 881-883 (+ `text-primary-text`) |
| 2FA verify input label (A6-B-13a) | **HELD** | settings.tsx:546-550 |
| System lazy-charts + cadence comments | **HELD** | system.tsx:38-57 (bridge), 271-299/1513-1555 (height-reserved Suspense), rationale comments at 472-473/484/495/512-513/539-540/550-551 |
| `leader` chip + retry links swept | **HELD** | system.tsx:957-963, 1105-1107 |

Known-open items **verified still open, not re-reported as findings**: raw-fetch remainder on my pages (7 sites: settings 1151, login 53/131 — by design, system 438/455, security 110/145); OpenAPI admin-endpoint gap; toNumber consolidation (settings has none); alerts «غير مقروء» tab counter = server-wide vs loaded-window chips (alerts.tsx:543-548 — R125-A3 #6d, minor-known).

---

## B. Findings

### 1. [P1] The password-change form promises the OPPOSITE of the shipped session-revocation behavior — success is followed by a surprise logout
**Location:** `frontend/src/pages/admin/settings.tsx:990` (copy), `:825-829` (success path) vs `backend/src/routes/admin/auth.ts:555-563, 643-651`
**Why:** The backend's A8-01 invariant (round-94) is explicit: change-password **"revokes EVERY session row for the admin (including this one) — a password change is a compromise response, so all outstanding tokens die with it"** (auth.ts:560-563), and it even returns the honest message `«تم تغيير كلمة المرور بنجاح — سيتم تسجيل خروجك من كل الجلسات»` (auth.ts:648-651). The settings form tells the operator the exact opposite — **«8 أحرف على الأقل. لن يتم إنهاء الجلسات الحالية الأخرى.»** (settings.tsx:990) — and on success toasts its own session-blind «تم تغيير كلمة المرور بنجاح» (settings.tsx:829) while **discarding the backend's response message**. The operator's very next request 401s → global handler fires «انتهت الجلسة» + redirect to login (admin-session.ts) — reading as a bug or an attack, not as the documented rotation semantics. This is the mandate's "password change + session/logout coherence" failing on the copy layer: every code path is correct, the contract disclosure is inverted.
**Fix sketch (S):** (a) flip the hint to the backend's truth («سيتم إنهاء جميع الجلسات — بمن فيها هذه — وسيتطلب ذلك تسجيل الدخول مجدداً»); (b) toast the backend's returned `message` (or hard-code the same wording); (c) after a beat, navigate to `/admin/login` proactively instead of waiting for the 401. Pin with a test asserting the copy no longer contains «لن يتم إنهاء».

### 2. [P2] Admin login error banner renders an English HTTP prefix on every failed password attempt — `HTTP 401 Unauthorized: اسم المستخدم…`
**Location:** `frontend/src/pages/admin/login.tsx:94-96` + `shared/api-client-react/src/custom-fetch.ts:220-241, 258-263`
**Why:** The password step rides the orval mutation; its `onError` does `setError(err instanceof Error ? err.message : …)` — the error is `ApiError`, whose message is `buildErrorMessage()` = `` `HTTP ${status} ${statusText}: ${message}` `` (custom-fetch.ts:221, 237). So the console's most-visible error surface shows mixed-language jargon: **«HTTP 401 Unauthorized: اسم المستخدم أو كلمة المرور غير صحيحة»**, and on lockout **«HTTP 429 Too Many Requests: الحساب مقفل بسبب محاولات فاشلة. حاول بعد 5 دقيقة.»**. The 2FA sibling path was fixed for exactly this class in R96 (login.tsx:136-151 parses after ok-guard, maps via `getErrorMessage`); the password path was missed — and R125-A1's verification ("no raw English reaches the operator", verified via the 2FA path + code map) covered the wrong branch. The Arabic-script leak-guard in `trustedServerMessage()` (errors.ts:155-159) already exists to kill exactly this string — the login mutation just never routes through it.
**Fix sketch (S):** in `loginMutation.onError`, map through `getErrorMessage((err as ApiError).data)` (the parsed body rides `.data`), keeping the Arabic fallback; or strip the `HTTP \d+ …:` prefix. Pin with a test feeding a 401 envelope asserting the rendered banner contains no `HTTP `.

### 3. [P2] `getErrorMessage`'s code-map priority discards the backend's specific re-auth wording on all three sudo surfaces — wrong password tells the operator to «log in again»
**Location:** `frontend/src/lib/errors.ts:154-156` (priority) consumed via `adminFetchJson` (admin-session.ts:238-240) at settings.tsx:467 (2FA rotate), :833 (change-password), :772 (profile) vs backend auth.ts:891-895
**Why:** `getErrorMessage` returns `errorMessages[err.code]` **before** looking at the server's own Arabic `error` string (errors.ts:154-156 runs before the `err.error` branch at 168). The backend's re-auth failures pair a *specific* Arabic message with the generic `UNAUTHORIZED` code: wrong current-password on the 2FA rotate gate returns `«كلمة المرور الحالية غير صحيحة»` (auth.ts:891-895) — but the client renders the code map's `«غير مصرح — سجّل دخولك مرة أخرى وحاول»`. In the rotate form that is actively misleading: the session is perfectly valid, the typed password is wrong, and the operator is told to re-login. Same mangling on the change-password and profile-confirm forms. (The 429 lockout mapping to the generic map text is deliberate and test-pinned — settings-2fa-re-enroll.test.tsx:224-227 — so only the *minute count* is lost there, P3-worthy footnote, not this finding.)
**Fix sketch (S/M):** in `getErrorMessage`, prefer a present, Arabic-script `err.error` string over the code map when both exist (the `trustedServerMessage` guard already makes this safe), or add an `adminFetchJson` option `{ preferServerMessage: true }` for the three re-auth call sites. One-line test: body `{error:"كلمة المرور الحالية غير صحيحة", code:"UNAUTHORIZED"}` → expect the server string.

### 4. [P2] R125's contrast sweep (~25 sites, changelog-claimed) never reached its own named settings/admins sites — 13 raw text-ink sites remain, 6 of them named verbatim in R125-A6 B-4/B-6
**Location & evidence (all verified at HEAD; R125-A6's own computed ratios):**
- **settings.tsx:685** — fresh-enrollment 2FA CTA `bg-primary/10 text-primary` — the **exact site A6-B6 listed** ("settings 2FA CTA, on /10 tint" = 3.56:1 dark). Its sibling at :637 was fixed to `text-primary-text`; this one was missed.
- **settings.tsx:1262-1265** — scope-gate banner `text-amber-500 bg-amber-500/10` — the **exact site A6-B4 listed** (light **1.99:1**).
- **settings.tsx:1297** — auth-summary pill `bg-primary/10 text-primary` (3.56:1 dark).
- **settings.tsx:1537/1541/1547/1548** — `font-mono text-primary` inline code tokens on card (3.76:1 dark).
- **admins.tsx:252, 295** — «أنت» and «جميع الصلاحيات (مسؤول رئيسي)» chips `bg-primary/10 text-primary` (3.56:1 dark).
- **settings.tsx:502-504** — 2FA success card `text-emerald-500` on `bg-emerald-500/10` (light ≈2.4:1).
- **settings.tsx:1446** — integrations rows `text-emerald-400 / text-red-400` status text (light 1.92/2.77:1 — R125-A3 #8 listed, still raw).
- **settings.tsx:316-319** — OAuth callback hint `text-blue-400` (light ≈2.9:1).
**Why it matters:** the R125 CHANGELOG claims "~25 text-primary + raw -400 hue sites token-swept to both-theme-safe inks"; `git diff 09857fc..186b131` shows the sweep landed on dashboard/orders/topups/layout only — settings.tsx got exactly one site (the role badge) and admins.tsx none. Dark is the default (all pass ≥3.5:1 except none below 3:1), but the shipped light theme toggle makes every one of these a sub-AA text surface. This is the actionable delta between the R125 claim and reality — the rest of the raw-hue tail (alerts TYPE_META, system MetricCards, risk DashCard) is documented-known-open.
**Fix sketch (S, mechanical):** one commit sweeping the 13 listed sites to `text-primary-text` / `--status-*` ink+tint pairs (the in-repo idiom, regression-testable via the existing contrast-pin pattern used in R125's swept files).

### 5. [P3] R125-A3 #9 copy batch was only partially executed — five of its items survive verbatim
**Location & evidence:**
- **settings.tsx:1291-1293** — «{enabledCount} طريقة مفعّلة» still has no Arabic plural handling (2 providers renders «2 طريقة مفعّلة», not «طريقتان مفعّلتان»); `formatCount` + forms object sit one file over (security.tsx:54-62 is the recipe).
- **settings.tsx:852-859** — AccountTab null-session state is still a bare text line («تعذّر تحميل بيانات الحساب. حاول إعادة تسجيل الدخول.») with no error-card and **no retry** — every sibling failure on the page rides the card idiom.
- **risk-event.tsx:302** — mutation success still renders the inline `text-emerald-400` «تم حفظ التصنيف.» line instead of the console toast idiom.
- **system.tsx:995** — diag error still asserts a cause it cannot know («يتطلب صلاحيات إدارية» — could equally be network) and has **no retry** (the metrics error card at 1093-1111 got both in R125; this one didn't).
- **risk-event.tsx:263-269** — notes textarea still placeholder-only (A6-B13 named it; the 2FA verify input got its sr-only label, this one didn't).
**Fix sketch (S):** one mechanical copy commit, same shapes as the executed siblings.

### 6. [P3] risk-event.tsx still ships the console's last bare-text first-load state — the R125-A3 #4 batch item that didn't land
**Location:** `risk-event.tsx:129-135`
**Why:** a centered «جارٍ التحميل…» div with no `role="status"`, no sr-only label, no page shape — on a fraud-investigation page whose parent list got the full `TableSkeleton` treatment in the same R125 fix-order item (#4 named "security/admins/whatsapp/risk-event skeletons"; security + admins landed, risk-event didn't). A6-B8's shared-component fix can't reach it because the loader is hand-rolled here.
**Fix sketch (S):** swap for `TableSkeleton` (the detail page's 4-stat grid + sections) or a page-shaped shimmer card with the role=status + sr-only pair.

### 7. [P3] RBAC deep-link honesty: system.tsx and risk-event.tsx still fire queries on scope-less mounts and land on generic errors — R125-A3 #11's second page never got the fix
**Location:** `system.tsx:422-600` (no `hasAdminPermission` anywhere in the file; 6 queries gated only on `adminToken`) and `risk-event.tsx:93-98` (`enabled: !!id` — not even a token gate); nav scopes at layout.tsx:129/134
**Why:** risk.tsx got the honest-reason card (R125-I4, risk.tsx:201-209) but its two siblings named in the same finding didn't: a settings-scope-less admin deep-linking `/admin/system` eats 6 parallel 403s and lands on per-panel generic failures; a users-scope-less admin deep-linking `/admin/risk/events/123` gets «فشل تحميل الحدث» with no reason. risk-event additionally never gates on `adminToken` (the R123 P3g class its parent page fixed).
**Fix sketch (S):** the risk.tsx:201-209 card idiom (`canViewRisk = hasAdminPermission("settings"|"users")` + honest Arabic reason + `enabled:` gates).

### 8. [P3] risk-event error state has no retry — the drill-in dead-ends on a transient failure
**Location:** `risk-event.tsx:136-152`
**Why:** the error branch renders the back-link + a red «فشل تحميل الحدث» banner and nothing else — no `refetch` affordance. Its parent list gained an inline retry in the same round (risk.tsx:337/352-356). An operator investigating fraud over a flaky connection must leave the page and re-drill.
**Fix sketch (S):** FetchErrorCard with `onRetry={() => void query.refetch()}` (the risk.tsx:331-339 recipe).

### 9. [P3] ProviderCard: dead `error` state, an unreachable placeholder branch, and an unused prop — the audit's dead-code batch
**Location:** `settings.tsx:157/167/359` (error state set only to `""`; the catch at 189-199 toasts instead — so the `{error && …}` render at 359 can never fire), `:281-285` (the `«•••• (مُعيَّن)»` placeholder is chosen exactly when `config[key] === "[SET]"` — i.e. when the input's value is non-empty — and placeholders only render on empty inputs; the hint is unreachable by construction), `:142` (`adminToken` prop destructured as `_adminToken` and never used)
**Why:** three pieces of scaffolding that look load-bearing and aren't — the kind of thing the next editor traces for nothing. The backend masker (auth-settings.ts:195-208) sends `"[SET]"` as the *value*, so the field shows five masked dots; the intended affordance never appears. (Round-trip honesty is otherwise fine: PATCH returns the re-masked config, `setConfig(nextConfig)` at 185, and the backend skips `"[SET]"`/`""` secrets at auth-settings.ts:1231 — no accidental secret wipe.)
**Fix sketch (S):** delete the error state + render; either drop the placeholder branch or move the hint under the label (`<p className="text-3xs">مُعيَّن — اتركه فارغاً للإبقاء عليه</p>` when value === "[SET]"); drop the prop.

### 10. [P3] ProviderCard config edits have no unsaved-changes protection — the page's only unguarded form surface
**Location:** `settings.tsx:140-364` (no `useDirtyGuard`; the account tab at 801 and both admins dialogs at 378/542 ride it)
**Why:** the mandate's unsaved-changes matrix is otherwise complete on this page: AccountTab guards profile+password (793-801). ProviderCard config edits (bot tokens, private keys — the highest-stakes fields on the page) are silently discarded on tab close/navigation, with no per-card dirty indicator either. The enabled toggle is exempt (it saves optimistically with rollback at 159-203 — correct).
**Fix sketch (S):** per-card `useDirtyGuard(config !== provider.config)` + a subtle «غير محفوظ» tag on the card header when dirty.

### 11. [P3] ProviderCard: clearing a non-secret field surfaces a misleading 400 with no field-level validation
**Location:** `settings.tsx:165-203` vs backend `auth-settings.ts:1190-1218`
**Why:** the PATCH schema is `z.string().trim().min(1).max(500)` per field — clearing `bot_username` (a non-secret) and saving 400s with the generic «قيمة غير صالحة لإعدادات المزوّد (نصوص فقط ضمن الحدود المسموحة)», which reads like a type error, not "you emptied a required field". No client-side min(1) check, no field-level error state (the dead one from finding 9 was supposed to be this).
**Fix sketch (S):** validate non-secret fields client-side (min 1, same max) and mark the offending field; or at minimum map this 400 to «لا يمكن ترك حقل X فارغاً».

### 12. [P3] system.tsx jobs panel: silent top-8 truncation and raw English status tokens inside an Arabic panel
**Location:** `system.tsx:1398-1430`
**Why:** the «المهام الخلفية» panel sorts `jobsTotal` and `slice(0, 8)`s it with no «عرض 8 من N» disclosure (the honest-counts contract every list on my set now honors), and renders the raw `status` segment of each key — literal English `failed` / `success` — as the row's status word (1421-1423) with no Arabic mapping (the `statusLabel` idiom exists console-wide). Also worth noting for the observability mandate: this is a counters-only view — no last-run timestamps or durations are surfaced anywhere (whether the backend exposes job-run history: **UNVERIFIED** — not checked this round).
**Fix sketch (S):** drop the slice or disclose it; a 2-entry `JOB_STATUS_LABELS` map (`failed→فاشلة`, `success→ناجحة`, plus passthrough).

### 13. [P3] risk.tsx filter-chip counters are loaded-window counts and silently degrade to filtered-subset counts on a background-fetch failure
**Location:** `risk.tsx:175-194, 313`
**Why:** with a filter active, counters come from the unfiltered `allEventsQuery` (first 100 rows — undisclosed ceiling), and its `?? events` fallback (183) resurrects the exact 94-C2 A2 P3-1 bug (filtered subset → every other chip reads (0)) whenever that background query errors — with no error surface of its own. The chips also don't disclose "loaded so far" semantics (the «الكل» count grows with load-more, the others don't reconcile).
**Fix sketch (S):** render counters from `dashboard.data.by_level` (the server-side 24h window already fetched for the DashCards — same source, always unfiltered), or disclose the window; give `allEventsQuery` a silent-degradation note.

### 14. [P3] alerts.tsx 20s poll still carries no inline rationale comment — the R125-A3 #7 doc item that didn't land
**Location:** `alerts.tsx:234` vs system.tsx:472-473/484/495/512-513/539-540/550-551 (every cadence documented)
**Why:** the console's own convention (born in R125 on system.tsx) is a one-line why-this-number comment per poller; the alerts 20s (vs badge-fallback 300s, reconciled only via the socket push) is the exact case the convention was written for. Also adjacent: security.tsx filter flips have no in-flight cue (stale rows + stale «عرض N» header render under the new selects until the guarded fetch lands — race-safe but visually unacknowledged).
**Fix sketch (S):** two comment lines (+ optionally an `aria-busy`/opacity cue on the security list while `isFetching`-equivalent).

### 15. [P3] Admin login has no return-path handling — deep links to a specific admin page always land on the dashboard
**Location:** `App.tsx:551-553` (guard drops the URL) + `login.tsx:88, 161` (both success paths `navigate("/admin")`)
**Why:** an operator following a shared link to `/admin/settings?tab=auth` (or any deep link) while logged out is bounced to `/admin/login`, authenticates, and lands on `/admin` — the original URL is lost. The 2FA step preserves username/password state correctly (289-302) but nothing preserves the destination.
**Fix sketch (S):** the guard stashes the path (`navigate("/admin/login?next=" + encodeURIComponent(path + search))`); login navigates to a sanitized `next` (same-origin, `/admin/`-prefixed) after session bootstrap. (Mind the open-redirect rule: allow-list the prefix.)

### 16. [P3] Micro-batch: memo opportunity in system.tsx + two small a11y notes
**Location:** `system.tsx:613-620` (samples slice + 4× `deriveDelta` + 3 series maps recomputed every render of a 15s-polling page — ≤120 items so cheap, but the idiomatic `useMemo` on `[metricsQ.data, diagQ.data]` is free); `alerts.tsx:663` (unread-row `onClick` on a plain div — keyboard path exists via the dedicated button at 731-743, but the row could carry `role="button"` + Enter handler or drop the pointer affordance); `login.tsx:289-302` (the «العودة لتسجيل الدخول» back button leaves focus on itself after the step swap — a `usernameRef.focus()` would restore the flow).
**Fix sketch (S):** three mechanical touches.

---

## C. The text-yellow-400 tail — exact enumeration at HEAD 186b131 (mandate item 10)

All 20 occurrences across the three files, classified (ratios from R125-A6's computed set: yellow-400 on dark card **12.15:1** ✓ / on `/10` tint over dark **8.79:1** ✓ / on light card **1.53:1** ✗ / on `/10` over light **1.43:1** ✗):

| # | file:line | What | Text ink? | On a critical path? |
|---|---|---|---|---|
| 1 | alerts.tsx:67-69 | `TYPE_META.low_stock` cluster (color/bg/border) — feeds icon (682), label chip (702), filter chip (521) | **YES** (chip + label) | Label chip is the row's type identifier — one of three near-identical yellows (amber-400 coupon_maxed, orange-400 coupon_expiring — the R125-A3 #8 collision, still open) |
| 2 | system.tsx:182-184 | `STATUS_META.degraded` cluster — feeds HealthTile icon+**value** (377/383), scheduler banner title (915), scheduler details title (949) | **YES** (value + titles) | **The page's core degraded-health signal** — the operator's most important warning state |
| 3 | system.tsx:721 | aggregate-status dot `bg-yellow-400` | no (decorative dot) | Adjacent `text-yellow-400` label at 725 comes from the same STATUS_META — see #2 |
| 4 | system.tsx:993 | diag-error AlertCircle icon | no (icon, 3:1 non-text) | — |
| 5 | system.tsx:1098 | metrics-error AlertCircle icon | no (icon) | — |
| 6 | system.tsx:1198 | route error-percentage text (`errPct <= 1` branch) | **YES** (text-3xs bold) | Error telemetry on the top-routes table |
| 7 | system.tsx:1234-1237 | auth failure-rate MetricCard (color/bg/border) | **YES** (the metric value) | Security KPI |
| 8 | system.tsx:1480 | CWV degraded dot | no (decorative) | — |
| 9 | system.tsx:1590 | recent-alerts AlertTriangle icon | no (icon) | — |
| 10 | referrals.tsx:69 | status-tone map entry | **YES** (badge) | Pending-status badge family |
| 11 | referrals.tsx:170 | pending pill `bg-yellow-500/10 text-yellow-400` | **YES** | Pending-commission badge |
| 12 | referrals.tsx:189 | pending-count text | **YES** | Money-adjacent counter |
| 13 | referrals.tsx:480-481 | status-chip color/bg props | **YES** | Status chip |
| 14 | referrals.tsx:497 | Trophy icon | no (icon) | — |

**Verdict:** **9 text-ink sites** (1, 2, 6, 7, 10-13) + 5 icon-only + 2 decorative dots (plus the alerts cluster's bg/border lines). **None fails on the default dark theme** (8.79-12.15:1 — all pass AA comfortably); **all 9 text sites fail on the shipped light theme** (1.43-1.53:1). The most contrast-critical siting is #2 (system degraded-health value — the exact signal an operator must read under stress) and #1 (the low_stock chip, already weakened by the three-yellow collision). This stays consistent with the ledger's raw-hue long-tail item; the enumeration above is the current exact list for the tail-closing lane.

---

## D. Split plan 1 — `frontend/src/pages/admin/settings.tsx` (1,678 lines → 4 modules)

**Principle:** file-level decomposition with the route entry and URL semantics 100% intact — `App.tsx:67` keeps `lazyWithRetry(() => import("@/pages/admin/settings"))`, the `?tab=` contract, the tablist ARIA, and the scope gate untouched. (The R125-A3 #13 idea of a separate `/admin/settings/auth-providers` *route* is deliberately NOT taken: it would churn PAGE_TITLES/nav/deep-links and the tests that pin them for zero behavioral gain; the file split removes the same reading/maintenance cost.)

| New module | Moves (current lines) | ≈ LOC | Export surface |
|---|---|---|---|
| `pages/admin/settings/provider-card.tsx` | `ProviderIcon` (101-136), `ProviderCard` (140-365), `AuthProvider` + `ProviderField` interfaces (62-80) | ~300 | `ProviderCard`, `AuthProvider`, `ProviderField` |
| `pages/admin/settings/two-factor-setup.tsx` | `TwoFactorSetup` (383-692) incl. the enrolled probe + rotate form | ~320 | `TwoFactorSetup` |
| `pages/admin/settings/account-tab.tsx` | `AccountTab` (713-1067), `AdminSession` (704-711), `ROLE_LABELS`/`roleLabel` (375-381) | ~380 | `AccountTab`, `roleLabel`, `AdminSession` |
| `pages/admin/settings.tsx` (stays the entry) | page shell: TABS + `tabAllowed` (82-97), fetch/retry logic (1093-1216), tab bar + scope fallback (1232-1266), auth-providers tab shell + summary (1276-1358), integrations/Telegram tab incl. diagnostic ping (1361-1564), notifications tab (1566-1601), security tab + facts panel (1603-1672) | ~620 | default `AdminSettingsPage` (unchanged) |

**Shared helpers note:** `useAdminHeaders`/`adminFetchJson`/`useToast` imports move with their consumers; nothing circular (the three children import nothing from the page).

**Test impact (verified against the pinning suite):**
- `settings-2fa-re-enroll.test.tsx` — imports `AdminSettingsPage` from `@/pages/admin/settings` and drives the full page → **green unchanged** (the rotate flow renders inside the page shell exactly as today).
- `settings-security-facts-copy.test.ts` — `readFileSync("src/pages/admin/settings.tsx")` scans for the facts-panel copy → **stays green unchanged** because the security facts panel stays in the page shell (D table, last row). Add one line if the copy ever moves: point the scanner at the new path.
- `no-native-confirm.test.ts:28` — scans a fixed path list including `pages/admin/settings.tsx` → **must add the three new paths** to `C7_OWNED_FILES` (one-line change, otherwise the guard's coverage silently shrinks).
- New test opportunity (not required for the split): `provider-card.test.tsx` (save/rollback/optimistic-toggle), `account-tab.test.tsx` (dirty-guard matrix, re-auth error mapping — would have caught findings 1/3/9/10/11).

**Execution order:** (1) move the three components verbatim (no reformat, no renames — byte-move for reviewability); (2) fix the three test-path additions; (3) `npx vitest run src/pages/admin/__tests__/settings-2fa-re-enroll.test.tsx src/pages/admin/__tests__/settings-security-facts-copy.test.ts src/pages/admin/__tests__/no-native-confirm.test.ts`; (4) typecheck. Estimated ~1 lane-hour, zero behavior change by construction.

## E. Split plan 2 — `backend/src/routes/auth-settings.ts` (1,275 lines → 3 modules)

Resolves R124-A9 #8 (the ledger's "auth-settings 1,267 split"). Import graph verified clean: only `routes/index.ts:22` consumes the module in production code (`authProviderPublicRouter`, `authProviderAdminRouter`); tests: `auth-providers-cache.test.ts`, `telegram-callback-csrf.test.ts` (also imports `isTelegramCallbackSameOrigin`), `telegram-referral-gate.test.ts`.

| New module | Moves (current lines) | ≈ LOC | Export surface |
|---|---|---|---|
| `services/telegram-auth-flow.ts` | `findOrCreateTelegramUser` (416-521), `handleTelegramAuth` (522-723), `handleTelegramWebAppAuth` (724-~1029) — the ~600-line business-logic core (user creation, referral events, session minting, replay-claim, risk emission). Depends only on lib/ + db (R124-A9's verified claim). Template: the 637-line `services/firebase-auth.service.ts` | ~620 | the three handler functions (+ any internal types) |
| `lib/telegram-callback.ts` | `telegramCallbackAllowedOrigins` (1031-1054) + `isTelegramCallbackSameOrigin` (1055-~1150) + `TELEGRAM_CALLBACK_CSRF_ERROR` | ~120 | `isTelegramCallbackSameOrigin` (re-exported from auth-settings.ts for the test — or update the one test import) |
| `services/auth-settings-store.ts` | `getSetting` (140-152), `getAllAuthSettings` (169-184), `upsertSetting` (186-193), `maskSecret`/`buildMaskedConfig` (195-208) — **and this is where the 4 `as any` casts die**: type the raw `db.execute` rows once (`{ rows: Array<{ key: string; value: string }> }`) instead of casting at each call | ~80 | the four store functions |
| `routes/auth-settings.ts` (stays) | provider metadata `PROVIDERS` (70-136), cache key + middleware (232-258), public router (providers list 260-365 + the telegram endpoints, now thin delegations to the service), admin router (1153-1275) | ~430 | **unchanged**: `authProviderPublicRouter`, `authProviderAdminRouter`, `isTelegramCallbackSameOrigin` (re-export) |

**Test impact:** the three existing test files keep importing from `../auth-settings` → **green unchanged** (routers + predicate re-exported). The extracted service gains its first direct unit-test surface (today the telegram flows are covered only through 3 route-level tests — the R124-A9 "least-testable code in the file" note). `routes/index.ts` untouched.

**Execution order:** (1) extract the store + callback helpers first (pure moves, no consumers change beyond imports); (2) extract the telegram handlers, leaving one-line delegations in the route; (3) run `routes/__tests__/auth-providers-cache.test.ts`, `telegram-callback-csrf.test.ts`, `telegram-referral-gate.test.ts` + backend typecheck; (4) optionally add `services/__tests__/telegram-auth-flow.test.ts` seeding the direct coverage. Zero behavior change by construction; the route registration surface is byte-identical.

---

## F. Summary

| # | Sev | One-liner | Effort |
|---|---|---|---|
| 1 | **P1** | Password-change copy inverts the A8-01 session-revocation truth; success → surprise logout (settings.tsx:990/829 vs auth.ts:560-563) | S |
| 2 | P2 | Login error banner ships «HTTP 401 Unauthorized: » English prefix (login.tsx:95 + custom-fetch.ts:221) | S |
| 3 | P2 | Code-map priority mangles re-auth errors: wrong password → «سجّل دخولك مرة أخرى» on all three sudo forms (errors.ts:154) | S/M |
| 4 | P2 | R125's token sweep missed its own named sites — 13 raw text-ink sites in settings/admins (685, 1263, 1297, 1537-48, 502-04, 1446, 316-19; admins 252/295) | S |
| 5 | P3 | R125-A3 #9 copy batch residuals ×5 (طريقة plurals, AccountTab bare state, risk-event toast, diag cause+no-retry, notes label) | S |
| 6 | P3 | risk-event bare-text loader — #4's unlanded sibling (129-135) | S |
| 7 | P3 | RBAC honest cards missing on system + risk-event (#11's unlanded half; risk-event also lacks the token gate) | S |
| 8 | P3 | risk-event error state has no retry (136-152) | S |
| 9 | P3 | ProviderCard dead error state + unreachable «(مُعيَّن)» placeholder + unused prop | S |
| 10 | P3 | ProviderCard edits lack unsaved-changes guard (page's only unguarded form) | S |
| 11 | P3 | Cleared-field 400 copy misleading; no client-side min(1) | S |
| 12 | P3 | system jobs panel: silent slice(0,8) + raw English status tokens | S |
| 13 | P3 | risk chip counters: loaded-window semantics + failure-path regression to filtered counts | S |
| 14 | P3 | alerts 20s poll rationale comment missing (+ security filter in-flight cue) | S |
| 15 | P3 | Login return-path not preserved — deep links land on dashboard | S |
| 16 | P3 | Micro-batch: system memo, alerts row semantics, login back-focus | S |

**Counts: P0 0 · P1 1 · P2 3 · P3 12 (16 numbered; #5 and #16 are batches).**

**Fix order (ponytail):** 1 → 2 → 3 (one auth-honesty lane, three findings, all copy/mapping — the round's highest value) → 4 (one mechanical sweep commit) → 7 + 8 + 6 (risk-event/system honesty lane) → 5 (copy batch) → 9-11 (ProviderCard lane, pairs naturally with split plan D) → 12-16 (polish). The two split plans (D, E) are independent of every fix and of each other — hand either to an implementation lane as-is.

**Live checks (guest):** /admin/login 200 · /api/admin/settings/auth 401 · /api/admin/auth-stats/summary 401 · /api/admin/risk/events 401 · /api/auth/providers 200 (telegram enabled + configured) — auth posture sound from the outside.

*Read-only audit: no source files modified, no builds, no test suites run, nothing committed. Only this report file was created.*
