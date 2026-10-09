# R127-B1 — OpenAPI Batch-2 + Generated-Client Completion Audit

**Agent:** R127-B1 (READ-ONLY auditor; only this report + one worklog append created)
**Repo state:** `main @ f53a886`, clean tree (verified: `git status --short` empty, pre-existing `stash@{0}` from 186b131 untouched). Production subnation.ly runs this tree.
**Predecessors this round delivers on:** R126-A4 §C/§D (flip inventory + batch plan), R126-L8b (batch-1: 17 endpoints exposed, alerts/security flipped, dashboard deferral), R126-R1 §2 row 9 (challenge-cleared).

**Method:** full reads of every flip-target file (dashboard.tsx 1353 L, topups.tsx 1559 L, referrals.tsx 670 L, tickets.tsx 827 L) + all 6 pinning test files + `custom-fetch.ts` + `lib/admin-session.ts` + `lib/errors.ts`; handler reads for every batch-2 shortlist endpoint (observability/diagnostics/risk/forecast/enrichment/admins/alerts/copilot-settings/auth-session/auth-settings); spec-vs-mount diff re-derived from source (not inherited); **orval regen executed via the exact CI-gate command** (read-only w.r.t. tracked files — verified clean). No builds, no test runs, no commits.

---

## 0. Executive verdicts (the 4 flip questions + regen + batch-2)

| # | Question | Verdict | Confidence |
|---|---|---|---|
| 1 | dashboard.tsx chart-data flip (R126-L8b deferral) | **FLIP NOW** — deferral reason was lane-risk, not a permanent blocker; exact plan in §3.1 | 4 |
| 2 | topups.tsx #8/#9 bulk loops flip | **FLIP NOW** — mechanical per-iteration swap, idempotency keys + 401-break survive verbatim; plan §3.2 | 5 |
| 3 | referrals.tsx flip | **FLIP NOW** — the security.tsx R126-L8b template fits 1:1 (same seq/abort/debounce shape); plan §3.3 | 4 |
| 4 | tickets.tsx flip | **FLIP NOW** — smallest of the four (adminFetchJson → generated fetchers inside existing RQ queries); plan §3.4 | 5 |
| 5 | Orval regen drift | **CLEAN** — `pnpm --filter @workspace/api-spec run codegen` (orval + api-zod index rewrite + `tsc --build`) exits 0, `git status` empty after | 5 |
| 6 | Batch-2 exposure | **53 admin-family + 6 storefront endpoints unexposed** (105−52 re-derived at HEAD); prioritized 20-op shortlist in §4 | 5 |

**P0: 0 · P1: 0 · P2: 1 (the exposure gap itself, now scoped+sequenced) · P3: 3.** No drift, no spec lie, no money-path regression found.

---

## 1. Findings (P0–P3)

### F-1. [P2 → scoped plan] 53 of 105 admin-family endpoints + 6 storefront endpoints remain spec-unexposed at HEAD (batch-1 verified complete, batch-2 list in §4)

