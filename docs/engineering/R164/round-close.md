# R164 — The Google Analytics activation round

Date: 2026-10-18. Status: gated locally, committed. **Push blocked** (the
GitHub PAT that lived at `/home/z/.git-credentials` in the previous
container is GONE from this re-provisioned environment — verified with
`git push --dry-run`: `could not read Username for 'https://github.com'`).
Nothing in this round reached origin/main; the commit sits in the local
clone awaiting the owner's push (or a restored PAT).

**Scope identity (the round-numbering note):** R162's ADR named the
multi-order money lane the "R163 candidate"; R163 took that number and
re-designated it the R164 candidate. This focused activation round takes
R164 — the money lane stays **deferred, not displaced** (now the R165
candidate) with its ADR (`docs/engineering/R162/adr-order-batch.md`)
untouched and its full criteria set unchanged.

## 1. The request and the baseline

The operator pasted the site's GA4 gtag.js snippet (measurement id
**G-RKRV3ZC3MF**, property created 2026-10-18) — the intent: analytics
live on production. Baseline verified before any change: `git fetch` +
clean tree; origin/main = `401e572c` (the R163 final commit, fetched and
fast-forwarded to — the local clone had been left at R157 `f2e1670`
behind by 13 commits).

**Live pre-change evidence:** the deployed bundle
(`/assets/index-Ckn84pnk.js`) contains the R98 loader machinery
(`googletagmanager.com/gtag/js?id=…`) but does NOT contain the id —
`VITE_GA_TRACKING_ID` was unset at the last production build, so GA was
dormant. Activation required exactly one missing piece: the build-time
value.

## 2. Why not the raw snippet

Pasting the snippet into `index.html` (the literal request shape) would
have shipped a broken tag:

1. **CSP**: the repo's helmet CSP bans inline scripts (the A11-F1
   src-less-script gate). The snippet's inline `function gtag(){…}` +
   `dataLayer` bootstrap would be blocked at load — `gtag is not
   defined` for every call site.
2. **LCP**: the snippet's `<script async>` still competes for the HTML
   parse path's network budget; the repo's loader loads gtag.js off the
   critical path entirely (`requestIdleCallback` + `script.async`).
3. **Duplication**: the loader already implements beacon transport +
   `anonymize_ip` + the id shape gate, and helmet already allowlists
   `www.googletagmanager.com` (scriptSrc) and `*.google-analytics.com` /
   `*.analytics.google.com` / `*.googletagmanager.com` (connectSrc) —
   the raw snippet beside it would double-load gtag.js.

So the round activates the EXISTING supported mechanism
(`frontend/src/lib/analytics.ts`) with the operator's id.

## 3. The change (deterministic against the Coolify panel's emptiness)

