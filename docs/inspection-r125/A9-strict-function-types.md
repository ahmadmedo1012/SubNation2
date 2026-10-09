# R125-A9 — strictFunctionTypes feasibility measurement + migration plan

**Round:** R125 · **Agent:** A9 · **Tree:** `main @ 09857fc` (clean; only untracked `docs/inspection-r125/`)
**Task:** the R123-deferred "strictFunctionTypes (needs its own round)" item (CHANGELOG R122→R123 deferred ledger; R122-A8 sized it "risky late — needs its own round") + the R124-A8-deferred tsconfig test-inclusion question.
**Mode:** read-only measurement. No repo source files modified, no builds, no commits, no installs. Probe configs/scripts live exclusively under `/home/z/my-project/scripts/r125-strict-probe/` (46 artifacts: 23 tsconfig probes + 23 captured outputs).

---

## 1. Current strict-flag state (measured, not assumed)

`tsconfig.base.json` (inherited by EVERY package — frontend, backend, scripts, all 4 `shared/*`):

| flag | value | note |
|---|---|---|
| `noImplicitAny` / `noImplicitThis` | **true** | strict family ON |
| `strictNullChecks` | **true** | ON |
| `strictBindCallApply` / `strictPropertyInitialization` | **true** | ON |
| `useUnknownInCatchVariables` / `alwaysStrict` | **true** | ON |
| **`strictFunctionTypes`** | **`false`** | ⚠ the ONLY disabled strict-family flag — explicitly pinned |
| `strict` (umbrella) | *unset* | never used anywhere |
| `noImplicitOverride` / `noUnusedLocals` | false | not part of `strict`; out of scope |

So the codebase is fully strict **except** function-type variance — exactly as R98-A8 documented ("function-type variance is currently unchecked in every package").

**Empirical `strict: true` comparison (3 runs):**
- `strict: true` alone in a probe extending `frontend/tsconfig.json` → **exit 0, zero errors** — because the base config's *explicit* `strictFunctionTypes: false` **wins over the umbrella flag in the extending config**. → **The flip cannot be done per-package; it must land in `tsconfig.base.json` itself.**
- `strict: true` + `strictFunctionTypes: true` → byte-identical output to `strictFunctionTypes: true` alone → the umbrella adds **zero** additional errors (the other 6 strict-family flags were already satisfied). No second migration is hiding behind `strict`.

## 2. Method

Probe configs at `/home/z/my-project/scripts/r125-strict-probe/` extend the repo's real tsconfigs via **absolute** `extends` paths, adding only `"strictFunctionTypes": true` (+ absolute `typeRoots`, and a `files:`-injected `vite/client.d.ts` for FE, because `types`/`typeRoots` resolve relative to the **leaf** config file — an out-of-repo probe otherwise loses `@types/node`/`vite/client`). Everything else (include/exclude/paths/jsx/lib/moduleResolution) is inherited unchanged.

Run form (repo-installed TS 5.9.3 via `pnpm exec`, nothing installed, each run capped at 570 s):

```
cd /home/z/my-project/repos/SubNation2/frontend && pnpm exec tsc -p \
  /home/z/my-project/scripts/r125-strict-probe/tsconfig.fe.sft-refs.json --noEmit
# same shape for backend (be.sft-refs), scripts (scripts.probe),
# and the 4 shared packages (shared.<pkg>.probe, with noEmit/composite-off overrides)
```

**Program-equivalence discipline** (critical, discovered the hard way — see §2.1):
- `references` are **NOT inherited through `extends`**. A probe that extends `backend/tsconfig.json` without re-declaring its `references` resolves `@workspace/db` to **src** instead of the built `dist/*.d.ts` → a *different* program (1,980 vs 1,973 files) + 40 spurious `TS6059` rootDir errors. All headline probes (`*.sft-refs.json`) re-declare the repo's exact `references` and were verified to produce **byte-identical program sizes** to the repo's own gate (`--listFilesOnly | wc -l`): FE 860/860, BE 1,973/1,973, scripts 610/610.
- `TS18003` ("no inputs") is **suppressed when a config has `references`** — an empty-program probe can silently "pass". Every probe's file count was therefore verified non-empty before its numbers were accepted.

### 2.1 Baseline verification (bonus step — tree drift check)

