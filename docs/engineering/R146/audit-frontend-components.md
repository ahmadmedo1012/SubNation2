# R146 ponytail audit — frontend components / hooks / lib helpers

Agent: 146-AUD-4 (frontend component/hook/helper layer). Base: `4dca48c` (R145 close).

**What this part does:** the React presentation + state layer of the Arabic RTL
storefront — 339 source files under `frontend/src/components/` (including the
r135–r137 domain extracts), `frontend/src/hooks/`, and `frontend/src/lib/`
(React-free helpers). Pages stay orchestration cores; these modules own every
render, every money-adjacent calculation shown to a buyer (cart, coupons,
topup codes, loyalty conversion), and the durable idempotency-key envelopes.

**Load assumed:** the real public storefront (subnation.ly) with concurrent
desktop AND mobile customers, real money moving (wallet balance → per-unit
order charges → delivered credentials). Judged against that.

Method: mapped the tree (sizes, imports, test map), deep-read the money paths
(cart.tsx, checkout/ extracts, wallet/ extracts, product/ extracts, loyalty,
intent-key modules, transfer-code, utils formatters), all 11 hooks, the
session/socket/session-manager family, Navbar/NotificationBell/TopupWaitingModal/
AuthProviders/WhatsAppPhoneSignIn, and the lib helpers. Ran an export-reference
scan over every export in components/hooks/lib: **zero unreferenced exports**
(dead-component check came back clean). Checked the R143 ledger, R144 ledger and
R145 defect-map — nothing below re-reports a closed item.

No Must-fix findings. The layer is in unusually good shape: every effect I read
cleans up its listeners/timers, the money math is cent-rounded at the source,
list keys are stable ids, inputs are controlled, and the RTL/Arabic handling
(cached `Intl` formatters, `ar-LY-u-nu-latn` pins, Arabic-Indic digit
conversion, plural rules) is centralized instead of per-component. What remains
is duplication debt and two risky-but-untested hooks.

## Should fix

1. **`trapTabKey` exists as four byte-identical copies** (`lib/a11y/trap-tab-key.ts:12`, `components/layout/Navbar.tsx:135`, `components/layout/NotificationBell.tsx:42`, `components/admin/layout/focus-trap.ts:14`)
   - **What this is:** the Tab-cycle focus-trap used by every hand-rolled modal surface (Navbar drawer, bell panel, admin ⌘K palette + mobile drawer, CopilotPanel). The shared React-free helper was extracted in R134 (A3-F2); the other three bodies are the same ~22 lines verbatim.
   - **Problem:** they must change together. A fix to the focusable-element selector (e.g. adding `[contenteditable]` or `[hidden]` handling) has to be applied in four files; a missed one leaves that modal leaking Tab into the page behind it (the exact WCAG 2.1.2 bug each copy was written to fix). The "kept local" comment in Navbar.tsx:126 (`importing the admin layout … would drag the whole admin shell into the eager chunk`) is stale — the shared `lib/a11y/trap-tab-key.ts` is React-free and 34 lines; importing it drags nothing. The helper's own docblock already calls folding the copies "a mechanical pass for a later round".
   - **Fix:** keep `lib/a11y/trap-tab-key.ts` as the one copy; in Navbar, NotificationBell and `admin/layout/focus-trap.ts` import it and delete the local bodies (focus-trap.ts can re-export it for its two consumers). ~66 lines gone; update the source-scan pins that reference the local copies.
   - **If we skip it:** the next focus-trap fix lands in one file and silently misses the other three — an a11y regression no test attributes.

