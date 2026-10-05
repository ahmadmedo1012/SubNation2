# External Integrations — Final Status Record

Date: 2026-10-05 (Vercel→Coolify migration + cleanup mission). Supersedes the
Vercel/Render-era sections of `docs/deployment/*` (those remain as labeled
historical evidence). No secret values appear in this file.

## Production source of truth

```
GitHub main → Coolify (git-source dockerfile build, push-to-deploy webhook)
            → Contabo VPS (169.58.100.161) → SubNation container (SPA+API+WS)
            → OpenWA container (internal, :2785) → WhatsApp
            → Neon PostgreSQL (all business truth)
```

Live deployment identity: container env `GIT_SHA` == image tag == Coolify
deployment record == GitHub main HEAD. Healthcheck `/api/healthz` gates every
deploy. Rollback = redeploy previous Coolify deployment.

## Google / Firebase status

| Piece | Status | Where it lives now |
| --- | --- | --- |
| Firebase web config (apiKey, authDomain, projectId `subnation-2571e`, appId, storageBucket, messagingSenderId) | RECOVERED + MIGRATED as Coolify **build-time** envs (values recovered from the last Vercel-era client bundle — public-by-design values that shipped in every bundle; Vercel's own env copies were literal `"None"` strings) | Coolify app env, `is_buildtime=true` → Dockerfile ARGs → baked SPA |
| `VITE_FIREBASE_AUTH_ENABLED` | **Deliberately unset** in production. The client bundle tree-shakes the whole Firebase module until this is set (verified in deployed output) | — |
| Firebase Admin / service-account JSON (`FIREBASE_SERVICE_ACCOUNT_JSON` or discrete pair) | **NOT PRESENT anywhere recoverable** (Vercel never had it — the backend lived on Render; Render is suspended and inaccessible). Operator-gated | Must be supplied by operator → Coolify runtime env |
| Google login end-to-end | **BLOCKED on the service account.** One activation step: set `FIREBASE_AUTH_ENABLED=true` + service-account JSON (runtime envs) + `VITE_FIREBASE_AUTH_ENABLED=true` (build-time) → redeploy → verify. Frontend is config-complete and the button correctly stays hidden until then | — |
| Firebase Authorized Domains | **Operator action**: `subnation.ly` (+ `www.subnation.ly`) must be allow-listed in the Firebase console (`subnation-2571e`) or signInWithPopup returns `auth/unauthorized-domain` | Firebase console |
| GA4 (`VITE_GA_TRACKING_ID`) | NEVER configured anywhere (Vercel env empty; no G- id in any bundle). CSP is already prepared in `backend/src/app.ts` | Set build-time when the operator supplies an ID |
| Google Tag Manager | Never present | — |
| Search Console (`VITE_GSC_VERIFICATION`) | NEVER configured (empty on Vercel; only the placeholder comment in index.html). Injection mechanism verified working (`vite.config.ts` seoHeadInject) | Set build-time when the operator supplies the token |
| Google OAuth (`GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID`) | Never set anywhere; the only reader is a legacy env fallback (auth-settings.ts) documented in the dead-code list | — |
| reCAPTCHA | Dormant CSP entries only (backend/src/app.ts:178-180,234-244); zero code references; Firebase Phone auth permanently rejected server-side | — |
| Sentry (`SENTRY_DSN` / `VITE_SENTRY_DSN`) | Off (never had values). CSP ready. The single console notice about a missing DSN is intentional (97-F6) | Optional operator supply |

## Analytics status

- GA4: not active (see above) — no duplicate tags, single loader path
  (`frontend/src/lib/analytics.ts`, idle-loaded).
- Vercel Web Analytics + Speed Insights: were provisioned on the Vercel project
  but never instrumented (`hasData: false`, zero `/_vercel` references in any
  bundle). Died with the project. Nothing to migrate.

## Search Console status

Never configured. The build-time injection mechanism is verified and expects
`VITE_GSC_VERIFICATION`; the meta references `https://subnation.ly/` (canonical
already baked as `<link rel="canonical" href="https://subnation.ly/">`).

## Vercel status — DELETED

- Project: `prj_CYtD24q2eRMf1e2NUgUElbR5FDWc` ("subnation", framework
  "services", git link `ahmadmedo1012/SubNation2`, production branch main).
- Deployment history: last READY deploy 2026-10-04 09:27 (`7cee846`); every
  deploy after 2026-10-05 09:02 ERRORED (the failing GitHub App auto-deploys).
- Env inventory (20 vars, all production-scope, all `VITE_*`): 3× retired
  Render split-stack URLs (`VITE_API_URL`/`VITE_API_BASE_URL`/`VITE_SOCKET_URL`
  = `https://subnation2.onrender.com`) → LEGACY/DELETE; 8× Firebase web config
  = literal `"None"` strings → LEGACY/DELETE (real values recovered from the
  old bundle instead); `VITE_FIREBASE_AUTH_ENABLED=true` (pointing at garbage
  config) → superseded by the staged migration above; `VITE_APP_NAME`,
  `VITE_APP_VERSION`, `VITE_RELEASE_SHA` → NOT NEEDED (no readers / Coolify
  derives release SHA from `GIT_SHA`); `VITE_APP_ORIGIN` → already set on
  Coolify; GA/GSC/GOOGLE_CLIENT_ID/SENTRY_DSN → empty (never configured).
- Crons: none defined (feature flag only). Functions: framework "services" —
  none. Deployment protection: none. Git integration: the Vercel GitHub App —
  removed with the project (this also ends the failing "Production" deployment
  statuses on every push).
- Domains `subnation.ly` + `www.subnation.ly` were claimed by the project but
  DNS already pointed at Contabo (A → 169.58.100.161, Cloudflare DNS-only);
  detached, then the project deleted via the official API
  (`DELETE /v9/projects/{id}` → subsequent GET = 404; `subnation-seven.vercel.app`
  = 404). Production verified healthy immediately after deletion.
- Independence proof (all verified before deletion): DNS, traffic, frontend,
  API, auth, Firebase, analytics, Search Console, webhooks, cron, domains,
  deployment chain — zero Vercel dependency (details in the progress log and
  this file's sections above).

## Render status — RETIRED, no runtime dependency

- Both legacy services (`subnation2`, `openwa-gateway-7aaa`) live-verified
  **503 suspended** at audit time.
- `render.yaml` (frozen blueprint) and `.github/workflows/deploy.yml`
  (kill-switched Render deploy hook) **removed from the repository** on
  2026-10-05 (commit `62ee976`); git history preserves them.
- `RENDER_*` env reads remain in backend code as harmless graceful fallbacks
  (release-sha, diagnostics, logger, sentry, scheduler, boot-migrations,
  observability, scripts/start) — deliberately kept (documented legacy, no
  service exists to reach; R117 A7-2 restored the boot warn for the
  split-era-origin family).
- Historical docs (`docs/deployment/RENDER_LEGACY_FALLBACK.md`,
  `docs/free-tier-optimization-2026-09-20.md`, round reports) preserved as
  labeled historical evidence. The `r115-db` re-suspension record stands.

## Coolify status — production authority

- App `kjxqu3ytcnwb1btmlw56la5r` ("subnation", applicationId 3): git source
  `https://github.com/ahmadmedo1012/SubNation2.git#main`, dockerfile pack,
  `include_source_commit_in_build`, healthcheck `/api/healthz`,
  `custom_network_aliases` N/A (subnation side), push-to-deploy via GitHub
  webhook (HMAC-verified).
- OpenWA app `6x3ekglvh7megkkhfsnyhm8h`: image `ghcr.io/.../openwa:sha-ba6a843`,
  alias `openwa`, sessions persisted in Neon `openwa_sessions`; WhatsApp OTP
  session `subnation-otp` **paired and READY** (operator completed pairing
  2026-10-05).
- Build-time envs now include the migrated Firebase web config; runtime envs
  unchanged from the verified contract (`docs/project-graph/11-environment-secrets.mmd`).

## Intentionally retained legacy references (labeled, harmless)

- `VERCEL_FRONTEND_ORIGIN` / `FRONTEND_ORIGINS` folding + boot warn in
  `backend/src/lib/origins.ts` (+ `csrf-gate.test.ts` pinning it) — defensive
  reader of an unset variable; R117 deliberately restored the warn (A7-2).
- `RENDER_*` fallback readers (see Render section).
- Historical docs under `docs/` (round reports, deployment-era runbooks) and
  dated code comments referencing the migration era.

## Operator-only actions remaining

1. **Google login activation**: supply `FIREBASE_SERVICE_ACCOUNT_JSON` (or the
   discrete `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` pair) as Coolify
   runtime envs, add `VITE_FIREBASE_AUTH_ENABLED=true` as a build-time env,
   allow-list `subnation.ly` (+ www) in the Firebase console authorized
   domains, then redeploy and verify the popup→session exchange.
2. Optional: GA4 ID, Search Console token, Sentry DSNs, Telegram alert-bot
   pair, Redis (deliberately unset by design), inventory restock for
   provider-backed products (or wait for the Embronic integration prepared in
   `docs/project-state/embronic-adapter-design.md`).