The id is PUBLIC, non-secret config by design (it ships in the client
bundle for every visitor; it belongs to §2.2's "public, non-secret
values only" build-arg class) — so the repo, not the panel, is its
source of truth:

| File | Change |
| --- | --- |
| `Dockerfile` | The build RUN gains `VITE_GA_TRACKING_ID="${VITE_GA_TRACKING_ID:-G-RKRV3ZC3MF}"` — the same shell `:-` fallback the release identity (`VITE_RELEASE_SHA`) uses, on the RUN whose command (`pnpm --filter @workspace/api-server run build`) chains the frontend vite build through backend `build.mjs`. A rationale comment documents why NOT a bare `ARG` default: the Coolify build-args panel already lists the `VITE_GA_TRACKING_ID` key, and a panel key carrying an EMPTY value OVERRIDES an ARG default with "" (silently killing the id) — the shell fallback fires on empty-or-unset regardless, while a real panel value still WINS (an overridable default, not a duplicate truth). |
| `docker-compose.yml` | The local path passes the `off` sentinel (`${VITE_GA_TRACKING_ID:-off}`) — rejected by the loader's G-/UA-/GTM- shape gate → no fetch, no dataLayer — keeping local stacks out of the production GA property; a shell-exported real id opts a local build in. |
| `backend/src/__tests__/ga-activation-r164.test.ts` | 3 pins: the RUN-line fallback form with a loader-legal GA4-shaped id (a typo'd baked default must not ship as a silent no-op); exactly ONE executable copy of the id in the Dockerfile (no drifting second mechanism); the compose `off` sentinel + proof the loader's gate rejects it. |
| `config/env.example` | The `VITE_GA_TRACKING_ID` entry documents the baked production default, the override semantics, and why the runtime env var does not reach the frontend (VITE_* bake at build time only). |
| `docs/deployment/COOLIFY_FINAL_SETUP.md` §2.2 | The panel entry is now an OVERRIDE: empty keeps the baked id; a different G-… id overrides; any non-matching value (e.g. `off`) disables GA on a production build. |

**SPA route tracking:** no code change needed — GA4 Enhanced
Measurement's history-based `page_view` is on by default for web
streams, and the app routes through the History API (wouter). The
loader's initial `config` call emits the landing page_view; route
changes are captured by Enhanced Measurement.

## 4. Verification (all evidence from this session)

- **The no-env contract (what CI builds):** `vite build` with
  `VITE_GA_TRACKING_ID=` → the id is ABSENT from `dist/` (grep exit 1
  across the built assets; the loader string still present in the
  index bundle) — CI/local builds stay analytics-free, exactly as
  `analytics.ts` documents.
- **The with-env activation (what the Docker build now does):**
  `VITE_GA_TRACKING_ID=G-RKRV3ZC3MF vite build` → the id lands inside
  `initAnalytics` in the main bundle —
  `const e="G-RKRV3ZC3MF".trim()` followed by the G-/UA-/GTM- shape
  gate — byte-for-byte what the Dockerfile RUN now provides.
- **The pin suite:** 3/3 green (`npx vitest run
  src/__tests__/ga-activation-r164.test.ts`).
- **Backend typecheck:** clean — after rebuilding this container's
  STALE `shared/api-zod` dist (`tsc --build --force` from the repo
  root; the container had a pre-R163 build cached, which also explains
  phantom `features` type errors that are NOT present on main).
- **eslint** on the new test file: clean.
- **Gitleaks posture:** not installed locally, assessed manually — the
  id is a 12-char public identifier with no api/key/token/secret
  keyword adjacency in any line it appears on; the R163 CI rejection
  was specifically a 32-char hex-shaped fixture. If CI's gitleaks ever
  flags it, an allowlist entry for the public GA id is the documented
  fix (precedent: R163).

## 5. Production state verified this session (read-only, pre-GA)

The R163 deployment was re-probed before this round's work — all still
live: `healthz` 200 (0.79s); robots.txt serving the R163 design (13
de-indexed families crawlable, only `/api/`, `/admin`, `/status`
disallowed, `Sitemap:` line present); sitemap 56 URLs, zero hreflang;
`/category/gaming` real 404; the PDP crawler shell's Product JSON-LD
with the correct 79.80 LYD price. The IndexNow key-file route remains
unmounted on production (any `/<anything>.txt` returns the SPA
fallback — INDEXNOW_KEY still unset, expected); a real test submission
to `api.indexnow.org` for `https://subnation.ly/` returned **HTTP 202**
(received, pending key validation — will not validate until the key
file exists, i.e. until the owner sets INDEXNOW_KEY). e2e `seo.spec.ts`
against production: **15/18** — the 3 failures are environmental
(this container lacks the Playwright chromium build the repo pins;
only the one test that launches a real browser fails on the missing
executable — the production behavior itself was already verified by
the R163 post-deploy 135/135).

## 6. Owner actions (the complete, honest list)

1. **Push (or restore the PAT):** the R164 commit cannot leave this
   container — `git push` has no credentials (`/home/z/.git-credentials`
   absent). Either push the local `main` from an authenticated machine
   or restore the PAT. The Coolify webhook then builds+deploys it, and
   GA is live (no panel change needed).
2. **Post-deploy verification (minutes):** load the site, DevTools →
   Network → `gtag/js?id=G-RKRV3ZC3MF` + a `collect` beacon; or the
   GA4 Realtime report showing the visit.
3. **GA4 property (optional, once):** Admin → Data streams → Web →
   Enhanced measurement ON (default) — needed for SPA route-change
   page_views; internal-traffic filter if desired.
4. **IndexNow (unchanged from R163):** `openssl rand -hex 16` → set
   `INDEXNOW_KEY` in Coolify env → restart.
5. **GSC (unchanged):** sitemap submission + priority URL inspection —
   no authenticated session exists in this environment.
6. **The 24 mechanical catalogue fixes (unchanged):** need an
   authorized admin session; live facts were re-verified 24/24 at R163.

## 7. Files changed this round

`Dockerfile` · `docker-compose.yml` ·
`backend/src/__tests__/ga-activation-r164.test.ts` (new) ·
`config/env.example` · `docs/deployment/COOLIFY_FINAL_SETUP.md` · this
report + the CHANGELOG entry.
