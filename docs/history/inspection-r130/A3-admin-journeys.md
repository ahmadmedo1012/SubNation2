> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r130/A3-admin-journeys.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R130-A3 — Admin dashboard deep operator review

**Method:** full source walk of all 21,000 lines under
`frontend/src/pages/admin/` (+ SessionManager, shared hooks,
admin-session.ts), backend route/RBAC mounts, against the
R125/R126/R127/R128/R129 prior findings. No requests, no mutations, no
secrets printed. (This lane was killed twice by a provider outage and
re-run short-handed — the walk is complete, the write-up condensed.)

**Counts: P0 0 · P1 0 · P2 0 · P3 5** — the console's state-truth layer
remains the strongest surface in the repo; the residues are one dangling
return-path contract, two silent-failure pockets, and two RBAC-deep-link
stragglers.

## Findings

### A3-F1 [P3 · VERIFIED] Admin login never consumed the `?redirect=` return path — FIXED R130
`admin-session.ts:124` writes `?redirect=<current>` on mid-work 401, but
both success paths in `admin/login.tsx` (:88 password, :169 2FA)
unconditionally navigated `/admin` — every mid-work expiry stranded the
operator away from the money-review/dialog they were in. **FIXED R130**:
the param is honored ONLY for internal admin paths (must start with
`/admin`, never `/admin/login` — open-redirect guard) on both success
paths.

### A3-F3 [P3 · VERIFIED] The ⌘K GlobalSearch answered an API failure with «لا نتائج» — FIXED R130
`layout.tsx` jsonList's catch collapsed every failure (error envelope, 5xx,
network) to `[]`, and the definitive «لا نتائج لـ "q"» branch (plus its
aria-live mirror) rendered on total===0 — during a backend outage the
console's primary record-finding tool asserted the order/user/product does
not exist (the B5-04 false-empty class, surviving in the one overlay whose
whole job is truth under time pressure). **FIXED R130**: a per-round
`fetchFailed` flag (abort + 401 exempt — the debounce contract and the
global session handler's territory); the failed round renders «تعذّر البحث
— تحقّق من الاتصال وأعد المحاولة» instead. The two tests that pinned the
old false-empty contract updated to pin the honest one.

### A3-F2 [P3 · VERIFIED — FIXED R133] The risk page's 24h dashboard tiles silently vanish on first-load failure and go silently stale on refresh failure
`risk.tsx:109-122` polls the dashboard every 30s; render is
`{dashboard.data && ...}` with no error/loading/empty branch — a refresh
failure keeps stale critical/high counts with no stale cue; a first-load
failure drops the tiles entirely (incl. the RISK_PIPELINE_ENABLED verdict)
while the events list 100px below ships the full triad. Smallest fix:
mirror the events triad (skeleton / FetchErrorCard / stale banner).
**FIXED R133**: the dashboard section now renders its own skeleton →
error card (retry) → stale-keep banner triad, pinned by 2 new tests in
`risk-error-state.test.tsx`.

### A3-F4 [P3 · VERIFIED — FIXED R133] system.tsx fires all six settings-gated queries for any authenticated admin
A scope-less deep-linker gets a synchronized 403 burst per poll cycle, and
`healthQ`'s queryFn maps ANY failure — including 401/403 — to
`{status:"degraded"}`: an authorization outcome renders as an
infrastructure verdict. Fix: the `risk.tsx:107` pattern —
`hasAdminPermission("settings")` gate → honest-reason banner + `enabled:
false` on every query.
**FIXED R133**: the `canViewSystem` gate (banner + `enabled` on all six
queries) + `fetchAdminHealthReady` throws on non-503 failures (503 stays
parsed — it IS the health verdict) + the health section renders a
FetchErrorCard on error, pinned by `system-settings-gate.test.tsx`.

### A3-F5 [P3 · VERIFIED — FIXED R133] risk-event.tsx remains the least-guarded surface
Bare-text loader (:131-137), dead-end error with no retry (:138-154), no
`hasAdminPermission("users")` gate while the backend risk family requires
that scope, no 404-vs-outage distinction.
**FIXED R133**: the users-scope gate (fetch-free mount), a page-shaped
skeleton, the 404 («الحدث غير موجود» + back link, no lying retry) vs
outage (FetchErrorCard + retry) fork — `adminFetchJson` now carries the
HTTP status on its thrown errors (additive). Pinned by
`risk-event-error-state.test.tsx`.

## Mission checkpoints (page-by-page, condensed)
False-empty/retry clean everywhere except F2/F3 (11 list pages verified
skeleton → FetchErrorCard-with-retry → stale-keep → honest empty);
mutation invalidation uniform (base-key + stats co-invalidation; alerts
optimistic patch+rollback; money writes carry Idempotency-Key); filters
server-side with honest caps disclosed; all 17 destructive confirms ride
useConfirm with consequence copy; nav-scope parity test-backed (gaps:
F4/F5); stale races abort/debounced (no new races); single-fire
invalidations, all polls refetchIntervalInBackground:false; select-all
membership-honest on orders/products (inherited-open: selection never
pruned on filter flip); **backend spot-checks on the 3 riskiest actions ALL
PASS** (bulk refund → finance scope + RefundService status-guard + audit;
topup approve → finance mount + idempotency middleware + audit with actor;
wallet/points PATCH → users+finance double gate + before/after audit row).

## Inherited
VERIFIED CLOSED: R127-B15-1/2/3, R126-A3-1/2, R125-A3-1/5, R126-L3/R127-B2
select-all, B15-8 (one site). STILL OPEN (carried, do not re-close):
R126-A1-11/13, A2-9, A3-9/10/11/12/13/15(=F1, now fixed), R127-B15-4/5/6/7/
8/9/11, R126-A1-1/26 socket-push absence, selection-not-pruned.
