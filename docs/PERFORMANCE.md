# SubNation — Performance Record

> Status: CURRENT @ 2026-10-09 (R126). Extracted from the README in R126 so
> the front page stays a product pitch, not an audit report. Every number
> below is round-measured and evidence-stamped; re-measure before citing in
> a new decision. Front-page summary: the README's *Performance* section.

## The budget gates (CI-enforced)

Enforced by the production build (`frontend/vite.config.ts`):

| Gate | Value | Source |
|---|---|---|
| Eager path gzip — warn | **145 KiB** (148,480 B) | `vite.config.ts` `EAGER_GZIP_LIMIT_WARN` |
| Eager path gzip — hard fail | **160 KiB** (163,840 B) | `vite.config.ts` `EAGER_GZIP_LIMIT_ERROR` |

"Eager path" = HTML shell + entry + vendor chunks + CSS loaded before any
lazy boundary. The gate runs on every production build (so every push —
CI's build job), printing the per-file breakdown on failure.

## Measured numbers (round history, newest first)

| Round | Measurement | Value |
|---|---|---|
| R126-A5 | Eager path re-measured at HEAD | **145,717 B gz** (no-DSN mode) — still under the 145 KiB warn line |
| R125 | Eager path | **145,709 B gz** (no-DSN) / **146,096 B gz** (DSN mode) — under the 145 KiB gate |
| R125 | `vendor-charts` (recharts, lazy) | **514.75 KB raw / 134.74 KB gz**, loaded on demand only |
| R124 | `vendor-sentry` idle chunk after lazy replay | **469,777 → 328,652 B raw (−141 KB, −30%)** |
| R124 | rrweb recorder payload (lazy) | **126,497 B**, fetched only for recorded sessions |
| R124 | Catalog wire bytes, `?fields=list` | **−62.6%** vs full projection (measured live) |
| R124 | Perceived nav, route warm-up | **−150–400 ms** on 3G/4G (chunk pre-import) |

## The five optimizations (what + why)

1. **Lazy Sentry Session Replay (R124)** — the rrweb recorder (126,497 B) is
   fetched only for recorded sessions (sticky 10% roll / first error) behind
   a real dynamic-import boundary; `manualChunks` pins the recorder package
   + wrapper source into `vendor-sentry`, and `experimentalMinChunkSize`
   (2048) dissolves the recorder's sub-modules back into it. Idle-loaded
   vendor chunk: 469,777 → 328,652 B raw (−30%).
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
5. **Eager-path budget (standing)** — the eager path holds ≈ 143 KiB gz
   (145,717 B at HEAD) under the 145 KiB warn / 160 KiB hard-fail gate;
   regressions fail the production build in CI before they ship.

## How to re-measure

```bash
pnpm run build        # prints "[bundle-budget] eager path (...): N bytes (gzip)"
                      # and FAILS over the 160 KiB hard line
```

Live-side (production): Chrome DevTools / Lighthouse against
<https://subnation.ly>, or the R126-A5 frontend-performance report in
`docs/inspection-r126/` for the latest full pass (dist-audited chunks,
live probes).
