# SubNation Master Plan — Recovery + Consolidation + Productionization

Mission start: 2026-10-05 ~19:50 +02. Baseline verified at Wave 0.
Baseline HEAD: `ef3d0c3` (GitHub main). Deployed SHA at mission start: `f10bb9b` (behind main by the R117 repairs).

## Current state (compressed) — as of Wave 0 / 2026-10-05 (superseded where contradicted by the merge; see `docs/project-state/source-of-truth.md`)

- Live production: subnation.ly via Cloudflare (DNS-only) → Traefik (Let's Encrypt) → Coolify-managed
  container on Contabo VPS 169.58.100.161. Health: live `ok`, summary `degraded` pre-R117-code (Neon
  cold-resume flap, fixed at `ef3d0c3`).
- At Wave 0, deployment was **not** yet under Coolify build authority: dockerimage resource + hand-pushed
  `coolify-latest` image + one fake DB deployment row. **Wave 1 fixed this on 2026-10-05**: Coolify app
  `kjxqu…` (git source `#main` + push-to-deploy webhook) is now the deployment authority; the old
  dockerimage app was deleted at cutover.
- Store: 45 live products, **3 available / 6 inventory units** (mission P1: nearly unsellable;
  restock is operator action tied to Embronic).
- Auth: Telegram LIVE (DB config); Google/Firebase OFF both ends (no creds in prod); WhatsApp OTP
  paired & READY (session `subnation-otp`, since 2026-10-05 — was DOWN at Wave 0).
- Money: M1–M14 enforced; 7 orders / 401.49 LYD lifetime; 3 topups pending operator approval.
- CI: billing-disabled → all gates run locally (verified green at `ef3d0c3`, see 10-progress-log.md).

## Target state

Coolify builds from GitHub main via deploy key (dockerfile pack, `GIT_SHA` build arg), healthcheck
gated, live SHA verified from inside and outside. One coherent admin surface; provider-ready
fulfillment boundary; WhatsApp fully operated from `/admin/whatsapp`; security passes green;
browser QA green; no Vercel/Render runtime dependency (achieved: the repo files `render.yaml` /
`vercel.json` / `deploy.yml` were removed 2026-10-05, `62ee976` — preserved in git history only).

## Waves (dependency-ordered; do not advance past unverified prerequisites)

| Wave | Scope | Depends on | Status |
| --- | --- | --- | --- |
| 0 | Reality, graphs, source-of-truth, plans | — | DONE |
| 1 | Deployment correctness: Coolify Git-source build, env migration, deploy `ef3d0c3`, live SHA verify, fake-queue cleanup, rollback plan | 0 | DONE (2026-10-05) |
| 2 | WhatsApp: control-plane verification from admin surface, restart/persistence drills possible without pairing, operator-pairing runbook | 1 | DONE (2026-10-05; session `subnation-otp` paired & READY) |
| 3 | Provider architecture cleanup: registry hardening, secrecy tests, provider_fulfillments maturation | 1 | DONE (2026-10-05) |
| 4 | Admin simplification: keep merchandising, remove/deprecate manual supplier-style ops where they exist | 3 | DONE (2026-10-05) |
| 5 | Google/Firebase/tracking audit: code paths verified, CSP correct, enable-what-creds-allow, record operator inputs | 1 | DONE (2026-10-05) |
| 6 | Embronic adapter preparation: mapping/persistence/idempotency/reconciliation design + contract tests + mocks — **no invented endpoints** | 3 | DONE (2026-10-05; design ready, gated on creds) |
| 7 | Security passes: semgrep, trivy, osv, gitleaks; authz/IDOR/CSRF/CORS/rate-limit/admin-boundary review; Mimosa deep scan re-run | 1 | DONE (2026-10-05) |
| 8 | Browser QA: Playwright desktop/mobile/RTL/dark-light over storefront + admin; console/network capture; regressions into tests | 1, 2 | DONE (2026-10-05) |
| 9 | Performance: only measured problems (bundle, queries, boot) | 8 | DONE (2026-10-05; no new measured problems) |
| 10 | Final verification + report: full matrix, deploy final SHA, blockers list | all | DONE (2026-10-05) |

## Execution rules

- Verify, update graph/plan, commit per wave, push, deploy when applicable, live-verify, continue.
- Never: force-push, weaken money invariants, delete volumes/data, expose secrets, resurrect
  `render.yaml`/`vercel.json`/`deploy.yml` (removed from the repo 2026-10-05, `62ee976`),
  hand-edit generated compose as a "solution", fake Coolify status.
- Operator-gated (record precisely, never fake): WhatsApp QR pairing, Firebase service-account
  creds, Telegram alert-bot creds, TOTP enrollment, inventory restock, Cloudflare dashboard edits,
  GitHub billing. (Vercel App disconnect was on this list — completed 2026-10-05: project +
  integration deleted.)
- See `06-verification-matrix.md` for per-wave evidence and `09-external-blockers.md` for gates.