2. **The category registry is hand-rolled in ~10 tables that must change together** (`lib/utils.ts:153` categoryLabel · `components/ProductCard.tsx:75,159` CATEGORY_ACCENT + CATEGORY_ICON · `components/home/CategoryRail.tsx:36` local CATEGORY_ACCENT · `components/product/category-presentation.ts:14,47` CATEGORY_GRADIENTS + CATEGORY_INITIAL_COLOR · `components/admin/products/products-meta.ts:43,59,72` a *second* CATEGORY_INITIAL_COLOR + CATEGORY_OPTIONS + CATEGORY_FILTERS · `components/home/catalog-filters.ts:34` CATEGORIES (same icon map as ProductCard's) · `components/layout/Navbar.tsx:46` DRAWER_CATEGORIES · `pages/category.tsx:62` CATEGORY_THEME)
   - **What this is:** the slug → {Arabic label, lucide icon, accent-class} vocabulary of the storefront, written out per surface.
   - **Problem:** lib/categories.ts documents adding an 8th category as "re-adding an entry here … is all it takes", but in reality ~10 tables must be edited in sync. Missing one produces a mixed surface: e.g. a new slug renders with `DEFAULT_ACCENT` + the `Package` fallback icon on the home rail while ProductCard and the drawer show the proper label — exactly the drift class R134's A2-F1 killed for the storefront chips (the admin tables and the accent maps were never consolidated). Inside products-meta.ts itself, CATEGORY_OPTIONS and CATEGORY_FILTERS are two near-copy label lists differing only in the head entry and the «(مؤرشفة)» suffixes.
   - **Fix:** one registry module (slug → label, icon, accent-token names) that categoryLabel, ProductCard's two maps, catalog-filters' CATEGORIES, Navbar's drawer list and both admin option lists derive from. Keep per-surface density (gradients, theme rows) as thin lookups over the tokens. ~80–120 lines gone and one edit point per new category.
   - **If we skip it:** the next category launch (the documented operator move) ships a half-themed surface somewhere, and the cart-recovery test's 7-slug list is only the first of many places to miss.

3. **The durable intent-key `{k, t, f}` envelope is implemented four times** (`components/checkout/checkout-unit-key.ts:123-176` · `components/product/buy-intent-key.ts:83-118` · `components/wallet/topup-intent-key.ts:53-76` · `components/loyalty/loyalty-convert-key.ts:30-60`)
   - **What this is:** the money-path double-charge guard — load (JSON.parse + k/t/f validation + 10-min TTL + fingerprint match) and persist, over localStorage/sessionStorage. `lib/idempotency.ts:53-78` itself documents all four as "the SAME mint-replay-clear lifecycle; only the storage slot + fingerprint differ".
   - **Problem:** the load/persist bodies are near-copies; only slot name, TTL constant and fingerprint builder differ. They already had to change together once — the r97 F-07 TTL guard was applied four separate times — and the next envelope change (say, a cross-tab invalidation or a TTL policy change) repeats that. Note topup-intent-key.ts has no `clear` (rotation-only, deliberate) — a shared helper must preserve that difference.
   - **Fix:** one `lib/intent-envelope.ts` with `loadIntentKey(storage, slot, ttlMs, fingerprint)` / `persistIntentKey(storage, slot, fingerprint, key)` / `clearIntentKey(storage, slot)`; each module keeps its slot constants and fingerprint builder and re-exports the same names, so the page-level pins (checkout-idempotency-keys, product-buy-intent-key, loyalty-convert-journey, money-races-r140, wallet-decomposition) keep passing unchanged. ~60 lines gone.
   - **If we skip it:** the fifth money flow (or the next TTL-semantics fix) copies the pattern a fifth time, and a bug fixed in one envelope stays live in the other three — on the exact code that stops double charges.

4. **The ApiError duck-type + envelope read is hand-rolled three times in the component layer** (`components/checkout/checkout-errors.ts:31-47` isHttpApiError/apiData · `components/checkout/coupon-quote.ts:129-153` inline (also reads `.status`) · `components/WhatsAppPhoneSignIn.tsx:228-240` apiErrorEnvelope — plus page-level copies at `pages/product.tsx:320,416` and `pages/telegram-callback.tsx:215`)
   - **What this is:** the pattern that decides "did the server definitively answer (HTTP ApiError, parsed `.data` envelope) or is server state unknown (network failure)?" — the distinction the checkout cart-shrink logic and the coupon valid-vs-transient verdict ride on.
   - **Problem:** three copies of the same `err instanceof Error && err.name === "ApiError"` + `.data` cast, each subtly different (coupon-quote also needs `status`; the WhatsApp one returns a wider shape). If customFetch's error class or envelope ever changes shape, every copy must be found in sync — a missed one silently misclassifies a definitive 4xx as a transient failure (the coupon pre-flight would fail open on a real verdict) or vice versa. The R144-C2 migration already touched all of these once, proving the coupling.
   - **Fix:** one exported reader (grow `checkout-errors.ts`'s pair into `readApiError(err): { status?: number; data?: … } | null`, or move it to lib); replace the three component-layer bodies. ~30 lines gone, one classification point.
   - **If we skip it:** the next error-envelope change (they happen — L5-2/R144-C2 both did) lands in some sites and not others, and money-screen error copy/classification diverges between checkout and the PDP again.

5. **`useTelegramWebAppAutoLogin` has zero tests** (`hooks/use-telegram-webapp-auto-login.ts:39-92`)
   - **What this is:** the hook that silently exchanges Telegram Mini App `initData` for a session JWT — an auth/session mint, money-adjacent (an auto-logged-in user can buy immediately).
   - **Problem:** risky branches with no test that fails when they break: skip-when-token-present (login churn if dropped), the StrictMode once-guard `triedRef` (double mint if dropped), the `?ref=` referral threading (attribution lost if broken), and the silent-no-op failure contract. R142's J lane read the file but filed nothing (a11y scope); no suite anywhere renders it (grep over `__tests__` confirms).
   - **Fix:** one test file: mock `window.Telegram.WebApp.initData` + a customFetch stub; assert exactly one POST with the referral code, zero POSTs when a token already exists, and a silent no-op (no toast/throw) on rejection.
   - **If we skip it:** a refactor of the hook can drop the once-guard or the token check and CI stays green — the bug surfaces as duplicated session mints in production Telegram traffic.

6. **`use-socket`'s order-updated and connection_limited legs are untested** (`hooks/use-socket.ts:62-102` and `:166-180`; the only hook test is `hooks/__tests__/use-socket-topup-dedupe.test.tsx`, which pins the topup leg)
   - **What this is:** the page-scoped realtime hook for order-detail/wallet. The order-updated leg runs a predicate sweep over the query cache (`query.queryKey[0]` starts with `/api/orders`) plus the order_code-vs-id toast fallback; connection_limited renders the capped-connection toast.
   - **Problem:** the 93-C5/F-15 fix ("the screen contradicted its own toast until a manual reload") lives in that predicate. If a refactor changes how the orders query keys are built (or someone narrows the predicate to a prefix that misses the detail-page key `[`/api/orders/${orderCode}`]`), invalidation silently stops and the old defect returns with nothing failing. The predicate's shape is documented only in a comment.
   - **Fix:** one test: mount the hook with a fake socket, emit `order-updated`, assert `invalidateQueries` was called with a predicate that accepts the generated `/api/orders*` keys (list + `orderCode` detail) and rejects a non-orders key; assert the toast text uses `order_code` when present.
   - **If we skip it:** the highest-traffic realtime surface (order status flips) regresses invisibly — the toast says "updated" while the page shows the old status.

## Nice to have

7. **Dead duplicate shape check in AuthProviders** (`components/AuthProviders.tsx:285-286`)
   - **What this is:** two consecutive `if (!Array.isArray(...providers)) throw` lines — the second (`Array.isArray(d?.providers)`) can never fire: the first already threw on `!d`, and for truthy `d` the two `Array.isArray` calls are identical. Looks like a merge artifact from the R145-D edit.
   - **Problem:** pure dead code; a reader stops to work out which check does what (neither: one is unreachable).
   - **Fix:** delete line 286.
   - **If we skip it:** one wasted reader-minute per visitor to this file, forever.

8. **`ProductSkeleton` is a pure pass-through wrapper** (`components/home/primitives.tsx:11-13`)
   - **What this is:** `function ProductSkeleton() { return <ProductCardShell />; }` — no props, no classes, no state. One consumer (`components/home/ProductsGrid.tsx:126`); `ProductCardShell` is already exported and used directly by route-skeleton's own shells.
   - **Problem:** a wrapper that only passes calls through — the exact "adds nothing" class the lean ruleset deletes. The sibling `OrderStatusIcon` in the same file is real logic and stays.
   - **Fix:** import `ProductCardShell` in ProductsGrid and delete the alias (3 lines + its comment).
   - **If we skip it:** one more indirection to read on the home-page loading path.

9. **AskAnswer re-implements CopyButton's copied/failed lifecycle with untracked timers** (`components/admin/copilot/AskAnswer.tsx:34-51` vs the canonical `components/CopyButton.tsx:30-52`)
   - **What this is:** the copilot answer's copy affordance — its own `copied`/`copyFailed` state + two bare `setTimeout`s. CopyButton's docblock calls itself "THE copy affordance" and specifically fixed the untracked-timer hygiene (A3 P3-10) that this copy reintroduces.
   - **Problem:** admin-only and low-traffic, so cosmetic — but it is the fourth copy-state machine for the same job, and its timers are neither cleared on re-click nor on unmount (rapid double-click stacks two reset timers).
   - **Fix:** give CopyButton an icon-only rendering (or accept a `children` render shape) and use it here; else at minimum track the timers like CopyButton does. ~15 lines gone.
   - **If we skip it:** the copy UX family keeps drifting — a future fix to CopyButton's failure copy won't reach this surface.

10. **Storefront and admin `EmptyState` are near-copies kept as twins** (`components/EmptyState.tsx:68-101` vs `components/admin/EmptyState.tsx:51-85`)
    - **What this is:** the canonical empty-state card on both sides of the app. Same props, same DOM shape, same role="status"; the only deltas are `py-12` vs `py-16` (the documented admin density dialect), one `mt-1`, and `aria-hidden` on the storefront's icon.
    - **Problem:** they demonstrably change together — R139 tuned both in lockstep ("both sides of the app share ONE empty-state vocabulary"). That said, the split is a recorded decision with separate test pins, so this is a candidate, not a clear win.
    - **Fix:** if the family is ever touched again, fold into one component taking a `density: "storefront" | "admin"` prop (~60 lines gone); otherwise leave the documented twins alone.
    - **If we skip it:** nothing breaks — the cost is only the next lockstep edit being made twice.

11. **`useKeyboardShortcuts` ships five option fields nobody uses** (`hooks/useKeyboardShortcuts.ts:3-11`)
    - **What this is:** a generic shortcut hook whose single caller (`pages/admin/topups.tsx:112`) registers one Escape-only shortcut. `description` is never read anywhere in the repo (grep: zero consumers), and `ctrlKey/shiftKey/altKey/metaKey` are never set by any caller.
    - **Problem:** speculative API surface: the `description` field is dead, and the unspecified-modifier semantics (`ctrlKey: true` still matches ctrl+shift+K, since unspecified modifiers pass) are latent, untested behavior a future caller could trip on.
    - **Fix:** trim the interface to `key` + `handler` (+ `enabled`) until a second consumer needs modifiers; or leave it but drop `description`.
    - **If we skip it:** six lines of dead options and one latent matcher quirk wait for a caller that may never come.

---

**Verdict:** healthy — no must-fix defects in the component/hook/lib layer; spend the next effort on the four duplication clusters (findings 1–4) and the two missing hook tests (5–6), all mechanical and all protected by existing pins.

**Lean:** ≈ −260 lines possible (trapTabKey −66, intent-key envelope −60, category registry −80–120, ApiError reader −30, micro-items −25; ≈ −320 more if the optional EmptyState merge in finding 10 is taken). −0 dependencies (nothing removable — every import is used).

**Not checked:** the internals of the largest admin components (CopilotPanel's SSE loop, InventoryUploadDialog, GlobalSearch's fetch loop, forecast/pricing/risk/settings-page/product-variants dialogs — read only at the signature/effect level); `seo/MetaTags.tsx` + `JsonLd.tsx` internals and `lib/seo-builders.ts` (trusting the meta-quality-r140/jsonld-completeness pins); `lib/boot-sentry.ts`, `sentry-replay.ts`, `web-vitals.ts`, `chart-theme.ts`, `healthz.ts`, `auth.tsx` internals (auth flows were other rounds' lanes); the `ui/` primitives beyond app-dialog/route-skeleton/input usage (button/switch/sonner/skeleton read as shadcn-family); pages/ and App.tsx routing (outside this domain); no tests/builds were run (read-only audit).
