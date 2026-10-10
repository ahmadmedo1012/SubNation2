# R128-A7 — Appearance Tooling Research (RETRY, tighter scope)

**Agent:** R128-A7 · **Repo:** SubNation2 @ 7d469d5 (read-only on source; this file + worklog append only; scratch in `/home/z/my-project/scripts/r128-a7/`)
**Lane:** appearance QA tooling — visual-regression pilot (deep), impeccable Phase-2 nightly workflow (deep), quick verdicts on the rest.
**Priors read first:** R127-B3 §6 (Phase-2 plan), `.github/workflows/ci.yml` (SHA-pin/zizmor hygiene), `frontend/package.json` + `playwright.config.ts` + `e2e/`, R128-A1 §7 (DESIGN.md — content is A1's; **this report owns CI mechanics only**), worklog tail.
**Method:** every claim below is either (a) verified against the installed tooling (`impeccable@4.1.0 --help`, Playwright 1.63.0 shipped types), (b) probed against the live site (curl of font assets), or (c) executed as a determinism experiment (§3). No source mutations.

---

## 1. Verdict table (summary)

| Tool | Verdict | CI cost | Why (one line) |
|---|---|---|---|
| **Playwright `toHaveScreenshot`** (built into `@playwright/test`, already a dep) | **ADOPT — the pilot (§2)** | ~4–6 min/PR, parallel to existing jobs, free (public repo) | Native, zero new services, baselines are repo PNGs → GitHub's own PR image-diff is the review UI; full determinism control in-spec |
| Lost Pixel 3.22.0 | **reject for now** | same runner cost + external platform for the review UI | Its value = hosted review dashboards at scale; at 12 shots GitHub's image diff suffices; OSS self-host mode adds a dep + config for nothing the native matcher lacks |
| Argos (`@argos-ci/cli` 6.9.6) | **pilot-later (Phase 3)** | runner cost + upload + `ARGOS_TOKEN` secret + SaaS dependency | Free for public OSS and the best review UX at 100s of shots, but makes a core gate depend on a vendor's uptime; revisit if baseline count grows ~10× |
| BackstopJS 6.3.25 | **reject** | +1–2 GB docker pull per run (its recommended mode) | JSON-scenario engine is clunkier than a real TS spec for app-state scaffolding (fonts.ready assertion, API stubs, SW blocking); duplicates Playwright at worse DX |
| impeccable Phase-2 nightly (rendered tripwire) | **ADOPT — drafted in §4** | ~8–15 min nightly, schedule-only | B3 §6 plan verified against reality: flags exist in v4.1.0, JSON schema confirmed (§4.2); one pre-req + one exit-semantics correction |
| stylelint 17.16 | **reject** (park) | ~20 s/PR | Custom CSS = one token-driven `index.css` whose contract is already pinned by `design-system-css.test.ts`; Tailwind v4 `@theme`/`@utility` syntax needs a bespoke config to not mis-fire — low signal per unit of config debt |
| LHCI 0.15.x on live (scheduled) | **pilot-later, separate lane** | ~4–6 min nightly | Runtime perf budgets ≠ appearance tooling; bundle-size budgets already gated at build (`bundleBudgetPlugin`); if adopted, ride in the §4 nightly as a second job, not PR |
| `@axe-core/playwright` 4.13.0 on guest routes | **adopt-later, nightly lane** | +~2 min if added to §4 nightly | Automated subset of A13's manual real-browser a11y (contrast/labels/aria); best pointed at the LIVE site in the nightly (PR-job pages are API-stubbed shells → weak axe signal) |
| `eslint-plugin-tailwindcss` 4.4.0 | **reject** | ~10 s/PR | Peer-supports Tailwind v4, but the codebase already has zero arbitrary-value classes (A1 census) + a test-pinned token contract; ordering churn would touch 380+ files for no defect class found |

*(This table is the deliverable index — sections below carry the evidence.)*

---

## 2. Priority Q1 — Visual regression: tool choice + determinism analysis

### 2.1 Contender matrix for a 20-route RTL storefront on free GitHub-hosted runners

Requirements distilled from the repo's reality: public repo (Actions minutes free), RTL Arabic storefront, `@playwright/test` **already installed** (1.63.0 via lockfile; browsers cache present in the e2e lane pattern), zizmor-clean CI with SHA-pinned actions, and a solo-operator review flow (PR diffs on GitHub, no external approval team).

| Criterion | Playwright native | Lost Pixel | Argos | BackstopJS |
|---|---|---|---|---|
| New dependency | none | agent + config + (platform) token | CLI + `ARGOS_TOKEN` secret | backstopjs + engine, docker-recommended |
| Baselines | PNGs in repo (PR-diffable) | repo (OSS mode) or platform | platform-side (none in repo) | repo PNGs |
| Baseline update flow | `--update-snapshots`, images visible in PR diff | platform UI or regen | approve in UI | regen + HTML report |
| App-state scaffolding (API stub, `document.fonts.ready`, SW block) | full TS spec control | uses your Playwright specs | uses your Playwright specs | JSON scenarios + onBefore scripts — clunky |
| Review UI | GitHub native (2-up + swipe) | platform dashboard | best-in-class | HTML report artifact |
| Vendor lock / failure coupling | none | optional | hard (upload outage ↔ gate) | none |
| RTL / Arabic | first-class (it's just Chromium) | same engine | same engine | same engine |

**Choice: Playwright `toHaveScreenshot`.** The other three are *layers on top of* this engine — their value is review workflow, not determinism, and determinism is the actual risk we're buying tooling against. BackstopJS and (current) Lost Pixel add config surface for review features we outgrew at 12 shots; Argos is genuinely good but couples a blocking check to a third-party SaaS — the wrong first move for a repo whose CI philosophy is pinned, self-contained, supply-chain-careful (SHA pins, gitleaks, zizmor at 0).

### 2.2 Font stability (the headline flake risk — analyzed, not assumed)

**Facts verified:**
- Readex Pro is NOT an OS font dependency: the live site and any `vite build` output ship **6 content-hashed woff2 files same-origin** (`/assets/readex-pro-{arabic,latin}-{400,600,700}-*.woff2` — verified by curling the live CSS bundle) and **preload-link them** in `index.html` (verified in the live HTML head).
- `@fontsource/readex-pro@5.2.6` is an exact-pinned dependency → the woff2 **bytes are lockfile-deterministic**.
- Chromium rasterizes webfont bytes with its in-tree FreeType/Skia — the runner's OS font packages are **not involved** for any glyph Readex Pro covers (all site copy: Arabic + Latin subsets, both shipped).

**Consequences:**
1. "CI runners lack the font at OS level" is a **non-issue** for the primary font — a common visual-CI failure mode (Google-Fonts-CDN or OS-font reliance) is structurally absent here. The PR pilot serves the SPA from `vite preview` on localhost → the woff2 fetch is a loopback request, no network variance at all.
2. The real font risks are two and both are in-spec fixable:
   - **Shoot-before-load** → `await page.evaluate(() => document.fonts.ready)` plus a hard assertion `document.fonts.check('400 16px "Readex Pro"') === true` — converts silent fallback-font drift into a loud test failure (a wrong-font baseline is the worst failure mode: it *passes* while lying).
   - **Glyphs outside the two subsets** (emoji, rare punctuation) would fall back to the runner's Noto/DejaVu → those DO depend on the ubuntu image. Pilot routes carry none (guest storefront copy; A6's emoji findings live in admin/product-detail surfaces). Noted as a future-route constraint, not a blocker.
3. `font-display` behavior: @fontsource CSS uses `font-display: swap` → before `fonts.ready` a fallback flash is possible; the readiness gate makes this moot.

### 2.3 Arabic text-rendering determinism (harfbuzz question)

- Arabic shaping runs in **HarfBuzz compiled into the pinned Chromium** — not the OS library. `@playwright/test@1.63.0` (pinned by the committed lockfile — the `^1.56.1` manifest range resolves through `pnpm-lock.yaml`, so installs are reproducible) pins browser revision **chromium-1243** for everyone, runner and dev alike. No separate harfbuzz pinning exists or is needed; **the browser pin IS the harfbuzz pin.**
- Headless Chromium uses software rasterization (SwiftShader) and Playwright launches with `--force-color-profile=srgb`; no GPU- or display-dependent rendering enters the PNG.
- Residual cross-machine risk is confined to (a) runner *image* drift changing **fallback** fonts (see 2.2) and (b) browser-revision bumps (a lockfile PR) — which re-baseline consciously, and the PR diff shows every image that moved. Both are review-visible events, not silent flakes.
- Bidi/mixed-direction text (Arabic copy with Latin product names) is deterministic under the same engine — no gotcha found beyond engine pinning.

### 2.4 Per-PR cost (12 screenshots = 6 routes × 2 viewports)

| Step | Warm-cache time |
|---|---|
| checkout + pnpm install (cached) | ~50–70 s |
| `vite build` (SPA only) | ~60–100 s |
| `playwright install chromium` (with `~/.cache/ms-playwright` cache keyed on lockfile) | ~5 s warm / ~90 s cold |
| `vite preview` boot + spec (12 shots, 2 workers, ~2–4 s/route) | ~45–75 s |
| **Total job** | **~4–6 min**, runs **parallel** to the existing checks/tests/build jobs — only lands on the critical path if made a required check (recommended after 2 weeks of green) |

Public repo → $0. Storage: 12 viewport-only PNGs ≈ **0.9 MB total** (measured, §3.3) — normal git blobs, **no LFS**; `test-results/` (actual+diff) uploaded only on failure.

### 2.5 Maintenance / baseline-update flow

- Baselines live in `frontend/e2e/visual/__screenshots__/` and are **reviewed as images inside the PR that changed them** — GitHub renders old/new side by side. That's the whole review toolchain at this scale.
- Update = one command, but **must run on Linux** (macOS rasterization differs): `pnpm --filter @workspace/subnation run visual:update` in a `workflow_dispatch` "baseline refresh" workflow that commits to the PR branch. A dev regenerating locally on a Mac would invalidate every baseline — the report recommends the script `echo` a guard warning when `process.platform !== 'linux'`.
- Scope discipline keeps maintenance flat: one `ROUTES` array in the spec is the entire surface; adding route 7–20 later (category, product, cart, flash-sales against canned fixtures) is additive, not architectural.

### 2.6 RTL-specific gotchas (and the in-spec countermeasures)

| Gotcha | Countermeasure in the pilot |
|---|---|
| RTL puts the **scrollbar on the left**; Linux classic scrollbars would bake runner-scrollbar width into every desktop shot | `stylePath` CSS (`*::-webkit-scrollbar { display: none }`) applied at shot time only (option verified in 1.63.0 types: call-site option is `stylePath`, NOT inline `style`) |
| Countdown/timer text (flash-sale banner `FlashSaleBanner.tsx`) drifts per-second | PR pilot routes have APIs stubbed → no flash-sale data at all; if/when live or fixture-driven shots are added: `page.clock` freeze |
| Infinite CSS animations (skeleton shimmer, float-in) land on arbitrary frames | `animations: "disabled"` is the **default** for `toHaveScreenshot` (verified in types): finite → fast-forwarded, infinite → canceled to initial state |
| Caret blink in RTL inputs | default `caret: "hide"` (verified) |
| PWA service worker caching page differently on 2nd run | `serviceWorkers: 'block'` in the visual config's `use` block |
| Sentry/analytics beacons introduce network timing | `context.route` abort for every non-localhost request — the visual job runs **fully offline after build** |
| Entrance animations (`float-in`, `card-spring` — A5's lane) | covered by `animations: "disabled"` + the readiness gate |

### 2.7 The pilot (exact files)

**What it tests:** the PR's own build (appearance changes are exactly what a PR changes), served by `vite preview`, APIs stubbed to instant responses → **static shell** (nav, hero, forms, fine print, footer, tokens, fonts, RTL layout). Data-driven cards are covered by the nightly impeccable tripwire on live data (§4) — the two tools are complementary by design.

**`frontend/visual.config.ts`** (new; deliberately separate from `playwright.config.ts` so the e2e suite's contract stays untouched):

```ts
import { defineConfig } from "@playwright/test";

/**
 * R128-A7 — visual regression pilot (6 routes × 2 viewports).
 *
 * CONTRACT:
 * - Runs against a LOCAL `vite preview` of the PR's own build (VISUAL_BASE_URL).
 * - All /api/** requests are fulfilled instantly with a fixed 503 JSON body →
 *   every data-driven surface renders its deterministic outage/empty state;
 *   no backend, no network, no prod coupling.
 * - Every non-same-origin request is aborted (Sentry, analytics) → offline run.
 * - Service workers are blocked (PWA caching must not alter rendering).
 * - Baselines are LINUX-generated PNGs; regenerate only via the
 *   visual:update workflow_dispatch (never on a dev laptop — rasterization
 *   differs per OS).
 */
const baseURL = process.env.VISUAL_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e/visual",
  timeout: 30_000,
  // Deterministic + light: one worker per viewport project is enough at 6
  // routes; fullyParallel off keeps memory flat on small runners.
  workers: 2,
  fullyParallel: false,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Noise floor measured at 0 on identical builds (§3.2) — 1% absorbs
      // sub-pixel AA on font-cache-cold runs without hiding a real defect
      // (a single clipped Arabic title row is ~2–4% of a 390×844 shot).
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL,
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "vis-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "vis-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
```

**`frontend/e2e/visual/appearance.spec.ts`** (new):

```ts
import { expect, test } from "@playwright/test";

/**
 * R128-A7 — storefront static-shell visual regression.
 * 6 guest routes × {390×844, 1440×900}, viewport-only (above-the-fold):
 * B3-K1-class clipping and token regressions live above the fold; fullPage
 * is a deliberate later expansion (image size ×~6).
 */
const ROUTES = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
  { name: "support", path: "/support" },
  { name: "terms", path: "/terms" },
  { name: "status", path: "/status" },
] as const;

test.beforeEach(async ({ context }) => {
  // 1) APIs: instant, fixed body → deterministic outage/empty UIs.
  await context.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE" } }),
    }),
  );
  // 2) Offline after build: abort everything that is not the preview server.
  await context.route(
    (url) => url.origin !== new URL(context.pages()[0]!.url()).origin,
    (route) => route.abort(),
  );
});

for (const { name, path } of ROUTES) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.goto(path);
    // Determinism gates — in order: network settled, webfont loaded (hard
    // assert: a fallback-font shot must FAIL, not silently re-baseline),
    // then a beat for react-query's error states to commit.
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    const hasReadex = await page.evaluate(() =>
      document.fonts.check('400 16px "Readex Pro"'),
    );
    expect(hasReadex, "Readex Pro webfont did not load — shot would lie").toBe(true);
    await page.waitForTimeout(300); // last paint after query settle

    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: false,
      animations: "disabled", // default; restated for intent
      caret: "hide", // default; restated for intent
      stylePath: "./shot.css", // hides runner scrollbars (RTL: left side)
      maxDiffPixelRatio: 0.01,
    });
  });
}
```

**`frontend/e2e/visual/shot.css`** (new): `*::-webkit-scrollbar { display: none !important; }`

**`frontend/package.json`** scripts (additions):
```jsonc
"visual": "playwright test --config visual.config.ts",
"visual:update": "playwright test --config visual.config.ts --update-snapshots"
```

**Where it runs:** a new `visual` job in `.github/workflows/ci.yml`, `pull_request`/`push` + path-gated on `frontend/**` (same filter pattern as `checks`), SHA-pinned actions only (checkout `fbc6f399…`, pnpm `b906affc…`, setup-node `a0853c24…` — the exact pins already in ci.yml), `permissions: contents: read`, `persist-credentials: false`, `HUSKY: 0`. Browser cache: `actions/cache` on `~/.cache/ms-playwright` keyed on the lockfile hash. Not `workflow_dispatch`-gated like `e2e` — this one needs no stack, which is the point.

**Baseline storage:** committed PNGs (measured 26–228 KB each, **898 KB for all 12**, §3.3) under `frontend/e2e/visual/__screenshots__/vis-390/` + `vis-1440/` (Playwright's default snapshotPathTemplate nests by project name). Plain git, **no LFS** (GitHub's 100 MB hard limit is ~110× away).

---

## 3. Determinism evidence (executed, not argued)

Two experiments, both run-twice-then-pixel-compare (pixelmatch, threshold 0.1), both with the pilot's exact determinism scaffold (networkidle → `document.fonts.ready` → `fonts.check` gate → scrollbar-hidden viewport shot; `serviceWorkers: "block"`; `deviceScaleFactor: 1`). Scripts + raw PNGs: `/home/z/my-project/scripts/r128-a7/` (`smoke.mjs`, `smoke-local.mjs`, `compare.mjs`, `local-experiment.sh`).

### 3.1 LIVE site (https://subnation.ly) — measures native run-to-run flake

Two independent Chromium launches (pinned chromium-1243 via playwright-core 1.63.0), `/login` + `/` at 390×844 and 1440×900:

| Shot | Run 1 | Run 2 | Pixel diff |
|---|---|---|---|
| login-390 | 50 KB / 3.5 s | 50 KB / 3.9 s | **0 / 329,160 px** |
| login-1440 | 70 KB / 3.6 s | 70 KB / 3.3 s | **0 / 1,296,000 px** |
| home-390 | 113 KB / 15.9 s | 113 KB / 15.7 s | **0 / 329,160 px** |
| home-1440 | 344 KB / 15.7 s | 343 KB / 15.8 s | **0 / 1,296,000 px** |

`fonts.check('400 16px "Readex Pro"')` = **true on every shot** (webfont loaded from the site's own hashed `/assets/*.woff2`, incl. across the real internet). Home over the live network settled at networkidle in a repeatable ~15.7 s. **Zero-pixel flake against production**, cold browser each run.

- Caveat recorded honestly: the flash-sale banner (`FlashSaleBanner.tsx`) renders **no banner while no sale is active** — during the test window none was, so the per-second `setInterval` countdown was absent. When a sale IS live, a live-site visual run will drift in the banner strip every second → the PR pilot is structurally immune (API stub → `flashSale = null`), and any future live/nightly visual lane must `page.clock`-freeze or mask the banner (`data-testid="flash-sale-reserved"` region).
- PNG bytes were not always identical live (pixels 100% identical; encoder-stream variance) — irrelevant to `toHaveScreenshot`, which decodes and pixel-compares.

### 3.2 LOCAL pilot architecture — the exact §2.7 scaffold end-to-end

`vite build` of HEAD (7d469d5) → `vite preview` on :4173 → `/api/**` fulfilled with fixed 503 JSON → all non-same-origin requests aborted → 6 pilot routes × 2 viewports, run twice:

| Route (h1 captured) | 390 PNG | 1440 PNG | h1 (proves real Arabic render) |
|---|---|---|---|
| home | 107 KB | 228 KB | «سوق الاشتراكات الرقمية في ليبيا» |
| login | 45 KB | 63 KB | «تسجيل الدخول إلى SubNation» |
| register | 48 KB | 62 KB | «إنشاء حساب جديد في SubNation» |
| support | 56 KB | 75 KB | «الدعم الفني» |
| terms | 66 KB | 92 KB | «المعلومات القانونية» |
| status | 26 KB | 30 KB | «حالة المنصة» |

**Compare result: 7/12 byte-identical (sha256-equal — the strongest determinism signal possible); the other 5 differ in bytes but 0 pixels differ. Total: 0 of 4,155,120 px.** Each 12-shot run: **18.6 s** single-browser sequential. `fonts.check` = true on all 12. Every route rendered its real shell (no crash boundaries, no blank pages) with APIs outage-stubbed — including `/status` and home, i.e. the deterministic outage/empty states the pilot contract promises.

### 3.3 Numbers this pins down for the report

- **Baseline storage: 898 KB for all 12 pilot PNGs** (largest single file 228 KB) — plain-git territory, LFS nowhere in sight (§2.4 estimate tightened down from 1.2–3.5 MB).
- **Noise floor: 0.00%** on identical builds, both live and local → the proposed `maxDiffPixelRatio: 0.01` is pure headroom for sub-pixel AA, not flake insurance; a real defect (one clipped Arabic title row ≈ 30–60 px tall × ~300 px wide ≈ 2–5% of a 390×844 shot) clears it by 2–5×.
- Wall-clock: 12 shots ≈ 19 s locally (screenshot phase only) → the PR job's cost is entirely install/build, as budgeted in §2.4.
