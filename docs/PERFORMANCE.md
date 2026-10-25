# SubNation — Performance Record

> Status: CURRENT @ 2026-10-25 (R187 — re-stamped from the R144 freeze:
> the R180 Rolldown toolchain truth + the R186 eager floor; re-stamped at
> each round close). Extracted from the README in R126 so the front page
> stays a product pitch, not an audit report. Every number below is
> round-measured and evidence-stamped; re-measure before citing in a new
> decision. Front-page summary: the README's *Performance* section.

## The budget gates (CI-enforced)

Enforced by the production build (`frontend/vite.config.ts`):

| Gate | Value | Source |
|---|---|---|
| Eager path gzip — warn | **150 KiB** (153,600 B) — raised from 145 KiB at R144-E2 (basis: `vite.config.ts` decision note at `EAGER_GZIP_LIMIT_WARN`) | `vite.config.ts` `EAGER_GZIP_LIMIT_WARN` |
| Eager path gzip — hard fail | **160 KiB** (163,840 B) | `vite.config.ts` `EAGER_GZIP_LIMIT_ERROR` |

"Eager path" = HTML shell + entry + vendor chunks + CSS loaded before any
lazy boundary. The gate runs on every production build (so every push —
CI's build job), printing the per-file breakdown on failure.

## Measured numbers (round history, newest first)

| Round | Measurement | Value |
|---|---|---|
| R186 | Eager path at HEAD (the R180 Rolldown tree + the MetaTags→seo-builders single-sourcing) | **148,921 B gz** (163 emitted JS chunks; +992 B vs R185 — exactly the predicted single-sourcing cost; the 150/160 KiB gates hold) |
| R144-E2 | Eager path at HEAD, CI-parity DSN shape (the gate basis) — the R143-L11-2 trim-or-raise decision | **146,850 B gz** (entry 34,898 + vendor-react 58,630 + vendor-utils 9,744 + vendor-query 10,727 + vendor-router 2,421 + CSS 30,430) — 1,630 B (1.1%) under the old 145 KiB warn; **warn line raised 145 → 150 KiB** (6,750 B / 4.4% headroom; 160 KiB hard fail untouched, 10.4% room) |
| R128-B2 | Mobile LCP re-measure after R127's boot fixes (Lighthouse, 3-run medians, 5 routes): every route out of the POOR band | `/` **4,307 → 3,111 ms (−28%)** · `/product` 4,323 → 3,310 ms · `/login` 4,260 → 3,444 ms + TBT 621 → 89 ms · `/flash-sales` 2,518 ms |
| R127 | Boot: vendor-sentry (111 KB br, 70% unused, a 221 ms LCP-phase long task) deferred to first interaction; budget gate rebuilt to measure a DSN-shaped build (no-DSN under-reported by ~2.3 KB) | eager path **146.7 KB no-DSN / 147.4 KB DSN-shaped** vs the 148.5 KB warn line |
| R126-A5 | Eager path re-measured at HEAD | **145,717 B gz** (no-DSN mode) — still under the 145 KiB warn line |
| R125 | Eager path | **145,709 B gz** (no-DSN) / **146,096 B gz** (DSN mode) — under the 145 KiB gate |
| R125 | `vendor-charts` (recharts, lazy) | **514.75 KB raw / 134.74 KB gz**, loaded on demand only |
| R124 | `vendor-sentry` idle chunk after lazy replay | **469,777 → 328,652 B raw (−141 KB, −30%)** |
| R124 | rrweb recorder payload (lazy) | **126,497 B**, fetched only for recorded sessions |
| R124 | Catalog wire bytes, `?fields=list` | **−62.6%** vs full projection (measured live) |
| R124 | Perceived nav, route warm-up | **−150–400 ms** on 3G/4G (chunk pre-import) |

## The six optimizations (what + why)

1. **Lazy Sentry Session Replay (R124; mechanism re-stamped R187 for the
   R180 Rolldown tree)** — the rrweb recorder (126,497 B) is fetched only
   for recorded sessions (sticky 10% roll / first error) behind a real
   dynamic-import boundary. The chunk pinning is `output.codeSplitting`
   groups (`frontend/vite.config.ts`): groups are evaluated by a
   **priority ladder** — the react family sits at priority 100 so no lazy
   group's dependency recursion can ever capture `react/jsx-runtime` (the
   R120-B5 vendor-motion swallow that briefly exploded the eager set
   149.5 → 341.5 KiB is the caught precedent) — with vendor-sentry kept
   DSN-conditional exactly as before. The deprecated function-form
   `manualChunks` is retired (removed in the R180 vite 8/Oxc/Rolldown
   migration), and `experimentalMinChunkSize` has no Rolldown equivalent —
   removed rather than left dead, and a resurrected line FAILS
   `chunk-architecture-r140.test.ts`. Idle-loaded vendor chunk:
   469,777 → 328,652 B raw (−30%).
2. **Lazy admin charts (R125)** — recharts (`vendor-charts`, 514.75 KB raw /
   134.74 KB gz) loads through the ChartsLoader dynamic-import bridge; the
   admin dashboard/system route chunks paint their KPI tiles without it, and
   admin boots no longer pre-fetch the storefront home chunk (~8.5 KB gz
   saved per admin session).
3. **Catalog list projection (R124)** — `GET /api/products?fields=list`
   omits the fields the grid never renders: the variant tree (62.6% of the
   catalog wire bytes, measured live) and `usage_terms`; cards read `price`
   + `variant_count` instead (full detail: `docs/API.md`).
4. **Route-chunk warm-up (R124)** — pointerenter/focusin delegation
   pre-imports likely-next-route chunks before the click lands
   (−150–400 ms perceived nav on 3G/4G), saveData-respecting; pinned by
   `route-chunk-warmup.test.ts`.
5. **Eager-path budget (standing)** — the eager path holds **148,921 B gz
   at R186** (≈ 145.4 KiB; re-stamped at each round close — R187's build
   re-measures at ship) under the 150 KiB warn / 160 KiB hard-fail gate
   (warn raised 145 → 150 KiB at R144-E2 on the measured basis recorded in
   `vite.config.ts`); regressions fail the production build in CI before
   they ship.
6. **Boot defers (R127)** — `vendor-sentry` loads at the later of
   `load`/first pointerdown (`frontend/src/lib/boot-sentry.ts`, early-crash
   guarantee preserved), exact-`/login` boots render optimistically through
   the 0.6–0.9 s auth probe, and the first-4 catalog card images warm at
   prefetch resolve with `fetchpriority=high` on index-0. Verified live
   R128-B2: the deferral moved mobile LCP −0.7 to −1.2 s on every route
   (table above); the remaining structural levers are the held-open CDN
   and server-rendered critical content.

## How to re-measure

```bash
pnpm run build        # prints "[bundle-budget] eager path (...): N bytes (gzip)"
                      # and FAILS over the 160 KiB hard line
```

Live-side (production): Chrome DevTools / Lighthouse against
<https://subnation.ly>, or the R128-B2 report in `docs/history/inspection-r128/`
for the latest full pass (5 routes × 3 Lighthouse runs + the boot
waterfall); R126-A5 (`docs/history/inspection-r126/`) holds the dist-audited
chunk map.
