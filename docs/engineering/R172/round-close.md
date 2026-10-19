# R172 — Round close: the final modernization sweep

**Date:** 2026-10-19 · **Head before:** `8db8dc4e` (R171 close) · **Code head:** `421822bf` + `827962cb`
**Class:** controlled dependency-major migration (the R169 deferred table, executed)
**Scope:** the owner directive «الآن ادخل في جولة أخيرة من التحسين والتطوير
والتنظيم على أعلى مستوى ولكل الجوانب» — the final round of improvement,
development, and organization at the highest level, all aspects.

## 1. What this round is

R169 swept every safe in-range bump and **deferred the majors with a
rationale**: "do them as dedicated rounds with their own harness, not as
passengers in a broad sweep." R172 is that dedicated round — the final one —
with the full harness available (typecheck ×4, 5,439 unit tests, the 144-test
e2e suite, parity/drift gates, the eager-budget build gate, and the 9-job CI).
Every major taken below carries its own verification story; every major still
refused carries its standing reason re-verified, not merely repeated.

## 2. The majors shipped (`421822bf`)

### 2.1 zod 3.25.76 → 4.6.7 — the API validation layer

The largest surface, and the one R169 called "the whole API validation layer."
The migration was de-risked by three facts established in census before a
single byte moved:

1. **The codegen pin was the gate, not the code.** The orval config's own
   R123-E2 comment documented that orval 8.x already *emits* Zod-4 syntax by
   default (`z.looseObject`, `z.iso.datetime`) — the repo pinned
   `zod.version: 3` only because the catalog pinned zod 3. Moving the config
   to `version: 4` (deterministic emission rule kept) + regenerating produced
   the v4 client (−306/+255 lines) with **zero hand-porting of generated
   code**.
2. **The hand-written surface is 10 backend files**, and the risk-API scan
   found none of the v4 removals in use: no single-arg `z.record`, no
   `nativeEnum`, no `superRefine`, no `errorMap`, no `.datetime()`, no
   `.flatten()`/`.format()`. The error-handler was **already v4-ready**
   (R120 matched `instanceof ZodError` + `.issues` explicitly — its comment
   even says "zod 4 drops the alias").
3. **Exactly two adaptations were needed**: `admin/risk.ts`'s allowlist
   `z.string().ip()` → `z.union([z.ipv4(), z.ipv6()])` (v4 removed the
   combined string-format check; the classic surface exposes the per-family
   factories only — the union is behavior-identical, verified v4+v6 accept /
   malformed reject), and `.strict()` ×5 + `message:` ×16 ride as deprecated
   -but-functional (documented, not churned).

The one semantic shift nothing pins: format-check issue codes change family
(`invalid_string` → `invalid_format`). The client contract carries
`{path, code}` pairs; grep census found **zero consumers of the code values**
— the error-handler's own docblock ("No frontend consumer reads details")
held.

### 2.2 pino 9 → 10, pino-http 10 → 11 — the logging spine

Redact paths, the dev-only pino-pretty transport, and the correlation-bound
`pinoHttp` wiring are all unchanged surface. `thread-stream` (a pino-9-era
hoist pin in backend devDeps, imported by no source file) moved 3.1.0 →
4.2.0 to match pino 10's internal line. The esbuild bundle rebuilt cleanly
(`pino-worker.mjs` 160.5 kB).

### 2.3 redis 5 → 6 + rate-limit-redis 5 → 6 — and a real regression caught

The v6 store changed contract under the wrapper: `init()` became **async**
(it captures `windowMs` and pre-loads the EVALSHA Lua script SHAs over the
wire), and every op awaits the cached SHA promises. Naive v6 wiring silently
breaks the resilient store: without forwarding init, `increment()` throws at
`this.windowMs.toString()` **before ever reaching Redis** — every op falls
back to memory forever, and the Redis rate limiter never engages.

The cooldown test caught it live (`callsAfterFirst` was 0 — the mock never
saw a command). The fix keeps every R2 contract: **forward** init
(fire-and-forget, rejections swallowed — a dead Redis at boot must never
crash the limiter) and **re-arm** on every fallback (a failed script-load
leaves rejected SHA promises cached on the store; re-running init replaces
them, preserving the degraded-boot recovery story). The test then passed
**unmodified** — it was right, the wiring was wrong.

