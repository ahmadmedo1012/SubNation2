# R179 — The deprecated-registry retirement + the upstream-unfixable ledger — 2026-10-21

**Scope:** the owner's directive — «ممتاز عجبني, الان اكمل التحسين والتطوير والتنظيم الشامل والتفصيلي لكل المشروع وكل التفاصيل مع التركيز على أدق التفاصيل من كل الجوانب» — the comprehensive-improvement continuation, finest details from every side. R179 closes the standing backlog's #1 dependency item (the deprecated `prom-client`), converts the audit tail's four findings into a documented engineering position, moves the freshness floor, and renders a measured verdict on the react upgrade — the round's own «افحص وقارن» produced a **rejection with numbers**, not a blind bump.

## The rename: prom-client 15.1.3 → @prometheus-io/client 0.16.1

The deprecation notice is explicit: *"prom-client has been replaced by @prometheus-io/client."* The renamed package is the same codebase under the Prometheus IO org scope (deps unchanged: `@opentelemetry/api` + `tdigest`; engines `^22 || ^24 || >=26` — Node 24 ✓). The migration surface, enumerated by repo-wide sweep and closed by `scripts/r179-prom-client-migrate.py` (kept in-tree per the pipeline-script convention):

- **8 import statements** — `metrics.ts`, `redis-client.ts`, `db-instrumentation.ts`, `copilot/rate-limit.ts`, `socket/rejections.ts`, `risk-metrics.ts`, `forecast/metrics.ts`, `routes/admin/copilot/ask.ts`
- **6 inline type assertions** — `alerting.service.ts`'s `as import("prom-client").Counter/Histogram<string>` narrowings
- **14 sites total, zero leftovers** (the sweep's exit-1 verifier ran clean). A production dependency swap: **`pnpm audit --prod` stays zero before and after.**

## The two typing truths the rename carries (the fine-grained part)

The package rename is API-compatible at runtime, but its TypeScript surface moved twice — both movements caught by `typecheck`, both closed with type-honest fixes rather than casts sprinkled at call sites:

1. **`LabelValues<T>` became conditional and unexported.** 15.1.3 declared it as the plain `Partial<Record<T, string | number>>`; 0.16.1 declares `T extends never ? Partial<Record<string, never>> : Partial<Record<T, string | number>>`. TypeScript cannot prove a plain `Record<T, string|number>` assignable to that conditional while `T` is an unresolved generic — which is exactly the shape of our five `safe*` instrumentation helpers. Fix: `export type MetricLabels<T>` in `metrics.ts` — a mirror of the library's exact conditional, documented with the why, adopted by all five helper signatures, and the old no-op `as Record<T, string|number>` casts deleted (they were tautologies even under 15.x).
2. **`LabelValues<never>` resolves to `never`** (the naked-type-parameter conditional distributes over the empty union). For a labelless histogram the only legal call shape is now `observe(value)` — the old `observe({}, value)` that 15.x's `{}`-shaped `LabelValues<never>` admitted is a type error under 0.16.x. Fix: `safeObserve` gained a labelless **overload** (implementation narrows `typeof labelsOrValue === "number"`), and its single consumer — `boot-migrations.ts`'s `observe()` closure — now calls the `(value)` shape. Series shape unchanged: the labelless histogram observes identically at runtime.

**Live exposition proof (not just types):** a smoke against the installed 0.16.1 — `Counter.inc() + inc(2) → r179_smoke_total 3`; `Histogram.observe(0.5) → bucket{le="1"} 1 / sum 0.5 / count 1`; `collectDefaultMetrics` renders 200 lines; the production `dist/index.mjs` + `dist/worker.mjs` each carry 84 references to the new specifier.

## The upstream-unfixable ledger (the audit tail, closed as engineering positions)

`pnpm audit --prod` remains **zero**. The dev-side tail dropped from R169's 28 findings to **4 — and all four have `patched: <0.0.0`**: their vulnerable ranges cover the LATEST published releases (verified against the GitHub advisory records):

| Advisory | Package | Range | Our chain | Reachability |
|---|---|---|---|---|
| GHSA-jmr9-qjv8-65gv + GHSA-7pqw-9j4j-h8q3 (2 HIGH) | extract-zip ≤ 2.0.1 (= latest) | @lhci/cli > lighthouse > puppeteer-core > @puppeteer/browsers | Chrome-for-Testing archive extraction at local browser-download time — an interactive local `lhci collect` against the trusted Google origin; never CI, never the runtime image |
| GHSA-vfj7-8cjw-p6xm (HIGH) | braces ≤ 3.0.3 (= latest) | @sentry/vite-plugin > unplugin > chokidar 3 | build-time glob patterns over our own repo paths — no request-controlled string reaches a braces compilation |
| GHSA-hp3w-g68c-fv3c (MOD) | sprintf-js ≤ 1.1.3 (= latest) | @lhci/cli > @lhci/utils > js-yaml > argparse | local argv/config formatting during local Lighthouse runs only |

A floor cannot close what no release patches — the four are recorded in `pnpm-workspace.yaml` as the **R179 upstream-unfixable ledger** (the R119/R169/R173 accepted-dev-risk class, with a revisit rule: the day any upstream ships a patch, the floor lands and the ledger line dies). Deliberately NOT done: bumping sprintf-js 1.0.3 → 1.1.3 (still inside the vulnerable range — churn without risk reduction).

## The freshness floor + the react 19.3.1 verdict (measured, not assumed)

**Landed:** typescript-eslint 8.72.0 · impeccable 4.7.0 · @playwright/test 1.64.1 · @tanstack/react-query 5.104.5.

**Rejected with numbers — react/react-dom 19.1.0 → 19.3.1.** A/B-measured on the production build: vendor-react **58,585 → 69,215 B gz (+10,630 B, +18.1%** — the 19.2/19.3 Activity / View Transitions / useEffectEvent surface), pushing the eager path **149,469 → 160,093 B gz — OVER the 150 KiB warn gate** the owner froze (and 3.7 KiB from the 160 KiB hard fail). The R144-E2 trim-or-raise precedent applies: the floor stays 19.1.0 until a matching trim frees ≥10.7 KiB gz or the owner re-negotiates the budget. Recorded at the pin site in `pnpm-workspace.yaml` — not a freshness miss, a budget verdict.

**Age-gated — lucide-react 1.60.0.** Released inside the `minimumReleaseAge: 1440` window; the supply-chain defense wins (the exclude allowlist is reserved for urgent security fixes, per the setting's own law). The floor moves when the release ages past one day.

## Gates (all green, on the round's tree)

lint 0/0 · typecheck ×3 · **backend 2,707 tests / 294 files** (7 sequential chunks on the 2-CPU box: lib 725, routes/admin 184, routes/__tests__ 747, services 455, __tests__+jobs+middlewares 578, tests/ 18 — the R178 baseline 2,689 + 18 in the worker-topology family) · **frontend 2,787 / 300** (4 chunks: lib+hooks 433, components 578, pages 1,214, admin 562; the lib+hooks chunk re-verified at the final react-19.1.0 state) · OpenAPI parity 87 / error-codes 50 / header params 7 (green) · production build green — **eager 149,469 B gz** (+29 B vs R178's 149,440 — the tanstack patch's noise; the 150 KiB warn gate holds) · `pnpm audit --prod` zero before and after.

## Ship record (the sequencing law)

- Commit `740bf50a` pushed to `main`; CI run **39518056932 — conclusion: success on every executed job** (path filter cost gate, gitleaks, CVE scan on prod deps, lint/typecheck/drift, scripts + frontend + backend unit suites, production build; e2e path-filter-skipped for the round's file set — the cost gate's designed behavior, same as R177/R178).
- No schema, route, or frontend-src changes: no migration, no OpenAPI drift, no test-literal re-pins needed this round.

## Standing items (unchanged)

- Embrionic API stays deferred by owner order.
- The dev-chain majors (vite 8, vitest 5, sentry 11, typescript 7, firebase 13, jsdom 30, @vitejs/plugin-react 6, @types/node 26, @testing-library/jest-dom 7, @electric-sql/pglite 0.5, @sentry/cli 3) remain one-round-each future work per the upgrade-plan discipline; react 19.3.1 joins that list with its budget price tag attached.