Re-derived from source (not inherited from A4): route defs `rg 'router\.(get|post|patch|put|delete)\(' backend/src/routes/admin/**` + copilot (9) + `/admin/settings/auth` PATCH = **105 admin-family endpoints**; spec admin-family ops parsed out of `openapi.yaml` = **52** (matches A4's "35→52" post-batch-1 exactly — method-by-method, file `shared/api-spec/openapi.yaml:1940-4750` family). **Unexposed = 53.** Storefront side (routes/index.ts mounts × spec non-admin ops): 5 auth ops + 1 alias mount unexposed (§4 tail). The batch-1 lane's work is intact and handler-faithful (spot-verified: `/admin/tickets/{id}/status` spec says `SuccessResponse` and the handler returns `res.json({ success: true })` — `backend/src/routes/admin/tickets.ts:324`; A4 §D row 11's "updated ticket row" was plan-shorthand, already corrected in the landed spec).
**Impact:** no generated bindings, no contract-suite rows, drift gate blind on ⅓ of the admin surface — same class A4 B-3 graded P2. **Fix:** §4 batch-2 (20 ops now) + batch-3 families. **Confidence 5.**

### F-2. [P3] Four raw/hand-rolled fetcher families still bypass the generated client — the exact flip plans are §3 (this is the deliverable, not a re-report of A4 B-4)

At HEAD, admin pages with non-generated fetchers: `dashboard.tsx:503` (chart-data raw fetch), `topups.tsx:973/:1075` (two bulk money loops), `referrals.tsx:272/:383` (list + credit), `tickets.tsx` (adminFetchJson family, `:195/:240/:302/:335`), plus the system tab's `fetchAdminJson` factory (`system.tsx:442-455`) and copilot/whatsapp/admins/layout families (batch-3). Zero of A4 §C batch-A's 7 sites regressed (orders/users/products/promotions flipped and held — `orders.tsx`, `users.tsx`, `products.tsx` now ride generated fetchers; verified by import surface).
**Fix:** §3 plans. **Confidence 5.**

### F-3. [P3] tickets.tsx error toasts would leak the English HTTP prefix under a naive generated-client flip — directive folded into plan §3.4

Current: `adminFetchJson` throws `Error(getErrorMessage(body))` (pure Arabic, `lib/admin-session.ts:238-240`), and the catches toast `err.message` raw (`tickets.tsx:249`, `:321`, `:353` — `description: err instanceof Error ? err.message : "…"`). The generated client throws `ApiError` whose `message` is `buildErrorMessage`'s `"HTTP 404 Not Found: التذكرة غير موجودة"` shape (`custom-fetch.ts:220-241` — `"return \`${prefix}: ${message}\`"`). The flip MUST route these through `getErrorMessage(err)` (which strips the `HTTP <n>` prefix and keeps the Arabic suffix, `lib/errors.ts:233-236`) or the Arabic-toast discipline regresses on the support queue.
**Fix:** §3.4 step 4. **Confidence 4.**

### F-4. [P3] Chart-days remount freshness: the flip trades "refetch on every remount" for cache-served remounts — bounded by an explicit `staleTime: 30_000` (mirrors the backend's 30 s `cacheWrap`)

Today the raw fetch re-GETs on every dashboard mount/period-flip/refresh-click (`fetchChart` at `dashboard.tsx:475-529` + effect `:531-533`). Under `useQuery`, remounting within `staleTime` serves cache. The backend clamps freshness itself: `stats.ts` wraps chart-data in a 30 s server cache (spec description, `openapi.yaml:4010` — "Cached 30 s per (days, day-bucket)"). Directive: set the chart query's `staleTime: 30_000` so the client never serves data staler than the server's own window; refresh-click semantics are preserved by `invalidateQueries` (marks stale + refetches the active query — single fire).
**Confidence 4.**

### Clean verdicts (checked, no action)

- **Orval config integrity:** `orval.config.ts` still pins `query.version: 5` and `zod.version: 3` with the in-file rationale comments; title transformer intact; mutator path `custom-fetch.ts` resolves. Regen = byte-identical. **Confidence 5.**
- **Contract suite:** 38 `it(` rows at `backend/src/__tests__/openapi-response-contracts.test.ts` (counted); chart-data row present and pinning the zero-filled array (`:600-607`). **Confidence 5.**
- **401 coherence on the flip targets:** `customFetch` fires the registered admin-session handler on every 401 BEFORE throwing `ApiError` (`custom-fetch.ts:614-628`), so the flip's catches only need the alerts.tsx duck-type (`err.status === 401`) to stay quiet — the redirect/toast parity is structural. **Confidence 5.**
- **Batch-1 flips held:** alerts.tsx rides `listAdminAlerts` inside the same `["admin-alerts","inbox"]` key (`alerts.tsx:247-248`), security.tsx rides both generated hooks with params-in-key (`security.tsx:72-92`). **Confidence 5.**

---

## 2. Regen + drift check (task 5) — VERDICT: DRIFT-FREE

Command executed exactly as CI runs it:

```
pnpm --filter @workspace/api-spec run codegen
  = orval --config ./orval.config.ts
  + node -e "…api-zod/src/index.ts rewrite…"
  + pnpm -w run typecheck:libs   (tsc --build)
```

Output: `orval v8.40.0 … Api - Your OpenAPI spec has been converted` for BOTH outputs (api-client-react + zod), `tsc --build` exit 0. **`git status --short` after the run: EMPTY** — the three generated trees (`shared/api-client-react/src/generated/*`, `shared/api-zod/src/generated/*`) reproduce byte-identically from `openapi.yaml` at f53a886. No P1 drift. The CI mirror gate (`ci.yml` regen + `git diff --exit-code`) would pass. **Confidence 5.**

One process note for the implementation lane: the codegen command writes then typechecks; on this sandbox the whole run took <60 s. Batch-2 spec commits should keep the discipline A4 §D prescribed: spec edit + regen output + one contract-suite row per endpoint in the SAME commit family.

---

## 3. The four flip plans (exact, file:line, implementation-lane ready)

### 3.1 dashboard.tsx — chart-data → `useGetAdminChartData` (the R126-L8b deferral, now lifted)

**Why flip now (verdict rationale).** The deferral, verbatim from the R126 worklog (L8b entry, `Work Log` bullet 6):

> "DEFERRED dashboard.tsx chart-data flip (spec + contract row landed; fetcher stays raw): the raw fetch carries R125-I2's abort-guard + stale-check + fake-idle-guard + canSeeMoney zero-bytes gate, and TWO dedicated unmodified test files (dashboard-chart-race, dashboard-chart-scope-gate) pin those exact raw-fetch semantics via global fetch stubs — a flip forces semantic rewrites of both files AND changes freshness semantics (no-cache → RQ staleTime) on the round's highest-traffic page. Risky with no blocking benefit now that the endpoint is spec-exposed + contract-pinned; recommend batch-2 alongside the system-tab observability flips."

Every blocker named is lane-risk, not tree-risk: the spec + contract row + generated hook all exist and are pinned (`openapi.yaml:3998-4041`, contract row `openapi-response-contracts.test.ts:600-607`, hook `api.ts:9907+`); the "two test files rewrite" is a bounded, enumerable change (below); the staleTime semantics are an improvement once bounded to the server's own 30 s cache (F-4). L8b itself scheduled this "batch-2 alongside the system-tab observability flips" — this round. **The deferral should NOT stand a second round.**

**Current machinery to retire (all lines at f53a886):**
- `chartAbortRef` — `dashboard.tsx:473` (`const chartAbortRef = useRef<AbortController | null>(null);`)
- `fetchChart` useCallback — `dashboard.tsx:475-529` (abort at `:498-500`, raw fetch at `:503`, `isAdminUnauthorized` at `:507`, stale-drop `:512`, catch-banner `:517-522`, guarded finally `:523-526`)
- mount effect — `:531-533`; unmount-abort effect — `:536` (`useEffect(() => () => chartAbortRef.current?.abort(), []);`)
- state: `chartData`/`chartLoading`/`chartError` setters (`:396-402`) — the useState declarations can stay as derived values or be replaced (below)
- `handleRefresh`'s `fetchChart(chartDays)` call — `:562`
- the error-banner retry's `onClick={() => fetchChart(chartDays)}` — `:860`

**The replacement (mirrors the sibling stats query at `:418-435` exactly):**

```tsx
const chartQuery = useGetAdminChartData(
  { days: chartDays },
  {
    query: {
      queryKey: getGetAdminChartDataQueryKey({ days: chartDays }),
      // scope gate moves here — mirrors the stats query's :426 gate
      enabled: !!adminToken && canSeeMoney,
      // F-4: never serve data staler than the backend's 30 s cacheWrap
      staleTime: 30_000,
      // keeps the current flip UX: previous series stays + dims while
      // the new period loads (chartLoading && chartData.length === 0
      // still gates the first-load skeleton). security.tsx:87 precedent.
      placeholderData: keepPreviousData,
      // current semantics: a 5xx banners immediately, no retry — the
      // App.tsx default (1 retry on 5xx) would add one hidden request.
      retry: false,
    },
    request: { headers },
  },
);
const chartData = chartQuery.data ?? [];
const chartLoading = chartQuery.isFetching; // covers initial + refetch (dim)
const chartError =
  chartQuery.isError && !isSessionExpiredError(chartQuery.error)
    ? "تعذّر تحميل بيانات الرسوم البيانية — تحقّق من الشبكة ثم أعد المحاولة"
    : null;
```

Add the alerts.tsx `isSessionExpiredError` duck-type helper (copy `alerts.tsx:159-161` verbatim — `(err as { status?: unknown } | null | undefined)?.status === 401`). Imports: add `useGetAdminChartData, getGetAdminChartDataQueryKey` to the existing `@workspace/api-client-react` import (`:18-23`) + `keepPreviousData` from `@tanstack/react-query` (`:17`).

**Guard-by-guard migration table:**

| Guard today (line) | Where it goes under the flip |
|---|---|
| `if (!adminToken) return;` (`:477`) | `enabled: !!adminToken && canSeeMoney` |
| `if (!canSeeMoney) { setChartData([]); … }` (`:491-495`) — zero-bytes scope gate | same `enabled` arm — a disabled query sends no bytes (the stats sibling proves the pattern: `:426`) |
| `chartAbortRef.current?.abort()` (`:498`) — predecessor abort on chip flip | structural: `days` sits in the queryKey; key change swaps queries and RQ aborts the old observer's signal (spec'd in security.tsx's flip comment `:9-12`: "a filter flip swaps queries and the stale response can only land in the OLD key's cache") |
| stale-drop `if (controller.signal.aborted) return;` (`:512`) | structural — a late response writes only its own key's cache |
| fake-idle guard `if (!controller.signal.aborted) setChartLoading(false)` (`:525`) | structural — `isFetching` belongs to the ACTIVE key only |
| 401 → `isAdminUnauthorized(r, url)` quiet return (`:507`) | `customFetch` fires the registered handler then throws ApiError (`custom-fetch.ts:614-628`); `chartError`'s `isSessionExpiredError` suppresses the local banner |
| unmount abort (`:536`) | structural (observer removal cancels) |
| refresh `fetchChart(chartDays)` (`:562`) | `queryClient.invalidateQueries({ queryKey: getGetAdminChartDataQueryKey() })` — base key prefix-matches every days-variant, refetches only the active one (topups `invalidate()` idiom, `topups.tsx:714-718`) |
| banner retry `fetchChart(chartDays)` (`:860`) | `void chartQuery.refetch()` |
| mount effect (`:531-533`) | delete — the enabled query fires on mount |

**Semantic deltas (all improvements, disclose in the commit message):** (a) remount within 30 s serves cache instead of re-GET (bounded by F-4's staleTime = server cache window); (b) flip-back within 30 s serves the cached period instead of re-GET; (c) a 5xx retries 0 times (explicit `retry: false`) — identical to today's immediate banner. The 403-for-scoped-admin case: today the fetch happens then errors; under the flip `enabled` prevents the request entirely (strictly better — closes the R126-R1 P3-3 zombie-403 residue for chart-data specifically).

**The 2 pinning test files — exact required changes:**

1. `frontend/src/pages/admin/__tests__/dashboard-chart-race.test.tsx`
   - Module mock `:43-49`: replace the full-factory `vi.mock("@workspace/api-client-react", () => ({…}))` with the **importActual spread** so the REAL `useGetAdminChartData`/`getGetAdminChartDataQueryKey`/`customFetch` run against the stubbed global fetch (only `useGetAdminStats` + `useListAdminOrders` stay stubbed — the handleRefresh test at `:339-345` already demonstrates the real-hook-over-stubbed-fetch technique):
     ```ts
     vi.mock("@workspace/api-client-react", async (importOriginal) => {
       const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
       return { ...actual, useGetAdminStats: vi.fn(), useListAdminOrders: vi.fn() };
     });
     ```
   - Race test 1 (`:207-266`): unchanged in substance — the deferred `d7`/`d90` fetch stubs still resolve raw Responses; `customFetch` parses them; the assertions (90d data renders, late 7d `5 مستخدمين جدد اليوم` never lands, chips agree) now pin the RQ-structural last-wins. The `waitFor` on `/api/admin/chart-data?days=7` URL match still works (generated URL builder emits exactly that, `api.ts:9838-9851`).
   - Race test 2 (`:268-311`): the aborted-7d-rejection scenario — under the flip the 7d signal aborts on key swap; the assertions (no banner, `.skeleton-shimmer` stays while 90d pending, completes on d90) hold. NOTE: the 7d abort now comes from RQ's cancellation, not the test's manual `d7.reject` — keep the reject call (it resolves the in-flight promise either way) but the comment at `:292-296` needs the RQ reframe.
   - Single-fire test (`:325-367`): `handleRefresh` now invalidates 3 keys (stats + orders + chart) — the assertion `statsFetches` stays 2 (chart invalidation refetches the chart, not stats); add `expect(fetchMock.mock.calls.filter(c => String(c[0]).includes("/api/admin/chart-data")).length).toBe(2)` if the lane wants the chart single-fire pinned too (recommended — it replaces the old double-fire pin).
2. `frontend/src/pages/admin/__tests__/dashboard-chart-scope-gate.test.tsx`
   - Same importActual mock swap (`:32-38`).
   - Test 1 (`:128-136`, finance admin requests the payload): unchanged — real hook + `enabled` true + stubbed fetch asserting the URL.
   - Test 2 (`:138-157`, non-finance NEVER requests): unchanged in substance — `enabled: false` means `fetchMock` never sees a chart-data URL; the DOM assertions (column hides, no «لا توجد بيانات بعد») hold.
   - Test 3 (`:159-165`, honest empty block): unchanged.

**Verification directive:** run `dashboard-chart-race` + `dashboard-chart-scope-gate` + `dashboard-kpi`-family suites + frontend tsc; eslint on dashboard.tsx (expect 0/0 — the `useState` removal kills the `chartLoading`/`chartError` locals).

### 3.2 topups.tsx — bulk loops (#8 `handleBulkAction` + #9 `approveAll`) → generated `approveTopup`/`rejectTopup`

**Current sites:** `topups.tsx:970-1012` (loop body of `handleBulkAction` — raw fetch `:973-980`, `isAdminUnauthorized` `:983-986`, `!r.ok` body-parse `:987-1002`, network catch `:1004-1011`) and `:1072-1113` (loop body of `approveAll` — raw fetch `:1075-1085`, 401-break `:1089-1092`, `!r.ok` throw `:1093-1101`, catch `:1103-1111`).

**The repo idiom to copy is IN THIS FILE** — the single-item mutations already wrap the generated fetchers with per-call idempotency keys: `approveMutation` at `:730-743` (`approveTopup(id, data, { headers: withIdempotencyKey(headers, idempotencyKey) })`) with the explanatory comment at `:720-729` ("We use useMutation directly (not the generated useApproveTopup / useRejectTopup hooks) because the generated hooks fix the variable type to `{id, data}`, which doesn't accommodate the per-call idempotencyKey"). The loops flip to the same fetcher calls, inline.

**Loop-body rewrite (both loops, same shape):**

```tsx
for (const id of ids) {
  try {
    const fetcher = action === "approve" ? approveTopup : rejectTopup;
    await fetcher(id, { admin_note: note.trim() || (action === "approve" ? "تمت الموافقة الجماعية" : "مرفوض جماعياً") },
      { headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()) });
    successCount++;
  } catch (e) {
    // 93-C6 / F-07 (A5 S-3): session expired mid-loop — customFetch has
    // already toasted + redirected; stop the money loop quietly.
    if (isSessionExpiredError(e)) { sessionExpired = true; break; }
    failures.push({ id, reason: getErrorMessage(e) });
  }
}
```

`approveAll` identical but `approveTopup` only, `t.id` in the failures row, and `setApproveAllProgress({ done: index + 1, … })` stays after the try/catch (`:1112`).

**What MUST survive verbatim (the money-safety contract):**
1. **Per-iteration `generateIdempotencyKey()`** — the F-008 rationale at `:964-969` ("one Idempotency-Key per topup, NOT one for the whole bulk … Each topup is its own logical action — generate a fresh key per iteration"). The generated fetcher threads `options.headers` through `customFetch` (`api.ts:6135-6160` — `getHeaders(options?.headers)` merge), so `withIdempotencyKey(jsonHeaders, key)` rides exactly as in the single-item mutations.
2. **Mid-loop 401 break** (`:983-986` / `:1089-1092`) — the ApiError duck-type replaces the Response check; `sessionExpired` + `break` + the `if (sessionExpired) return;` before `setSelectedIds`/`invalidate()` (`:1014-1016`, `:1114`) and the `finally` flag resets (`:1039-1044`, `:1134-1141`) stay byte-identical.
3. **Error-shape flip Response→ApiError:** the `!r.ok` hand-parse (`:987-1002`) and the network catch (`:1004-1011`) COLLAPSE into one catch — `getErrorMessage` already speaks ApiError fluently (`errors.ts:180` `err.data?.error` Arabic-first, `:195` `err.data?.code` map, `:233-236` HTTP-prefix strip for message-only errors). The R126-L3 Arabic-reason routing (comments at `:994-999`, `:1104-1106`) is preserved by construction — `getErrorMessage(ApiError)` returns the same Arabic strings the hand-rolled branches produced.
4. **Toast summaries byte-identical** (`:1017-1038`, `:1116-1133`) — untouched; only the loop bodies change.
5. **The re-click guards** (`isBulkProcessing`, `isApproveAllBusy` — `:948`, `:1059`) — untouched.

**Test-file changes (both already mock the module boundary — minimal deltas):**
- `topups-approve-all.test.tsx`: mock factory already stubs `approveTopup: vi.fn()` (`:38`); the assertions move from `fetchMock` call counts (`:175`, `:195`, `:206`) to `approveTopup` call counts (same numbers — one call per pending row) + the mocked fetcher must `mockResolvedValue({ success: true })`. The `resLike` stub for the LIST query (customFetch) stays. The busy-guard and progress assertions are fetch-agnostic (DOM-level) — untouched.
- `topups-bulk-note.test.tsx`: the two body-pinning tests (`:110-142`) move from parsing `fetchMock.mock.calls[i][1].body` to asserting `approveTopup.toHaveBeenCalledWith(id, { admin_note: "مطابقة كشف حسابات المساء" }, expect.objectContaining({ headers: expect.anything() }))` — and SHOULD additionally assert the per-call Idempotency-Key distinctness (parse `mock.calls` headers, expect 2 distinct keys for 2 rows — this upgrades the F-008 pin from comment-level to test-level, closing A4 B-13's missing bulk pin).
- `topups-approve-confirm.test.tsx` / `topups-status-tab-query.test.tsx`: no changes expected (single-item + list surfaces untouched) — rerun to confirm.

### 3.3 referrals.tsx — list + credit → `useListAdminReferrals` + `creditReferral`

**The security.tsx R126-L8b template applies 1:1** — referrals has the same pre-flip shape security had (manual state + seq guard + debounce + AbortController): seq guard `referrals.tsx:251-260` (`fetchSeqRef`), `fetchData` `:262-316` (raw fetch `:272-277`, 401 guard `:284`, `!ok` branch `:285-296`, seq-drop `:287`/`:301`, network catch `:304-310`), debounce effect `:343-360` (300 ms + controller.abort), mount double-fetch guard `:342`/`searchEffectFirstRunRef`, `fetchDataRef` `:323-326`, credit POST `:368-429` (raw fetch `:383-393` with `withIdempotencyKey(headers, generateIdempotencyKey())`, `isAdminUnauthorized` `:396`, envelope parse `:397-408`, post-credit `fetchDataRef.current(true)` `:417`).

**Replacement (list):**

```tsx
const referralsParams = {
  status: (statusFilter || undefined) as ListAdminReferralsStatus | undefined,
  search: search.trim() || undefined,
};
const listQuery = useListAdminReferrals(referralsParams, {
  query: {
    queryKey: getListAdminReferralsQueryKey(referralsParams),
    enabled: !!adminToken,
    placeholderData: keepPreviousData, // old rows stay while the new filter loads (security.tsx:87 precedent)
  },
  request: { headers },
});
const data = listQuery.data ?? null;
const loading = listQuery.isPending; // first-load skeleton only (matches `!silent` setLoading)
const loadError = listQuery.isError && !isSessionExpiredError(listQuery.error)
  ? getErrorMessage(listQuery.error) : null;
```

The generated `AdminReferralsResponse` is field-identical to the hand-rolled `ReferralData` (`referrals.tsx:56-60` vs `api.schemas.ts:1973-1978` — same snake_case `stats`/`top_referrers`/`list`; row fields identical) — the local interfaces can be deleted or aliased. **Deaths:** `fetchSeqRef`, `fetchData`, `fetchDataRef`, both effects (`:328-334`, `:343-360`), the mount guard ref — params-in-key gives last-request-wins structurally (security flip comment `:9-14`: "the params sit in the queryKey, so a filter flip swaps queries and the stale response can only land in the OLD key's cache"). The 300 ms debounce stays (`search` → `debouncedSearch` already exists at `:591-596` — feed `debouncedSearch` into `referralsParams`).

**Replacement (credit, inside `handleCredit`):**

```tsx
try {
  const result = await creditReferral(row.id, {
    headers: withIdempotencyKey(headers, generateIdempotencyKey()),
  });
  toast({ title: "تم منح النقاط", description: `تم قيد ${result.points_credited} نقطة للمُحيل`, variant: "success" });
  void queryClient.invalidateQueries({ queryKey: getListAdminReferralsQueryKey() }); // replaces fetchDataRef.current(true)
} catch (err) {
  if (isSessionExpiredError(err)) return; // was: isAdminUnauthorized — same quiet-exit
  toast({ title: "خطأ", description: getErrorMessage(err), variant: "destructive" });
} finally { setCrediting(null); }
```

`creditReferral(id, options)` sends POST with no body (`api.ts:6794-6800`) — byte-compatible with today's body-less POST; the idempotency header rides `options.headers`; `CreditReferral200 = { success: boolean; points_credited: number }` (`api.schemas.ts:2741-2745`) replaces the hand parse (`:397-401`). **Survives verbatim:** the money-confirm dialog (`:374-379`), the `canCredit` finance-scope disable (`:447` + `:208`).

**Test-file changes (4 files, all stub the global fetch):**
- `referrals-search-race.test.tsx` (pins R98-02): both tests keep their deferred-fetch stubs; the mock gains the real `useListAdminReferrals` via the importActual spread (§3.1 pattern); test 1's "older response never overwrites" becomes the structural pin (old key's cache vs rendered key); test 2's AbortSignal assertion still holds — RQ threads `signal` into `customFetch` → `fetch(input, { signal })`, so `fetchMock.mock.calls[0][1].signal` is still assertable.
- `referrals-error-state.test.tsx`: fetch-stub shape unchanged (customFetch consumes the same stubbed Responses); the error card assertions hold via `loadError`'s `isError` path; one case updates — the 401-envelope case (if present) expects the quiet-suppression path.
- `referrals-401-redirect.test.tsx`: both cases reframe from "`isAdminUnauthorized` claims it" to "the query errors silently while the global handler redirects" — customFetch invokes the registered handler (via the real `useAdminHeaders`) then throws ApiError; assert no local error card renders (same DOM outcome as today).
- `referrals-finance-gate.test.tsx`: fetch-agnostic (button-disabled assertions) — only the mock surface changes; the "disabled-gate click fires NO request" case gains strength (a disabled `creditReferral` mock asserting zero calls).

### 3.4 tickets.tsx — `adminFetchJson` family → generated fetchers (smallest flip)

**Current sites:** list queryFn `tickets.tsx:192-200` (`adminFetchJson<unknown>(ticketsUrl(pageParam, statusFilter), { headers, signal })` + `Array.isArray` guard), `openTicket` `:238-253` (`adminFetchJson<TicketDetail>` + `AdminSessionExpiredError` quiet-catch `:246`), `handleReply` `:297-327` (POST `:302-306` + quiet-catch `:318`), `handleStatus` `:329-359` (PATCH `:335-339` + quiet-catch `:350`).

**Replacements:**
1. **List** — inside the existing `useInfiniteQuery` (KEEP the hand key `["/api/admin/tickets", "load-more", listParams]` at `:191` verbatim — the socket handler (`SocketInitializer`) and this page's `refetch()`/stats co-invalidation ride the `"/api/admin/tickets"` prefix; the alerts flip kept its hand `ALERTS_LIST_KEY` the same way):
   ```tsx
   queryFn: ({ pageParam, signal }) =>
     listAdminTickets(
       { page: pageParam as number, limit: TICKETS_PAGE_SIZE, status: statusFilter || undefined },
       { signal, headers },
     ),
   ```
   The `Array.isArray` guard (`:199`) retires — the contract suite pins the array shape (`openapi-response-contracts.test.ts`, batch-1 row 8); the generated return type IS `AdminTicketSummary[]`.
2. **openTicket** — `const d = await getAdminTicket(id, { headers });` — `AdminTicketThread` is field-superset-compatible with the local `TicketDetail` (`:111-113` — same identity fields + `replies`); keep the local interface or alias it.
3. **handleReply** — `await replyAdminTicket(selected.id, { message: replyText }, { headers });` (the fetcher sets `Content-Type: application/json` itself, `api.ts:9378-9404` — drop the manual header merge at `:304`).
4. **handleStatus** — `await updateAdminTicketStatus(id, { status: status as AdminTicketStatusBodyStatus }, { headers });` — the FE only ever sends the three filter values (`STATUS_FILTERS`/`TICKET_STATUSES`, `:62-64`), so the enum cast is total; import the type from the package.
5. **All three catches:** replace `err instanceof AdminSessionExpiredError` with the `isSessionExpiredError` duck-type (alerts.tsx:159-161 helper — add it module-local), AND replace the raw `err.message` toasts (`:249`, `:321`, `:353`) with `getErrorMessage(err)` — F-3: ApiError messages carry the English `HTTP <status>` prefix (`custom-fetch.ts:235-237`) that `getErrorMessage` strips (`errors.ts:233-236`). The stats co-invalidation lines (`:313`, `:344`) and `refetch()` calls stay verbatim.

**Test-file changes:** `tickets-error-state.test.tsx` + `tickets-category-partial-empty.test.tsx` — add the importActual module mock (§3.1 pattern; stub only what the page consumes beyond the flip — nothing after this flip, so the FULL actual module can run: `vi.mock` can be deleted entirely IF the real module's other exports don't fight the stubbed fetch — they don't, everything rides customFetch → global fetch). Assertions unchanged: error-card-on-failed-load, retry-recovers, category partial-empty windows — all DOM-level. `stats-co-invalidation.test.tsx` (tickets describe) — rerun; the invalidation lines are untouched.

---

## 4. Batch-2 exposure list (task 4) — 53 unexposed admin + 6 storefront, prioritized 20-op shortlist

**Derivation:** 105 route defs (admin/ ×94 + copilot ×9 + auth-settings-admin ×2) − 52 spec ops = 53. Full inventory by family (each verified against its mount in `backend/src/routes/admin/index.ts` + `routes/index.ts:59`):

| Family | Unexposed ops |
|---|---|
| admin auth lifecycle (`auth.ts`) | 8: `login/verify-2fa` (deliberately undocumented — anti-enumeration, A4 §C row 18), `probe`, `session`, `logout`, `change-password`, `profile`, `2fa/setup`, `2fa/verify-setup` |
| risk (`risk.ts`) | 10: `dashboard`, `events`, `events/{id}`, `events/{id}/label`, `events/bulk-label`, `rules`, `rules/{id}` PUT, `config` GET+PUT, `synth` |
| diagnostics (`diagnostics.ts`) | 9: root `/`, `sentry-debug`, `whatsapp/sessions` ×6, `telegram-test` |
| observability | 6: `summary`, `alerts/recent`, `deploys/recent`, `sentry/summary`, `metrics`, `scheduler` |
| admins (`admins.ts`) | 6: list, create, patch, disable, enable, scopes |
| products inventory | 3: `products/{id}/inventory` GET, `inventory/set-count` POST, `inventory` POST (upload) |
| enrichment | 3: `list`, `{id}/publish`, `{id}/reject` |
| forecast | 2: `at-risk`, `products/{id}` |
| copilot settings | 2: GET + PATCH `/copilot/settings` |
| alerts | 2: `test` POST, `new` GET |
| security | 1: `auth-stats` (full, non-summary) |
| settings/auth | 1: PATCH `/admin/settings/auth/{id}` |
| **Total** | **53** |

**Storefront-critical unexposed (6):** `POST /auth/logout-all-devices` (`auth.ts:107`, consumer `SessionManager.tsx`), `GET /auth/providers/linked` (`:186`, `profile.tsx`), `POST /auth/providers/unlink` (`:222`, `profile.tsx`), `POST /auth/onboarding/complete` (`:825`, `onboarding.tsx`), `DELETE /auth/sessions/{id}` (`:857`, `SessionManager.tsx`), + the `GET /api/products/stats` mount (`products.ts:587`) which is the same handler as the spec'd `/catalog/stats` alias (spec-gap cosmetic — document or alias, no consumer gap).

### Batch-2 shortlist — 20 rows, priority = poll frequency × consumer breadth (every handler read)

| # | Op | Consumer + cadence | Handler-faithful response shape (source) | Effort |
|---|---|---|---|---|
| 1 | GET `/admin/observability/metrics` | system.tsx:541 — **15 s poll** (highest-frequency admin endpoint) | LKG envelope `{value: MetricsSnapshot\|null, lastKnownGoodAt: string\|null, stale: boolean}` (CachedValue, `observability.ts:40-67`, cache 10 s `:77`); snapshot schema at `lib/metrics-snapshot.ts`; 500 `{error:"metrics_snapshot_failed", message}` (`:178-181`) | S/M |
| 2 | GET `/admin/observability/summary` | system.tsx:500 — 60 s | `{server{version,uptimeSec,nodeVersion}, redis{available}, worker{heartbeat{ageSec,ts}\|null}, alerts{lastKnownGoodAt,stale,recentCount}, dashboards{render,sentry,neon}}` (`:99-117`) | S |
| 3 | GET `/admin/diagnostics` | system.tsx:489 — 60 s | `{node{version,platform,arch,pid}, runtime{uptimeSec,version,env,service}, memory{rssMb,heapUsedMb,heapTotalMb,externalMb}, cpu{userMs,systemMs}, eventLoop{meanMs,p50Ms,p95Ms,p99Ms,maxMs}\|null, deps{redis{connected},socket{initialized}}, flags{…4 env strings}}` (`diagnostics.ts:172-206`) | S |
| 4 | GET `/admin/observability/scheduler` | system.tsx:558 — 90 s | `{mode, active, isLeader, instanceId, reason, startedAt, heartbeat{ageSec,ts,healthy,expected, note?}, description}` (Arabic description string, `observability.ts:242-264`) | S |
| 5 | GET `/admin/observability/alerts/recent` | system.tsx:515 — 90 s | `{alerts: AdminAlert[], lastKnownGoodAt, stale}` (`:120-127`; cache 60 s `:70`) | S |
| 6 | GET `/admin/alerts/new?since=` | **layout.tsx:1055 — every admin page**, 5-min fallback + socket-triggered immediate poll | `{alerts: full admin_alerts rows[]}` — `{id, type, title, message, isRead, dedupeKey, createdAt}` (drizzle select(), `alerts.ts:105-111`; consumer reads `{id,type,message}` only) | S |
| 7 | GET `/admin/risk/dashboard?hours=` | risk.tsx:112 — 30 s poll while risk page open | `{window_hours, total, by_level{low,medium,high,critical}, unresolved, top_rules[{rule,count}]≤5, pipeline{enabled}}`; hours clamp 1-720 (`risk.ts:733-800`) | S |
| 8 | GET `/admin/risk/events` | risk.tsx:151/:178 — queue + load-more (cursor infinite) | `{events[{id,user_id,user_phone,user_email,event_type,score,level,confidence,rule_fired,action_taken,ip_address,created_at,shown_at}], next_cursor}`; params: limit 1-200 (def 50), level enum, **eventType (camelCase query)**, userId, from/to ISO, opaque cursor `"<iso>:<id>"` (`risk.ts:117-216`) | S/M |
| 9 | GET `/admin/risk/events/{id}` | risk-event.tsx detail | `{event{…list fields + statistical_signals, ml_score, top_features, user_agent}, labels[{id,label,labeled_by,labeled_by_username,labeled_at,notes}]}`; stamps `shown_at` on first open (side effect — document); 400/404 (`risk.ts:222-293`) | S/M |
| 10 | POST `/admin/risk/events/{id}/label` | risk-event.tsx:100-125 | `{id, success:true}`; body zod `{label?: string, notes?: string}` + value check vs `{confirmed_fraud, false_positive, escalated}` (notes ≤1000); 400/404; emits `admin-stats-update{type:"risk-label"}` + audit row (`risk.ts:298-362`) | S |
| 11 | GET `/admin/forecast/at-risk?limit=` | StockoutRiskPanel:127 — 5-min poll on products page | `{pipeline_state, last_successful_run_at\|null, data_freshness_hours\|null, rows[{product_id,product_name,product_image_url,product_slug,category,current_stock_on_hand,avg_daily_sales,predicted_demand_7d,predicted_demand_30d,predicted_runout_at,recommended_reorder_qty,confidence,forecast_date,panel_url}]}`; limit 1-50 (`forecast.ts:53-94`) | S/M |
| 12 | GET `/admin/forecast/products/{id}` | StockoutRiskPanel:209 — on-demand detail | `{pipeline_state, forecast{…row fields + explanation{avg_daily_sales,dow_blend_7d,days_of_history_available,run_completed_at}}\|null}`; 400 on bad id (`forecast.ts:96-137`) | S |
| 13 | GET `/admin/enrichment/list` | enrichment.tsx:107 — cursor infinite | `{drafts[{id,product_id,product_name,product_image_url,field_name,state,generated_text,final_text,model_id,input_tokens,output_tokens,created_at,published_at,rejected_at,panel_url}], next_cursor, pending_count\|null}`; params: state enum `drafted\|published\|rejected\|draft_invalid` (400 otherwise), limit 1-50 (def 25), cursor (`enrichment.ts:73-97`) | S/M |
| 14 | POST `/admin/enrichment/{id}/publish` | enrichment.tsx:243 | `{success, product_id, field}`; body `{final_text?}` ≤16 000 chars (400 over); 404 not_found / 409 wrong_state (Arabic, carries current state) / 500 (`enrichment.ts:99-155`) | S |
| 15 | POST `/admin/enrichment/{id}/reject` | enrichment.tsx:257 | `{success}`; body `{reason?}` ≤500; same 404/409/500 shape (`enrichment.ts:157-195`) | S |
| 16 | GET `/admin/copilot/settings` | CopilotPanel:482 — once per admin page mount | `{phase1_enabled, phase2_enabled, phase3_enabled, phase3_high_risk_enabled}` (CopilotPhaseFlags, `services/copilot/phase-flags.ts:20-25`); GET readable by any admin; `?debug=1` variant is super-admin-only — spec the BASE shape, leave debug out | S |
| 17 | GET `/admin/admins` | admins.tsx:87 — page load | `AdminRow[]` `{id, username, display_name, role, permissions[], is_active, totp_enabled, created_at}` (id asc) (`admins.ts:71-98`) | S |
| 18 | GET `/admin/admins/scopes` | admins.tsx:88/:130 | `{scopes: [{id, label}]}` — 7 fixed scopes with Arabic labels (`admins.ts:446-450`) | S |
| 19 | POST `/admin/admins` + PATCH `/admin/admins/{id}` | admins.tsx:404/:568 — create/edit flows | POST 201 = the same AdminRow shape (`admins.ts:190-198`); 409 ALREADY_EXISTS on username dup (`:200-206`); PATCH 200 = AdminRow (`:326-333`); both 400 on invalid perms/name; PATCH self-edit = 400 (`:228-232`); subset-grant 403 (`:151-160`) | S/M |
| 20 | POST `/admin/admins/{id}/disable` + `/{id}/enable` | admins.tsx:165 — toggle actions | both `{id, is_active}` (`admins.ts:392`, `:438`); 400 self-disable; enable requires actor to hold every target scope (403, `:395-410`) | S |

**Batch-3 (deferred, with reasons):** admin auth lifecycle ×8 (`/session`, `/logout`, `/change-password`, `/profile`, `2fa` ×2 have settings-page consumers — natural family with the settings splits; `verify-2fa` + `probe` stay deliberately undocumented per A4 §C rows 17-18); settings/auth PATCH ×1 (dynamic per-provider zod builder, `auth-settings.ts:582-640` — needs oneOf composition, A4 §D already scoped it M); whatsapp ×6 + telegram-test + sentry-debug (diagnostics utilities — OpenWA standing order + test-only surfaces); observability `deploys/recent` + `sentry/summary` (honest placeholders, `observability.ts:129-159` — low value); `auth-stats` full (no consumer — security.tsx uses the spec'd summary); risk `rules`/`config`/`synth`/`bulk-label` ×5 (no frontend consumer); copilot settings PATCH (super-admin surface, no current consumer beyond GET); products inventory ×3 (upload-family, deserves its own spec pass). **Storefront ×5 auth ops:** batch-2-adjacent — same commit family as the admin auth lifecycle (SessionManager/profile consumers), ~S each.

**Priority rationale (verifiable cadences):** metrics 15 s > risk dashboard 30 s > diagnostics/summary 60 s > scheduler/alerts-recent 90 s > alerts/new 5-min-per-page > forecast 5-min > enrichment/admins/copilot-settings on-demand. Every cadence quoted from the consumer file:line above.

---

## 5. Priority counts + fix order

**P0: 0 · P1: 0 · P2: 1 (F-1, the exposure gap — remediation sequenced) · P3: 3 (F-2 flips, F-3 toast-prefix trap, F-4 staleTime bound).**

1. **§3.1 dashboard flip** — M; the highest-risk of the four (2 test rewrites + freshness semantics); land alone with its 2 test files + targeted suites green.
2. **§3.2 topups loops** — M; money path — land with the F-008 idempotency-distinctness assertion ADDED (upgrades A4 B-13's missing pin).
3. **§3.3 referrals** — M; kills the page's entire manual state machine; 4 test files rework.
4. **§3.4 tickets** — S/M; smallest; F-3's `getErrorMessage` routing is mandatory.
5. **§4 batch-2 rows 1-6** (system tab + layout alerts) — the highest-poll unexposed surface; one spec family + regen + 6 contract rows + system.tsx/layout.tsx fetcher flips in the same family.
6. **§4 rows 7-20** — risk/forecast/enrichment/copilot/admins families.
7. Batch-3 families as scoped.

**Verdict: SHIP-WORTHY tree; the contract debt is fully inventoried, prioritized, and implementation-ready.** No drift, no spec lies, no money-safety regressions in the flip targets; every guard that must survive each flip is named with its line.