### 2.4 The frontend majors — one typecheck fix total

- **recharts 2 → 3**: one tooltip formatter narrowed to the 5-arg
  `Formatter` shape (`system.tsx` rps tooltip). Everything else held under
  the `rc.` namespace discipline.
- **web-vitals 4 → 6**: the consumer destructures the five callbacks and
  reads `m.value` — unchanged surface.
- **vite-plugin-pwa 1 → 2**: `generateSW` output verified — `sw.js` +
  `workbox-*.js`, 10 precache entries, the `sourcemap: false` SW guard
  honored.
- **lucide-react 0.545 → 1.59**: all 246 imports across 244 files compile
  untouched.
- **minors**: express 5.3, helmet 8.3, node-cron 4.6, otplib 13.5, pg 8.23.1,
  orval 8.43, motion 14.3 (14.4.0 blocked by `minimumReleaseAge 1440` —
  **honored, not bypassed**), wouter 3.13, tailwind-merge 3.7, eslint 10.13,
  impeccable 4.6, @types/react(-dom) 19.3.0.

## 3. The two single-instance laws extended

Both violations were **caught by the harness mid-round** — the process
worked:

1. **@types/react(-dom) pinned EXACT in the catalog** (the react/react-dom
   law, extended). A caret range let one importer sit at 19.2.14 while
   another moved to 19.3.0 — two `@types` peer combos = **two
   @tanstack/react-query instances = two React contexts**. The
   admin-layout-alerts suite went 11/11 red ("No QueryClient set") — the
   exact failure that would have shipped a broken provider into production.
   One exact version = one peer suffix = one instance.
2. **The `@esbuild-kit/esm-loader` alias override went EXACT**
   (`npm:tsx@4.21.0`). The caret form let drizzle-kit's re-resolution pick
   tsx 4.23.15 — a second tsx instance, the R169 two-vite-peer-combo class.
   Caught by the from-scratch-install instance census (the R169 verification
   ritual), fixed before it could reach CI.

### 3.1 The pnpm-workspace.yaml reconstruction

`pnpm up` **rewrites pnpm-workspace.yaml and silently destroys what it
doesn't model**: the `minimumReleaseAge` warning block, every override
rationale comment, **20 of the 31 overrides themselves** (the R144/R169
security floors — the lockfile kept the resolutions, but the enforcement
would have been gone for the next install), and `catalog:` references in
package.jsons (replaced with literal ranges). All restored by reconstructing
the file from HEAD with only the six intended deltas; a frozen-lockfile
install verifies zero resolution drift. **House rule going forward: edit the
catalog/overrides by hand and `pnpm install`; never `pnpm up` a catalog
dependency.**

### 3.2 The CI catch — a false-green verification, owned

The catalog-reference repair shipped with a defect: the lockfile's
**importer specifiers** still carried the literal ranges `pnpm up` had
written, so the manifest (`catalog:`) and the lockfile (`^19.3.0`, `^3.13.0`)
disagreed. CI's from-scratch `--frozen-lockfile` install failed
(`ERR_PNPM_OUTDATED_LOCKFILE`) on **every job** of run 39281315849 — while
the local session had reported the frozen install green. The local check was
a **pipe-exit-code trap**: `pnpm install --frozen-lockfile | tail -2 && echo
OK` tests `tail`'s exit code, not pnpm's — the same false-green class the
R169 two-pass-install lesson warns about, reproduced by a new mechanism.
The fix (`827962cb`) is specifier-only (same resolutions, same versions),
and every subsequent verification in this round checks the real exit code.
The run stands failed on the record; the follow-up run on `827962cb` is the
round's verdict.

## 4. The verification record

