# R130-A5 — Frontend architecture, runtime, performance

**Method:** first-hand evidence — local dist at HEAD fd702d6, live GET probes
against https://subnation.ly, source reads. No rebuild needed (dist was
already built at HEAD).

## Findings

### A5-F1 [P3 · VERIFIED] Eager-path headroom down to ~928 B gz — FIXED R130
Measured live (gzip level 6, same method as the build gate): entry 35,403 +
vendor-react 58,623 + vendor-utils 9,833 + vendor-router 2,623 +
vendor-query 10,897 + css 30,173 = **147,552 B gz** vs the 145 KiB warn line
(148,480 B) — the R128 record was 146,276 (+1,276 B, ~0.9%: R129 token/CSS +
cart stock-honesty). Hard-fail headroom (160 KiB) comfortable at ~16 KB.
Concrete reclaim found: `web-vitals.ts:21` statically imported the module
into the entry while its own docblock claimed deferral (only COLLECTION was
deferred). **FIXED R130**: `import("web-vitals")` inside initWebVitals
(returns a promise; web-vitals v4 subscribes with `buffered: true`
observers, so no early metric is lost) — ~1.5-2 KB gz reclaimed with zero
behavior change. Tests updated to await the promise (assertions unchanged).

### A5-F2 [P4 · SUSPECTED, dormant] SW images-v1 CacheFirst (30 d) vs non-content-hashed art filenames
`vite.config.ts:953-962` + 45 repo-committed `/products/*.webp` with stable
names and no admin upload endpoint today: any future same-name art replace
pins stale art for 30 d for PWA visitors (CacheFirst never revalidates).
Smallest fix when art changes: bump the cache name or `?v=<hash>` the URLs.

### A5-F3 [P4 · VERIFIED] Successful checkout did not invalidate the stock surfaces it just changed — FIXED R130
Post-success invalidation covered wallet + orders + me, but the PDP
(`["product-by-slug", slug]`) and catalog lists kept pre-purchase
stock_count/is_available for up to 3 min. **FIXED R130**: the success (and
partial-success) blocks now also invalidate `["product-by-slug"]` and
`["/api/products"]` (verified against the generated key shapes:
`getListProductsQueryKey` = `["/api/products", params?]`).

### A5-F4 [P4 · VERIFIED-OPEN inherited] Bell↔notifications read-state eventual consistency
R129's accepted tail, unchanged: page markRead writes the paged overlay; the
bell is a 60 s visibility-gated poll — badge stale ≤60 s until socket/poll
reconciles.

### A5-F5 [P4 · VERIFIED] IdleToaster was the one defer-mounted surface with no ErrorBoundary — FIXED R130
`App.tsx:1089-1095` mounted the lazy Toaster outside every boundary; a
sonner render throw = uncaught ROOT error → React 19 unmounts the tree.
**FIXED R130**: `<ErrorBoundary fallback={null}>` wrapper (the R118-B2
chrome convention).

### A5-F6 [P4 · VERIFIED, accepted] Root-level soft-200 residual
`GET /sw.js.map` → 200 text/html (SPA shell). No map bytes exist (dist has
0 .map files — build-gated) and /assets misses 404 correctly; the root
fallback serving HTML for unknown paths is the documented SPA pattern.
Optionally 404 `*.map` at the root in app.ts when touched.

## Inherited-closed (re-verified this round)
R128-B2 F1 (sw.js.map leak — no map emitted, guard in place), R128-B2 F2
(/assets soft-200 — live 404 text/plain), R128-B2 N2 (preload-gate module —
571 B live), R129 P1s (B-11 wiring + CI gate), SW lifecycle family
(skipWaiting/clientsClaim/cleanupOutdatedCaches, 9-entry precache,
NavigationRoute denylist, no-cache sw.js, single-reload-per-pathname
recovery + controllerchange toast — a stale SW cannot serve old assets
post-deploy).

## Verified-OK register
Sentry boundary intact (vendor-sentry 329,034 B raw, replay 126,879 B, zero
on the load path); React Query hygiene (defaults, head-start seeding, no key
collisions); polls don't overlap (bell 60 s visibility-gated, support 25 s
open-ticket-only, admin 15/60/90/300 s families); re-renders (ProductCard
memo complete, cart split-context, memoized grids); socket client
(dispose-generation guard, 10 attempts/10 s cap, park/revive, resync IS
wired via SessionActivityManager + SocketInitializer with precise cleanup);
images (400px webp, dimensions, eager/lazy split, fetchpriority, boot
warming — srcset unnecessary at current art size).
