# R125-A2 — Admin Catalog/Pricing Deep Audit

**Scope:** `frontend/src/pages/admin/{products,pricing,promotions,coupons,enrichment,referrals}.tsx` (5,224 lines) + their `__tests__` suites (8 files, 2,102 lines) + the shared components they ride: `components/admin/{TableSkeleton,EmptyState,InventoryUploadDialog,ProductVariantsDialog,forecast/StockoutRiskPanel}.tsx` + `components/ui/{switch,fetch-error-card,app-dialog,status-badge}` usage. **enrichment, pricing, and referrals receive their FIRST full audit** (R124-A6's deep set covered them only partially); products/promotions/coupons are a re-audit of held fixes + new depth.

**Method:** full read of all six pages and all five shared components at main @ 09857fc (clean tree); backend contract verification for every pagination/RBAC/money claim (`routes/admin/{products,referrals,enrichment,pricing-config,flash-sales,product-variants}.ts`, `routes/coupons.ts`); generated-type verification (`shared/api-client-react/src/generated/api.schemas.ts`); cross-page greps for the chrome/taxonomy/pluralization divergences; rubrics: impeccable `audit.md` + `craft-floor.md` + `clarify.md`. Static only — production NOT touched. Per standing order, InventoryUploadDialog is **display-layer audit only** (no restock-logic changes proposed).

---

## A. R124 fixes verified HELD (with evidence)

| Fix (R124-A6 → I5/C2) | Verdict | Evidence at HEAD 09857fc |
|---|---|---|
| **F3 product-editor labels** (9 fields) | **HELD** | products.tsx:1131-1370 — all 10 pairs (incl. `is_active` :1363/1368) have real `htmlFor`↔`id`; promotions.tsx:327-379 (3 pairs); coupons.tsx:400-529 (6 pairs, r103-era IDs) |
| **F1 toast success variant** | **HELD** | products.tsx:650/671/688/176 + bulk :884-886; promotions.tsx:182/235/261; coupons.tsx:234/297; referrals.tsx:377-381 — all `variant:"success"`. **Emoji removed** from the promotions toast (:182 «تم إنشاء العرض», no ✅) |
| **F4 keystroke memoization** (users/products/referrals) | **HELD** | products.tsx:266-491 module-level `React.memo(ProductCard)` + 7 useCallback-stable handlers (:715-800) + `useMemo` filtered/lowStockCount (:808-816); referrals.tsx:126-209 `React.memo(ReferralRowItem)` + `handleCredit` useCallback (:333) + `list` useMemo (:401) |
| **F4 residual poll cost** (known-open #4) | **Bounded** | 60s `refetchInterval` (products.tsx:621, `refetchIntervalInBackground:false` :622) now costs a page-level render + ~200 memo-prop comparisons twice a minute; react-query structural sharing keeps unchanged row identities so only changed cards re-render. Residual is negligible — no further action needed |
| **F10 aria-pressed** (products selection + chips) | **HELD** | products.tsx:301 (row selector), :1443 (category chips) |
| **F16 nav group rename** | **HELD** | layout.tsx:104 «الكتالوج والعملاء» (was «الكتالوج») |
| **F2 status vocabulary** (orders/topups) | HELD (adjacent) | orders.tsx:82/97 derive from `statusLabel` — but referrals was never in that fix and still diverges (Finding 8) |
| **14a topups search** (outside deep set, presence check) | HELD | topups.tsx:991-992 `type="search"` + placeholder |
| Honest caps (A6#7 family) | HELD | products.tsx:1008-1013 (cap → «عرض N (الأحدث أولاً)») + partial-data hint :1472-1477; coupons.tsx:347 (200-cap wording). **referrals has NO cap hint and the backend caps at 200 — new Finding 5** |
| Money-action baseline (confirm + idempotency + double-submit) | HELD | referrals credit: confirm :339-344 + Idempotency-Key :357 + per-row busy :192; pricing recompute: dry-run :433-463 + destructive confirm w/ counts :486-503 + disabled-while-pending :769/:782; coupons TZ roundtrip + parity guards :198-226 (pinned by coupons-tz-roundtrip.test.tsx) |
| RBAC honesty (nav scope = enforced permission) | HELD | coupons nav `scope:"finance"` (layout.tsx:121) matches backend `requirePermission("finance")` (coupons.ts:412); pricing nav `inventory` (:113) is a superset of the backend's requireAdmin-only (pricing-config.ts:31) — no offered-then-403 on any in-scope page |

The console's catalog/pricing lane is unusually disciplined: every mutation confirms where money moves, every list distinguishes error/empty, tests pin the behaviors (pricing-console 568 lines pin the no-frozen-constant rule, dry-run zero-write, cap bounds).

---

## B. Findings

### 1. [P2] Enrichment review hides drafts 26+ — `next_cursor` fetched but never used, while the header promises the true pending count
**Evidence:** enrichment.tsx:87 requests `?state=drafted&limit=25`; the response carries `next_cursor` (:69, typed) and `pending_count` (:70) — the header renders «بانتظار المراجرة: N» (:106-114) but `next_cursor` appears nowhere in the file; there is no load-more, no «عرض 25 من N» hint, nothing. Backend cursor contract confirmed at routes/admin/enrichment.ts:74-95.
**Why:** with 40 pending drafts the page shows 25 cards while the header says 40 — the exact false-window class the console killed on products/coupons (A6#7); the operator cannot review (or publish/reject) the invisible 15.
**Fix:** load-more button appending `&cursor=` pages (the orders.tsx `fetchNextPage` idiom), or minimally an honest «عرض أول 25 من N» line + count of hidden rows. Effort **M** (load-more) / **S** (hint).

### 2. [P2] Enrichment «تعديل» path publishes to the live storefront with NO confirm — the unedited path confirms
**Evidence:** publishing unedited text goes through `confirmPublish()` (enrichment.tsx:211-219, R123 P3d confirm: «سيتم استبدال … يظهر فوراً للعملاء»); the edit path fires `publish.mutate(edited)` DIRECTLY on the «تطبيق التعديل» button (:293) — no confirm. The two buttons sit adjacent (:290-309); a tap-slip publishes custom text over the product's live description instantly.
**Why:** same operation, same customer-visible consequence, opposite guard — the edit path is the more consequential one (operator-authored text) and it's the unguarded one.
**Fix:** route both through the same confirm (the description already names the field + product). Effort **S**.

### 3. [P2] Product editor shows EMPTY SEO fields when an override exists — the operator can clear an override they never saw
**Evidence:** products.tsx:766-767 seeds `seo_title:""`/`seo_description:""` with the comment "the admin list payload doesn't carry the current values" — verified: routes/admin/products.ts:176-193 (list projection) omits both fields; the generated `AdminProduct` (api.schemas.ts:1216-1244) has neither. The R123-deferred item confirmed. The field hints promise "فارغ يعني العنوان الافتراضي" (:1331, :1356) — for a product WITH an override that's false on its face, and the `seoTouched` machinery (products.tsx:842-843) is the only thing preventing silent data loss.
**Why:** every edit of an already-optimized product shows a misleading blank editor; an operator who types-then-clears nulls an override they were never shown.
**Fix:** add `seo_title`/`seo_description` to the admin list projection (products.ts:190-191 area), update the OpenAPI schema + orval regen, then seed real values in `startEdit` (:766-767) — `seoTouched` stays as belt-and-suspenders but the UI becomes truthful. Effort **M**.

### 4. [P2] ProductVariantsDialog form: 7 money fields with zero programmatically-associated labels — the A6-F3 class survived because this form lives in `components/admin/`, not `pages/`
**Evidence:** ProductVariantsDialog.tsx:409-506 — `اسم الباقة`, `المدة`, `أيام المدة`, `التكلفة بالدولار`, `السعر (د.ل)`, `SKU`, `الترتيب` all render `<Label>` without `htmlFor` over `<Input>` without `id`. The R124-I5 label pass covered products.tsx (9 fields) + promotions.tsx (3) — this dialog, the catalog's second-biggest money form, was outside the pages/ sweep.
**Why:** same a11y gap A6-F3 documented for the product editor (click focuses nothing; screen readers announce bare fields) — on the form that sets every sellable price.
**Fix:** mechanical `htmlFor`↔`id` pairs (7 fields, the products.tsx recipe). Effort **S**.

### 5. [P2] Referrals list is server-capped at 200 with no cap hint — and the stat cards count the FULL table, so the page contradicts itself
**Evidence:** backend routes/admin/referrals.ts:58 `LIMIT 200` on the list query, while the three stat aggregates (:72-79) are full-table. Frontend footer renders bare `{list.length} إحالة` (referrals.tsx:602) — no cap wording, no «عرض N». With 340 total referrals the stat card says «إجمالي الإحالات: 340» while the list shows 200 with no explanation; with >200 PENDING referrals the invisible tail contains referrals the operator cannot see to credit.
**Why:** the exact false-total class A6#7 flagged for products/coupons (both got honest wording in R120-B4) — referrals never did, and the stats/list mismatch makes it visible.
**Fix:** mirror the products idiom — `list.length >= 200 ? «عرض N (الأحدث أولاً)» : …` (products.tsx:1008-1013 recipe); optionally a search hint like products.tsx:1472-1477. Effort **S**.

### 6. [P2] Promotions: permanent delete and reversible pause share the same verb AND the same success toast
**Evidence:** pause = `toggleActive(s,false)` → toast «تم الإيقاف» (promotions.tsx:235). delete = `handleDelete` → confirm «إيقاف العرض السريع؟» + confirmLabel «إيقاف» (:248-252) → toast «تم الإيقاف» (:261). Two different operations (PATCH is_active / DELETE row, destructive:true) are indistinguishable in both the confirm verb and the outcome toast; the row's own PAUSE button is also labeled «إيقاف» (:540).
**Why:** the clarify rubric's destructive-action rule — name the action on both message and button; an operator who meant to pause and permanently deleted (or believes they paused) has no signal otherwise. Store-wide discount history is the money-adjacent surface.
**Fix:** delete copy → title «حذف العرض نهائياً؟», confirmLabel «حذف نهائي», toast «تم حذف العرض»; pause keeps «إيقاف»/«تم الإيقاف». Effort **S**.

### 7. [P3] Referrals leaderboard hardcodes `* 50` points — a frozen money-adjacent constant the codebase explicitly banned
**Evidence:** referrals.tsx:497 `{r.credited_count * 50} نقطة`. Backend derives per-row points from `POINTS_PER_REFERRAL` (routes/admin/referrals.ts:11, :52, :77 — "no more local literals", R115), and pricing-console.test.tsx:403 pins "not a frozen constant" for the referral hint. The leaderboard is the one remaining local literal.
**Why:** if `POINTS_PER_REFERRAL` changes (it's LYD-convertible money, 100:1), the leaderboard lies while the rows stay right.
**Fix (ponytail — deletion beats addition):** drop the derived «نقطة» column (rows already show per-referral points), or have the backend send `credited_points` in `top_referrers`. Effort **S**.

### 8. [P3] Referrals status vocabulary splits on one page — «قيد الانتظار» vs «معلقة» — and its chips lack aria-pressed
**Evidence:** stat card «قيد الانتظار» (referrals.tsx:459) vs STATUS_FILTERS «معلقة» (:65) vs row badge «معلقة» (:164); row pills are hand-rolled raw-hue spans (:159-166), not StatusBadge — the status-unification invariant (status-badge.tsx:64-70) that A6-F2 fixed for orders/topups missed referrals. The filter chips (:517-529) also have no `aria-pressed` (the R124-C2 chip fix covered products only).
**Fix:** derive chip/badge labels from `statusLabel()`, adopt StatusBadge, add `aria-pressed`. Effort **S**.

### 9. [P3] StockoutRiskPanel's primary CTA is an inert deep link — `?highlight=` is consumed by nothing
**Evidence:** StockoutRiskPanel.tsx:343 links `/admin/products?highlight=${row.product_id}`; products.tsx reads only `?search` (:578) — no `highlight` handler exists anywhere (repo-wide grep: only the emitter). The drawer's «فتح في المنتجات» just lands on an unsorted 200-card grid.
**Why:** the panel's whole purpose is act-on-risk; the operator must re-find the product manually. Also the expandable row button (:220-279) has no `aria-expanded`.
**Fix (cheapest true fix):** treat `highlight` as a search prefill (map id→name or pass the name as `?search=`), or scroll+ring the card; add `aria-expanded={open}`. Effort **S/M**.

### 10. [P3] Pricing: unnamed Switch + split money formatting + glyph icons — three small honesty/a11y gaps on the money-semantics page
**Evidence:** (a) «محاكاة مشتري مُحال» Switch (pricing.tsx:1063) has no accessible name — the label text sits in a sibling div; switch.tsx forwards nothing. (b) The product picker renders `formatCurrency` (grouped, :934) while every result/margin/worst-case row uses local `fmt()` = bare `toFixed(2)` (:219-222) — ≥1000-dinar values read "1250.00 د.ل" next to "1,250.00 د.ل" on the same page. (c) The invalid-coupon waterfall row uses the ⚠️ emoji (:1143) and promotions' live preview uses a ⚠ glyph (promotions.tsx:407) — the exact glyph-icon class R124 removed from the promotions toast.
**Fix:** `aria-label` (or `aria-labelledby`) on the Switch; make `fmt` group thousands or use `formatCurrency`; swap glyphs for lucide `AlertTriangle`. Effort **S**.

### 11. [P3] Pricing calculator has no race guard — the class fixed in GlobalSearch/referrals/dashboard
**Evidence:** pricing.tsx:578-584 — the debounced auto-recalc (300ms) and the manual «إعادة الحساب» button share one mutation with no seq/abort; an input change during an in-flight calc fires a second POST and the later-resolving (stale) response wins `setResult` (:540-541). referrals solved this with `fetchSeqRef` (referrals.tsx:244-277); dashboard's chart race was A6#9.
**Why:** margins/worst-case can briefly disagree with the inputs on screen — on the page whose job is trusting the numbers.
**Fix:** latest-wins seq token around `setResult` (the referrals recipe), or ignore onSuccess when inputs changed. Effort **S**.

### 12. [P3] Manual refresh blanks three lists to skeletons — the react-query pages don't
**Evidence:** promotions `load()` sets `loading=true` on every call (:107) → the rendered history is replaced by 3 skeletons (:443-448); coupons `fetchCoupons()` non-silent (:149) → TableSkeleton replaces rows (:539-541); referrals `fetchData()` non-silent (:250) → skeleton (:554). Products keeps its cards on refresh (react-query `isLoading` is initial-load-only; only the error banner is conditional — products.tsx:1499-1518).
**Fix:** make the refresh paths silent (`load(silent=true)` / `fetchCoupons(true)` / `fetchData(true)`) — the argument already exists on all three. Effort **S**.

### 13. [P3] Referrals double-fetches on mount (with a skeleton flash at ~300ms)
**Evidence:** referrals.tsx:304-310 (effect on `[adminToken, statusFilter]`) fires `fetchData()` immediately on mount, AND :312-325 (effect on `[search]`) schedules the same fetch 300ms later — two identical GETs per page entry, with `loading` flipping true again after the first render (rows → skeleton → rows).
**Fix:** skip the debounce effect on first run (a `firstRunRef`), or fold the initial fetch into the debounced effect only. Effort **S**.

### 14. [P3] Products editor: Esc discards dirty work with no check — and Esc leaks through open Radix dialogs
**Evidence:** products.tsx:739 — the window-level Escape handler calls `cancelForm()` unconditionally (form header advertises «Esc للإغلاق» :1106-1109); `cancelForm` resets state with no dirty prompt (:850-855); `useDirtyGuard` is beforeunload-only (use-dirty-guard.ts:15-20, documented residual). Because the listener is on `window`, Esc while the InventoryUploadDialog or ProductVariantsDialog is open over the editor BOTH closes the dialog AND silently discards the editor's typed content (Radix doesn't stop the raw keydown).
**Fix:** confirm-on-dirty inside `cancelForm` (the `useConfirm` idiom), and bail if `document.activeElement`/`composedPath` is inside a `[role=dialog]`. Effort **S/M**.

### 15. [P3] Form-dismissal semantics split three ways across the lane
**Evidence:** coupons preserves a dismissed draft (coupons.tsx:236-240, pinned by coupons-tz-roundtrip.test.tsx:143); products `cancelForm` wipes the form (:850-855); promotions' «إلغاء» wipes it (:419-422). Three answers to the same question on three adjacent pages.
**Fix:** adopt the coupons rule (dismiss preserves; explicit reset only after success), or confirm-on-dirty everywhere (pairs with Finding 14). Effort **S**.

### 16. [P3] Coupons: «حذف» button performs a soft archive — and has no in-flight guard
**Evidence:** the row action is titled/aria'd «حذف» with a Trash2 icon (coupons.tsx:706-711), but DELETE /api/coupons/admin/:id sets `isActive:false` (routes/coupons.ts:420-424, audit `coupon.archive`) — the same end-state as the toggle, and PATCH can resurrect it (:374-377). The confirm honestly says «تعطيل» (:284-289) — the BUTTON is the misleading surface. `handleDelete` also has no busy state: a double-click fires two DELETEs, the second 404s and stacks an error toast on the success toast.
**Fix:** relabel the action «تعطيل نهائي» (icon can stay), add the `toggling`-style per-row busy guard. Effort **S**.

### 17. [P3] Mobile: coupons rows stack six unlabeled cells (referrals partially mitigated by icons)
**Evidence:** coupons.tsx:597 — rows are `flex flex-col md:grid …`; the header row is `hidden md:grid` (:578), so below md each row renders code, value, min-order, usage, expiry, status, actions as bare stacked cells — «5.00 د.ل» twice with no way to tell الحد الأدنى from الخصم. referrals.tsx:136 has the same pattern but its phone/referee cells carry disambiguating icons (:140-154). orders.tsx builds a dedicated MobileOrderCard (:1612-1626) — the better pattern.
**Fix:** add `text-3xs` field labels to the mobile flex-col cells (visible <md only), or extract a mobile card. Effort **S/M**.

### 18. [P3] Loading/error taxonomy: two more bare-spinner members (enrichment, variants dialog) + enrichment error has no retry
**Evidence:** enrichment.tsx:129-131 bare centered «جارٍ التحميل…» and :132-136 a thin error banner with no retry button (only the header's تحديث incidentally retries) — the A6-F5 class (security/admins/whatsapp were flagged; enrichment is the fourth member, first-audit). ProductVariantsDialog.tsx:559-563 uses a centered spinner+text instead of row skeletons (its error banner DOES retry — :564-578, correct).
**Fix:** shared `TableSkeleton` rows for enrichment; skeleton or keep-spinner for variants; FetchErrorCard for the enrichment page error. Effort **S**.

### 19. [P3] Enrichment polish batch: dead `panel_url` field, no dirty guard on the edit textarea, silent publish/reject, 25 ConfirmDialog mounts
**Evidence:** `panel_url` is declared (enrichment.tsx:64) but never rendered — the review-panel link the enrichment run recorded is invisible to the operator; the edit textarea (a long generated text being corrected) has no `useDirtyGuard` while every other long admin form arms one; publish/reject give no success toast (the card just vanishes via invalidate — inconsistent with the console-wide toast idiom); each DraftCard mounts its own `useConfirm` provider (:178) so 25 cards mount 25 dialog trees.
**Fix:** render a `panel_url` link (or drop the field); arm the guard; toast on success; hoist one ConfirmDialog to the page. Effort **S**.

### 20. [P3] Dead casts + duplicated helpers (ponytail)
**Evidence:** `(product as { cost_price?: number | null })` casts at products.tsx:389, :757-760 and pricing.tsx:928 — the generated `AdminProduct` already declares `cost_price?: number | null` (api.schemas.ts:1232); the casts are vestiges of a pre-codegen era. `describeError`/`ARABIC_SCRIPT_RE`/`round2`/`fmtFactor` are byte-identical copies in pricing.tsx:225-243 and ProductVariantsDialog.tsx:61-92; the margin-tone thresholds (<0 red / <10% amber) are duplicated between the card (products.tsx:392-398) and the editor preview (:1194-1199).
**Fix:** delete the casts (pure deletion); extract one `lib/admin-money.ts`. Effort **S**.

### 21. [P3] Promotions polish batch: 30-day rule hinted but not client-validated, English "Flash Sale" default title, no per-row busy, bare plural counts
**Evidence:** the hint promises «أقل من 30 يوماً» (promotions.tsx:380-382) but `handleCreate` only validates the 5-minute floor (:143-147) — a 60-day sale rides a round-trip to the server 400; an empty title silently becomes the English "Flash Sale" (:159) which surfaces to the Arabic storefront; `toggleActive`/`handleDelete` have no in-flight guards (idempotent PATCH, but the delete can double-404-toast); counts are `{n} عرض/عروض` (:439) and products' footer/low-stock lines (`{filtered.length} منتج` products.tsx:1465, «نفد مخزون {n} منتج» :1022) skip the `formatCount` plural forms both files use elsewhere.
**Fix:** one-liners; validate the 30-day bound client-side; default title → «عرض سريع» or require the field. Effort **S**.

### 22. [P3] Column sorting (known-open #6, scoped assessment): none of the six pages exposes any sort
**Assessment:** the sorts that matter on THIS lane, in order: **coupons by expiry (soonest first)** — an operator must catch a coupon about to outlive its intended window (the TZ-roundtrip history makes expiry the live risk); **products by stock ascending** — low-stock triage (partially served by StockoutRiskPanel, which is forecast-gated and top-10 only); referrals by date (already newest-first — no action). Pricing/promotions/enrichment don't need it (single-object/short lists). Recommend implementing the coupons expiry sort first (client-side over the ≤200 loaded rows, the users.tsx «ضمن المعروض» honest-scope recipe). Effort **M**.

### Known-open items — disposition
- **#1 create/edit split:** unchanged. Coupons = AppDialog (:366); products = inline, justified (#new hash :555-572 + ⌘S/Esc :730-743 + layout CONTEXT_ACTIONS); **promotions remains the unjustified outlier** (inline form :314-432, no hash, no shortcuts, dismissal differs from both). Recommendation: migrate promotions to AppDialog (M) — it is one row of fields and sits beside coupons in the nav, where the operator currently meets two creation idioms; or accept + document the rule next to AppDialog.
- **#2 search chrome:** still three idioms — native `type="search"` (users:775, topups:991), hand-rolled ✕ (products:1422-1433, orders:1056, topups:1001 — topups renders BOTH), none (referrals:509-514). The `<AdminSearchInput/>` extraction from A6#6 remains the right fix; referrals also lacks `dir="ltr"` for its phone search (users:780 has it).
- **#3 pagination honesty:** products/coupons held; **referrals is the gap** (Finding 5); enrichment is worse (Finding 1).
- **#4 poll cost:** verified bounded (Section A).
- **#5 SEO editor:** located (products.tsx:1313-1358), confirmed blind (Finding 3), fix sketched.
- **#6 sorting:** assessed per-page (Finding 22).

---

## C. Priority counts

**P0: 0 · P1: 0 · P2: 6 · P3: 16** (findings 1-6; 7-22, with 19/20/21 as batches).

## D. Suggested fix order (ponytail — deletion beats addition)

1. **Findings 6, 16, 21 (verb collisions + promotions batch)** — one small copy/safety commit: distinct delete verbs, 30-day client check, Arabic default title, busy guards. S.
2. **Finding 4 (variants labels)** — mechanical 7-field sweep, the products.tsx recipe. S.
3. **Findings 5 + 1-hint (honest caps)** — referrals «عرض N» line + enrichment «عرض أول 25 من N»; load-mores later. S.
4. **Finding 2 (enrichment confirm parity)** — route the edit publish through the existing confirm. S.
5. **Findings 12 + 13 + 14 + 15 (dismissal/refresh cluster)** — silent refresh paths, mount double-fetch, Esc dirty-guard + dialog containment, unify dismissal. All S, one theme.
6. **Findings 7 + 20 (deletions)** — drop the `* 50` column and the dead casts; extract admin-money helpers. S.
7. **Findings 8 + 9 + 10 (a11y/copy batch)** — statusLabel + aria-pressed on referrals, highlight deep-link, Switch name, fmt grouping, glyph icons. S each.
8. **Finding 3 (SEO payload)** — the M: backend projection + openapi/orval + seed. Do before the next content push.
9. **Findings 17-19, 22** — mobile labels, taxonomy, enrichment polish, coupons expiry sort. S/M as capacity allows.