| Gate | Result |
|---|---|
| typecheck | clean ×4 (libs, backend, frontend, scripts) |
| lint | **0 errors / 0 warnings** |
| backend suite | **288 files / 2,677 green** (4 chunks — exact R169 baseline count) |
| frontend suite | **297 files / 2,762 green** (2 chunks — exact baseline count) |
| scripts suite | 6 files / 59 green |
| build | green — eager **148,984 B gz** (+1,352 vs R169; budget 150 KiB warn / 160 KiB fail) |
| PWA | v2 generateSW verified: sw.js + workbox-*.js, 10 precache entries, sourcemap off |
| parity gates | openapi **87 ops** / error-codes **50** / header-params **7/7** |
| drift gates | drizzle: no schema changes; orval: idempotent (the 561-line api.ts diff IS this round's v4 regen) |
| audit | prod **clean (0)**; full **10** (the documented-accept floor, unchanged) |
| single-instance census | 1× vite, 1× tsx, 1× react-query, 1× @types/react, 1× @types/react-dom (from-scratch install) |

CI + deployment verification: recorded in §6 (the dispatch-sequencing law
of source-of-truth #17 followed — push verified first, docker dispatched
only after, e2e after the redeploy settled).

## 5. Refused, with the standing rationale re-verified

| Major | Why it stays out of the final round |
|---|---|
| TypeScript 7 | The tsgo native-compiler rewrite on a production money system, with typescript-eslint's support matrix the open question — a compiler swap is its own harness round, not a final-round passenger. |
| vite 8 (+ plugin-react 6) | Build-infrastructure major with zero CVE pressure; the eager budget and 144 e2e depend on the current bundler's behavior. |
| vitest 5 | Test-infrastructure major; 5.0.x is a fresh line; three workspace configs + coverage + UI deps move together. |
| @sentry 11 family (+ vite-plugin 4→11, cli 3) | The observability spine + the release-identity probes the e2e depends on. Zero CVE. A Sentry round of its own if ever wanted. |
| firebase 13 | The web-push/auth client surface has zero local harness coverage — unupgradeable honestly from here. (backend `firebase-admin` is already current at 14.5.) |
| jsdom 30 / jest-dom 7 / playwright 1.64 | Test-infra majors + the R169 standing deferral (browser-rev churn for zero test value). |
| prom-client → @prometheus-io/client | Standing R169 adjudication: a different project, a 30-file metrics rewrite for zero functional gain while prod-audit is clean. |
| react 19.1.0 / tsx 4.21.0 | The single-instance pins — never move as passengers. |

## 6. Deployment record (the sequencing law held)

Per source-of-truth #17, in order — nothing concurrent at any step:

| Step | Record |
|---|---|
| Push `421822bf` | CI run **39281315849 failure** — the §3.2 lockfile-specifier defect, caught by the from-scratch install on every job. The round's own catch-and-fix. |
| Push `827962cb` (the fix) | CI run **39285389137 — all 8 jobs success** (e2e skipped on push by design) |
| `docker.yml` dispatch | Run **39287955033 success** — GHCR `main-amd64` + `sha-827962cb-amd64` images pushed → the production auto-redeploy fired |
| Production settle + probe | **healthz 200**; entry `index-CF7keMv8.js`; **SENTRY_RELEASE id `827962c`** in the live bundle — production runs the round's code |
| `ci.yml` dispatch (post-deploy) | Run **39290235320 — success, all 9 jobs** — **e2e 144/144 passed (3.5 m)** against the new production, zero failed, zero flaky |
| GA4 / PWA markers (read-only) | The GA4 id `G-RKRV3ZC3MF` exactly **1× in the entry bundle** (0 in the analytics chunk — no duplication); `analytics-events-TkgChstF.js` carries `subnation_ga4_sent` + **all 7 ecommerce event names** (purchase, add_to_cart, begin_checkout, view_item, view_item_list, select_item, search); `sw.js` 200 with the vite-plugin-pwa **v2** generateSW output live |

The rollback path stays intact: `docker pull
ghcr.io/ahmadmedo1012/subnation2:sha-1f88dba` (the R171 head) per the
runbook.

## 7. Honesty notes

- Run 39281315849 stands **failed** on the record — the round's first push
  was defective (§3.2) and CI caught what a false-green local check had
  hidden. The pipe-exit-code trap is now a documented verification rule:
  **always test the command's own exit code, never the pipe tail's.**
- `motion` 14.4.0 was NOT taken: `minimumReleaseAge 1440` blocked it
  (published < 24 h). The policy was honored, not bypassed — the round
  records 14.3.0 and leaves 14.4.0 to age in.
- The eager budget moved +1,352 B (147,632 → 148,984 B gz) — recharts 3 +
  lucide 1 + wouter 3.13 bytes, still inside the 150 KiB warn. Recorded as
  a headwind to watch, not a violation.
- The 24 R162 catalog mechanical corrections + 12 business decisions
  remain **owner-side actions** (admin-UI, unchanged from R168/R169).