Repo's own gate commands under **current** flags: FE `0`, BE `0`, scripts `0`, shared/db `0`, shared/api-client-react `0`, shared/api-zod `0`, shared/error-codes `0` (all exit 0). **The R124-green tree has not drifted.** ✓

## 3. Measurements — strictFunctionTypes flip cost

Faithful programs (same file sets as today's `pnpm typecheck` pipeline, only the flag differs):

| package | files in program | errors | src | test |
|---|---|---|---|---|
| frontend | 860 | **2** | 2 | 0 |
| backend | 1,973 | **9** | 0 | 9 |
| scripts (@workspace/scripts) | 610 | **0** | — | — |
| shared/db | 602 | **0** | — | — |
| shared/api-client-react | 98 | **0** | — | — |
| shared/api-zod | 73 | **0** | — | — |
| shared/error-codes | 58 | **0** | — | — |
| **TOTAL** | | **11** | **2** | **9** |

**By error class (all 11):**

| class | count | sites |
|---|---|---|
| Generic component constraint (`ComponentType<unknown>` vs props-carrying component) | 1 | `App.tsx:91` |
| Callback-param contravariance (@types/qrcode `Error \| null \| undefined`) | 1 | `settings.tsx:393` |
| Generic fn constraint (`(...args: unknown[]) => unknown` vs `(a: number, b: number)`) | 1 | `isolate-async.test.ts:84` |
| Test-double structural type (express `Router` vs hand-rolled `{ use: (path, r: unknown) => void }`) | 8 | `admin-filters-pagination.test.ts` ×8 lines |

**Cross-validation:** the no-`references` superset probes (which additionally pull **shared source** into the program: BE 1,980 files, FE 860) surface the **same 11 real errors** and **zero errors in any shared source file** — i.e. the flip is safe even in the "src-resolution" world (no stale-`dist` sensitivity; see §6.2). The 40 `TS6059`s seen there are probe-context artifacts (rootDir vs src-in-program), pre-existing under current flags, unrelated to the flip.

**Risk:** all 11 fixes are **types-only** — every change is a type annotation/constraint that erases at emit; zero runtime-behavior change; the 884 FE / ~2,050 BE green suites are untouched (BE tests aren't re-compiled; FE tests aren't even type-checked).

## 4. Error inventory (full classified list, 11/11)

| # | file:line | code | class | fix (exact) | mechanical? | runtime risk |
|---|---|---|---|---|---|---|
| 1 | `frontend/src/App.tsx:91` | TS2322 | `lazyWithRetry<T extends ComponentType<unknown>>` rejects sonner's `Toaster` (props `ToasterProps` ⊄ `unknown` under contravariance); the other ~48 call sites take prop-less page components and pass | **`lazy-with-retry.ts:68`: `ComponentType<unknown>` → `ComponentType<any>`** — matches React's own upstream `lazy<T extends ComponentType<any>>` typing (fallback if `no-explicit-any` complains: `<P, T extends ComponentType<P>>`) | mechanical | none (type param erases) |
| 2 | `frontend/src/pages/admin/settings.tsx:393` | TS2769 | qrcode callback declared `(err: Error \| null, url)`; @types/qrcode overload 2 is `(error: Error \| null \| undefined, url)` | widen param: `(err: Error \| null \| undefined, url: string)` | mechanical | none |
| 3 | `backend/src/middlewares/__tests__/isolate-async.test.ts:84` | TS2345 | `isolate<T extends (...args: unknown[]) => unknown>` constraint rejects `(a: number, b: number) => number` | **`instrumentation-isolation.ts:18`: constraint → `(...args: any[]) => unknown`** (stdlib-idiomatic fn constraint; production file but types-only — constraint erases; alternative: annotate the test's fn `(a: unknown, b: unknown)`) | mechanical | none |
| 4–11 | `backend/src/routes/__tests__/admin-filters-pagination.test.ts:127,141,158,187,200,232,252,265` | TS2345 ×8 | test's `buildApp(...routers: Array<{ use: (path: string, r: unknown) => void }>)` minimal double no longer accepts express `Router` under contravariance (`r: unknown` demand) | `...routers: Router[]` + `import type { Router } from "express"` (1 signature + 1 import fixes all 8) | mechanical | none |

No design-level fixes. No Promise-executor, event-handler, method-override, or React-event classes appear — the codebase's dominant patterns (orval-generated clients, zod schemas, drizzle tables, express handlers) are already variance-clean.

## 5. Test-inclusion finding (R124-A8 deferred item)

**Are `__tests__` type-checked today?**

| surface | files / LOC | in today's typecheck? | errors if included (current flags) | errors if included (SFT too) |
|---|---|---|---|---|
| FE `src/**/__tests__` + `*.test.{ts,tsx}` + `src/test/**` | **131 files / 26,199 LOC** (50.6% of FE files; 33.6% of 77,938 src LOC) | **NO** — `frontend/tsconfig.json:4` excludes `**/*.test.ts`, `**/*.test.tsx`, `src/test/**` | **49 / 22 files** | **+0 (SFT adds nothing in test files)** |
| BE `src/**/__tests__` | 223 files / 55,583 LOC | **YES** (include `src`) | — | included in the 9 above |
| BE top-level `tests/*.test.ts` | 4 files / 377 LOC | **NO** (outside `include: ["src"]`) | **0** | **0** |
| FE Playwright `e2e/*.spec.ts` + `playwright.config.ts` + `vitest.config.ts` | 10 + 2 | **NO** (outside `src/**/*`) | 0 | **0** |
| scripts root (`validate.ts`, `check-openapi-routes.ts`, `inspect.ts`) | 3 files / 2,126 LOC | **NO** (`include: ["src"]` only) | **2** (`validate.ts:331,376` TS2353) | 2 (probe also shows TS6059/TS5097 config artifacts) |

**Is there a `typecheck:test` script?** No — nowhere. FE/BE `typecheck` scripts run only their tsconfig; vitest transpiles via esbuild with **no type checking** (confirmed in both `vitest.config.ts` — no `typecheck` block, plain esbuild transform). So the FE's 26k test LOC have **no type gate at all** today (exactly R124-A8's finding, now measured).

**The 49 FE test errors, by class** (all mechanical, all in currently-green suites → pure type debt):
- 29 mock-shape drift vs live types (TS2345 ×12, TS2322 ×6, TS2339 ×5, TS2739 ×2, TS2353 ×4) — incl. 3 suites mocking a **stale `Product` shape** (missing `price_from`/`variants`: `flash-sales:35`, `seo-money-pages-r120:77`, `product-price-honesty` ×6) — real invisible drift, the exact A8-predicted failure mode;
- 8 implicit-any in untyped `vi.fn()` callbacks / indexed objects (TS7006 ×3, TS7031 ×2, TS7053 ×3);
- 6 possibly-undefined access on mock members (TS2532 ×1, TS2722 ×5);
- 4 unsafe casts / tuple indexing (TS2352 ×3, TS2493 ×1);
- 1 wrong DOM element type (TS2740), 1 icon-mock component shape (TS2741).

Full 49-line inventory: `/home/z/my-project/scripts/r125-strict-probe/out.tests-base.fe.txt` (kept as the fix checklist).

## 6. Verdict + migration plan

### 6.1 strictFunctionTypes: **ENABLE NOW — this round** (11 ≤ ~40 threshold, all mechanical, types-only)

One focused commit (S effort, ~30–45 min including gates):
1. `tsconfig.base.json:15`: `"strictFunctionTypes": false` → `true` (single line; `strict: true` is NOT equivalent in effect here — see §1).
2. `frontend/src/lib/lazy-with-retry.ts:68`: constraint → `ComponentType<any>` (fixes #1).
3. `frontend/src/pages/admin/settings.tsx:393`: widen `err` param (fixes #2).
4. `backend/src/middlewares/instrumentation-isolation.ts:18`: constraint → `(...args: any[]) => unknown` (fixes #3).
5. `backend/src/routes/__tests__/admin-filters-pagination.test.ts:34`: `routers: Router[]` + type import (fixes #4–11).

Gates after the commit: `pnpm typecheck` (root — libs + all packages) + FE/BE `vitest run` (runtime untouched, suites must stay green) + one production FE build sanity (the only emitted-code-adjacent change is the erased generic constraint — none).

Do **not** bundle anything else into that commit (clean revert boundary; the flag is the revert unit).

### 6.2 Test-inclusion: **staged, separate commits** (49 errors ≠ free, but cheap and high-value)

- **T1 (free, do with or right after 6.1):** include BE top-level `tests/` (`include: ["src","tests"]`) and FE `e2e/` + both configs — measured **0 errors** under current flags **and** SFT. Zero-cost gate widening.
- **T2 (the A8 fix proper):** drop the three exclude entries from `frontend/tsconfig.json` (keep `src/test/**` IN the program — `setup.ts` supplies the jest-dom matcher augmentation; all test files import vitest explicitly, so no `types: ["vitest/globals"]` needed) and fix the 49 in 22 files — all mechanical mock/annotation fixes; est. 1–2 focused sessions. Highest-value targets first: the 3 stale-`Product` mock suites (they guard money pages) and `copilot-persistence` (7 errors, one mock-return shape). Checklists: `out.tests-base.fe.txt`.
- **T3 (optional):** scripts root `.ts` files — requires include widening + `rootDir` adjustment + fixing the 2 real `validate.ts` `RequestInit.timeout` errors. Bonus latent find: `validate.ts:331,376` pass a `timeout` property that (undici) `RequestInit` does not have — **those fetches have no timeout at runtime**; the ops validate suite can hang. Fix: `AbortSignal.timeout(ms)`.

### 6.3 Config observations for the next config-touching round (no action required for 6.1)

- **Stale-dist hazard:** BE/FE typechecks resolve shared packages through **built `dist/*.d.ts`** (Sep 7; 31/18/20 shared-src commits since) via the `references` redirect; only the full root `pnpm typecheck` (which runs `typecheck:libs` = `tsc --build` first) refreshes them. Standalone per-package `pnpm --filter … typecheck` silently checks against stale shared types. Cross-validated harmless for SFT (§3), but worth a comment or a docs note.
- **Probe-methodology notes for future auditors:** (a) re-declare `references` in any out-of-repo probe; (b) always verify program size — `TS18003` is suppressed when `references` exist, so an empty program "passes" silently; (c) `types`/`typeRoots` resolve from the **leaf** config file — out-of-repo probes need absolute `typeRoots` (+ explicit `files:` entry for `vite/client`).

**Bottom line:** the R122 "risky late" deferral aged well — three rounds of strict-everything-else work means the variance debt is now **11 mechanical, types-only fixes**. Enable now.

---

## 7. Retry verification (R125-A9 re-run, second independent pass)

This section is from the **retry run** (the first pass's measurements below are reproduced end-to-end from scratch). Fresh probe configs were written and both headline `tsc` runs re-executed at the same tree (`main @ 09857fc`, clean). **Every number reproduced byte-identically** (`diff` clean vs §3's captured outputs).

### 7.1 Probe configs (verbatim)

`/home/z/my-project/scripts/r125-strict-probe/tsconfig.fe.probe.json` (references re-declared per §2/§6.3 — they are NOT inherited through `extends`):

```json
{
  "extends": "/home/z/my-project/repos/SubNation2/frontend/tsconfig.json",
  "references": [
    { "path": "/home/z/my-project/repos/SubNation2/shared/api-client-react" }
  ],
  "files": ["/home/z/my-project/repos/SubNation2/frontend/node_modules/vite/client.d.ts"],
  "compilerOptions": {
    "strictFunctionTypes": true,
    "types": ["node"],
    "typeRoots": ["/home/z/my-project/repos/SubNation2/frontend/node_modules/@types"]
  }
}
```

`/home/z/my-project/scripts/r125-strict-probe/tsconfig.be.probe.json`:

```json
{
  "extends": "/home/z/my-project/repos/SubNation2/backend/tsconfig.json",
  "references": [
    { "path": "/home/z/my-project/repos/SubNation2/shared/db" },
    { "path": "/home/z/my-project/repos/SubNation2/shared/api-zod" }
  ],
  "compilerOptions": {
    "strictFunctionTypes": true,
    "typeRoots": ["/home/z/my-project/repos/SubNation2/backend/node_modules/@types"]
  }
}
```

### 7.2 Commands + raw counts

```
cd /home/z/my-project/repos/SubNation2/frontend && timeout 480 pnpm exec tsc -p \
  /home/z/my-project/scripts/r125-strict-probe/tsconfig.fe.probe.json --noEmit \
  > /home/z/my-project/scripts/r125-strict-probe/fe-errors.txt 2>&1    # exit 2, 2 errors / 19 lines
cd /home/z/my-project/repos/SubNation2/backend && timeout 480 pnpm exec tsc -p \
  /home/z/my-project/scripts/r125-strict-probe/tsconfig.be.probe.json --noEmit \
  > /home/z/my-project/scripts/r125-strict-probe/be-errors.txt 2>&1    # exit 2, 9 errors / 43 lines
```

Neither run approached the 480 s timeout. **Total: 11 errors (FE 2, BE 9; scripts + shared×4 = 0 per §3/§5).**

### 7.3 Classification (retry recount)

- **src vs test split: 2 src / 9 test** — FE 2/0 (both in `src/`), BE 0/9 (all in `src/**/__tests__/`).
- Top-3 classes:
  1. **TS2345 "Argument of type … is not assignable to parameter of type …"** — 9 (8× express `Router` vs hand-rolled `{use:(path,r:unknown)=>void}` test double in `admin-filters-pagination.test.ts`; 1× `(a:number,b:number)=>number` vs `(...args:unknown[])=>unknown` generic constraint in `isolate-async.test.ts`) — classic method/callback contravariance now enforced;
  2. **TS2322 "Type … is not assignable to type"** — 1 (`App.tsx:91` lazy-import `ComponentType<unknown>` vs sonner `Toaster` props — parameter contravariance on the default-export component);
  3. **TS2769 "No overload matches this call"** — 1 (`settings.tsx:393` qrcode callback `err: Error|null` vs lib's `Error|null|undefined` first param).

### 7.4 Full inventory — all 11 errors verbatim (file:line + message head)

1. `frontend/src/App.tsx(91,3)`: TS2322 `Type 'Promise<{ default: never; } | { default: ({ ...props }: ToasterProps & RefAttributes<HTMLElement>) => Element; }>' is not assignable to type 'Promise<{ default: ComponentType<unknown>; }>'`
2. `frontend/src/pages/admin/settings.tsx(393,24)`: TS2769 `No overload matches this call.` (qrcode `toDataURL` callback param `(err: Error | null, url: string)` vs `(error: Error | null | undefined, url: string) => void`)
3. `backend/src/middlewares/__tests__/isolate-async.test.ts(84,48)`: TS2345 `Argument of type '(a: number, b: number) => number' is not assignable to parameter of type '(...args: unknown[]) => unknown'`
4. `backend/src/routes/__tests__/admin-filters-pagination.test.ts(127,26)`: TS2345 `Argument of type 'Router' is not assignable to parameter of type '{ use: (path: string, r: unknown) => void; }'`
5. `…/admin-filters-pagination.test.ts(141,26)`: TS2345 (same Router-vs-double signature)
6. `…/admin-filters-pagination.test.ts(158,26)`: TS2345 (same)
7. `…/admin-filters-pagination.test.ts(187,26)`: TS2345 (same)
8. `…/admin-filters-pagination.test.ts(200,26)`: TS2345 (same)
9. `…/admin-filters-pagination.test.ts(232,28)`: TS2345 (same)
10. `…/admin-filters-pagination.test.ts(252,26)`: TS2345 (same)
11. `…/admin-filters-pagination.test.ts(265,26)`: TS2345 (same)

### 7.5 Test-inclusion answer (step 5, one sentence)

**Backend's in-src `__tests__` ARE in the current gate** (`include: ["src"]`, no test excludes — ~224 files, which is why all 9 BE errors surface there), while **frontend's 131 `*.test.ts(x)` files are NOT** (its tsconfig excludes `**/*.test.ts`, `**/*.test.tsx`, `src/test/**`) and neither are BE's top-level `tests/` (4 files) or FE `e2e/` (see §5 for the full ungated-LOC measurement).

### 7.6 Verdict — reconfirmed: **(a) ENABLE NOW** (11 ≤ 40 threshold; 11/11 = 100% mechanical ≥ 90% bar)

Every fix needed (identical to §6.1, re-verified against fresh output):

1. `tsconfig.base.json:15` — `"strictFunctionTypes": false` → `true` (single line; must land in base, not per-package — §1).
2. `frontend/src/lib/lazy-with-retry.ts:68` — constraint → `ComponentType<any>` (fixes #1).
3. `frontend/src/pages/admin/settings.tsx:393` — widen callback `err` to `Error | null | undefined` (fixes #2).
4. `backend/src/middlewares/instrumentation-isolation.ts:18` — constraint → `(...args: any[]) => unknown` (fixes #3).
5. `backend/src/routes/__tests__/admin-filters-pagination.test.ts:34` — `routers: Router[]` + `import type { Router } from "express"` (fixes #4–11 in one line).

All types-only (erased at emit, zero runtime change); ship flag + 5 fixes as ONE atomic commit, then gates per §6.1.
