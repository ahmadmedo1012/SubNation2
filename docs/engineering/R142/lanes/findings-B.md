# Lane B findings — R142 (Task 142-B1)

**Charter:** frontend boot / build pipeline / PWA. **Scope read:** all 77 inventory files deep-read or binary-validated at a9f5e83 (blob hashes verified against the working tree — zero drift). **Method:** Ponytail v5, 6 lenses. **Production truth:** live site healthy (R142-1A, same SHA); every finding below is dormant-risk verified against source, the local dist build, and the live API.

**Boot-path trace (verified end-to-end, zero defects found):** `index.html` (BOOT ORDER comment is tag-sequence-free; ban pinned by `shell-head-anchors.test.ts:224-236`) → build injectors (`injectPreloadGate` vite.config.ts:421-430 and `injectCriticalFontPreloads` vite.config.ts:452-462 both anchor via `indexOfOutsideComments` — comment-aware; upstream Vite/PWA injectors are covered by the ban test) → built-shell structural check (gate at byte 77 right after `<head>`; GSC meta 953; init.js 13972; entry module 14009; 4 modulepreloads 14087; CSS 14420; 4 font preloads 14508; registerSW 15036; `</head>` 15060 — all OUTSIDE comments; exactly 4 src'd scripts; zero src-less inline scripts; every hashed asset reference resolves in dist — no 404 hazards) → `main.tsx` chain (boot-sentry buffer → static-offline removal → direction lock → createRoot with buffering error handlers) → `App.tsx` AuthGate → routes. 120 boot-critical tests run green at HEAD (94 + 26 PWA).

**PWA surface (verified):** manifest.json icons 5/5 exist at declared dims (96/192/512 + maskable 192/512), screenshots 540×1080 + 1080×540 match, shortcuts reference pwa-96x96.png; sw.js precache = index.html + manifest.json + entry CSS + 6 woff2 + favicon.svg (JS deliberately excluded via `globIgnores`, protected by `pwa-offline-shell.test.ts`); navigateFallbackDenylist pins root-static files; autoUpdate (skipWaiting+clientsClaim) with the visible controllerchange toast (main.tsx:112-137, pinned by `offline-pwa-r140.test.ts:285`); zero `.map` files ship. All 45 `products/*.webp` are live-DB-referenced (45/45 exact filename match vs live `/api/products?fields=list` — zero orphans, zero missing).

---

## B-1 — P3 (Bug-class residual + missing test) — the GSC injector's PRIMARY anchor is not comment-aware

**File:** `frontend/src/lib/seo.ts:130-137` (consumer: `vite.config.ts:292-315` `seoHeadInject`; test gap in `src/lib/__tests__/shell-head-anchors.test.ts:205-222`). *(seo.ts is outside this lane's inventory — flagged for its owning lane; the injector consumer and the R141 regression story are lane-B.)*

**What this is:** `injectGoogleSiteVerification` picks its insertion point with `VIEWPORT_META_RE.exec(html)` — a plain first-byte-match regex over the whole document, comments included. The R141 hotfix hardened only the head-close FALLBACK (`seo.ts:147` uses `indexOfOutsideComments`) and left the primary viewport anchor on the old discipline. The idempotency guard `GSC_META_RE.test(html)` (`seo.ts:130`) also scans comment text, so a comment quoting a meta-shaped verification tag would silently SKIP injection.

**Concrete case:** a future `index.html` comment above the real viewport meta that quotes a viewport tag (an example snippet in prose — exactly how r140's BOOT ORDER comment quoted the head-close sequence) → the GSC verification meta is spliced INSIDE the comment → Search Console HTML-tag verification silently never activates. The tag-sequence ban test only bans `<head`/`</head` in comments (`shell-head-anchors.test.ts:233-234`) — a `<meta … name="viewport"…>` decoy is not banned.

**Today:** dormant — the real viewport meta (index.html:14-18) is the first match and the built shell carries the GSC meta correctly (verified at byte 953, outside every comment).

**Fix (smallest, reuse the R141 primitive):** search only non-comment segments — walk segments exactly like `indexOfOutsideComments` and exec `VIEWPORT_META_RE` per segment; plus one regression test in `shell-head-anchors.test.ts` mirroring the fallback-path decoy test. The one-line alternative (same defense class as the ban): extend the ban test to also reject `name="viewport"` meta shapes inside comments. **If we skip it:** the last unhardened HTML injector anchor keeps the r140 outage class alive for the GSC meta only (verification silently fails — no boot impact).

---

## B-2 — P3 (Risk + missing test) — the bundle-budget gate scans the RAW built HTML (comments not stripped)

**File:** `frontend/vite.config.ts:84-91` (entry lookup), `vite.config.ts:134-142` (eager-path link scan).

**What this is:** `bundleBudgetPlugin`'s closeBundle reads `dist/public/index.html` and resolves the entry chunk via a first-match regex, and the eager set via `html.matchAll(/<link\b[^>]*>/g)` — both on the RAW html. Ten lines above, the CSP inline-script check (`vite.config.ts:73-75`) deliberately strips comments first ("a commented-out example can't false-positive") — the same discipline was not applied to the two measurement scans.

**Concrete case:** a future shell comment that quotes a module script tag or a modulepreload/stylesheet link (the tag-sequence ban does not cover `<script`/`<link` shapes) → the entry regex matches the decoy → the gate either measures the WRONG file (silently vacuous — the exact regression R118 fixed at vite.config.ts:47-53, "the gate was silently vacuous") or exits(1) on a chunk that doesn't exist (false build failure). The eager-link scan can likewise inflate/deflate the summed budget set with commented-out links.

**Today:** dormant — the built shell's real tags precede any comment mention and the current build measures correctly.

**Fix (one line each, reuse the existing idiom at line 74):** run both scans on `html.replace(/<!--[\s\S]*?-->/g, "")` — the comment-stripped copy the CSP check already computes; optionally extract the entry-match as a pure function and pin it with a decoy-comment test (the preload-gate test idiom). **If we skip it:** the 55 KiB / 160 KiB gates keep a first-byte-match blind spot that the R141 class can re-open.

---

## B-3 — P3 (Risk + missing test) — ErrorBoundary's error-path Sentry import has no rejection handler

**File:** `frontend/src/components/ErrorBoundary.tsx:63-70`.

**What this is:** `componentDidCatch` fires `void import("@sentry/react").then((Sentry) => {…})` with no `.catch`. In DSN builds `@sentry/react` is the hashed `vendor-sentry` async chunk; in no-DSN builds it resolves to the stub (import succeeds).

**Concrete case:** a render error is caught right after a deploy while the visitor's shell still references the previous release's `vendor-sentry-*.js` and the old chunk is gone (the documented stale-chunk window; `lazyWithRetry` recovers ROUTE chunks but not this direct import) → the import rejects → an additional `unhandledrejection` fires at the exact moment the boundary is rendering its recovery UI — console noise on the crash screen, and the rejection itself lands in boot-sentry's error buffer (one more spurious event).

**Fix (one line, the repo's own idiom — `instrument.ts:137-139`, `app/route-chunk-warmup.ts:77`):** append `.catch(() => {})` with the same "best-effort" comment. Add one assertion to `error-boundary-reset.test.tsx` that the componentDidCatch path swallows import rejection. **If we skip it:** worst case is noise on an already-broken screen; the boundary UI itself is unaffected.

---

## B-4 — P4 (doc drift) — stale byte-size claim for favicon.svg

**File:** `frontend/vite.config.ts:933`.

**What this is:** the R104 comment says "favicon.svg (163 B) stays" in the precache includeAssets rationale. The current `frontend/public/favicon.svg` is 355 B (the R128-L2 brand-asset suite replaced it with the red-tile shield). Zero runtime impact — the file exists, is referenced (index.html:118), and is precached; only the prose number is stale.

**Fix:** correct the number in the comment when the block is next touched. **If we skip it:** a future reader trusts a 2× wrong size in a bandwidth-budget argument.

---

## Verified clean (no finding, evidence recorded)

- **R141 bug class:** repo-wide hunt for first-byte-match HTML mutation found NO unhardened injector: the only production HTML writers are `injectPreloadGate`, `injectCriticalFontPreloads` (both comment-aware), `injectGoogleSiteVerification` (fallback comment-aware — B-1 covers the primary anchor), and upstream Vite/vite-plugin-pwa (covered by the tag-sequence ban + the structurally verified build). The remaining first-match reads are measurement-only (B-2).
- **DSN parity:** `shouldSubstituteBudgetDsn` truth-tabled by `budget-dsn-parity.test.ts` (10 tests); Dockerfile ARG VITE_SENTRY_DSN confirmed (Dockerfile:81,128); local dist entry hash differs from live exactly as documented.
- **Gates that could silently skip:** none found — budget gate resolves the entry from the HTML (ground truth), belt-and-suspenders `bundle[PRELOAD_GATE_ASSET_FILE]` check throws before a 404 script can ship (vite.config.ts:599-603), sourcemap guard sweeps assets/ + dist root (subdirectory residual documented R129-B4; zero `.map` tracked or in dist today).
- **Binaries:** all 56 public assets match inventory blob+size; dims/types validated (`file`); 45/45 product webp live-referenced; manifest↔icons↔index.html cross-consistent; opengraph.jpg real dims = declared 1200×630.
- **Cross-file effects:** all module-scope window/document access in boot files is SSR-guarded or CSR-entry-legitimate; every error path in the boot chain either surfaces honestly or is a documented best-effort swallow (preload gate, init.js theme, head-start legs) — except B-3.
- **Test coverage for the boot path:** 120 tests green at HEAD across shell-head-anchors (17), preload-gate (19), boot-critical-path-r140 (37), pwa-offline-shell (11), budget-dsn-parity (10), offline-pwa-r140 (26). The risky branches WITHOUT a failing test are exactly B-1's primary-anchor decoy, B-2's raw-html scans, and B-3's import rejection.

**Verdict:** healthy — the R141 hardening holds end-to-end at every layer I could measure; the four findings are dormant hardening residuals (2 share the r140 decoy-comment class), none blocks boot or costs money today.

**Not checked:** runtime behavior of the SW in a real controlled-page context (offline boot, cache eviction) — relied on the pinned strategy-map tests + prior rounds' live verification; `dist/` is a local build artifact and was used as structural evidence only.
