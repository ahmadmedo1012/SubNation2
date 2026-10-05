# 05 — Execution Waves (operational detail)

## WAVE 0 — Reality + synchronization + graph ✅
Evidence: live probes, VPS inspection, Neon read-only queries, gate suite run, repo sync to
`ef3d0c3`. Artifacts: `docs/project-graph/00–12`, `docs/project-state/source-of-truth.md`, this plan.

## WAVE 1 — Production deployment correctness (in progress)
1. Snapshot Coolify app 2 config (full JSON → VPS `/data/backups/` + local docs dir).
2. Mint a Coolify API token (Sanctum-format row) → verify API round-trip.
3. Deploy key: generate ed25519 pair; register public half on GitHub (read-only) via API; register
   private half in Coolify.
4. Reconfigure app 2 → `build_pack=dockerfile`, git source main, `dockerfile_location=/Dockerfile`,
   `ports_exposes=3000`, healthcheck `/api/healthz`, env table = current `.env` values (copied
   server-side; secrets never transit chat), build-time env `VITE_APP_ORIGIN=https://subnation.ly`.
5. Clean the fake/stuck deployment-queue rows (22 failed, 23 queued) properly.
6. Deploy; watch build logs; verify: container `GIT_SHA` == main HEAD; `subnation.ly/api/healthz` ok;
   summary stable; admin login page serves; rollback path = previous deployment.
7. Commit Wave 1 (docs + any repo-side deployment artifacts), push, re-verify live SHA.

## WAVE 2 — WhatsApp operational completion
- Drive the same endpoints the admin UI uses (admin-gated) to prove: list/create/start/stop/QR/
  pair-code/delete + status + last error surfaces.
- Restart drills that don't need a paired phone: gateway container restart → sessions persist
  (empty today) → backend recovers; cold-boot 503 `gateway_waking` contract re-verified.
- Deliver a precise operator pairing runbook (QR via `/admin/whatsapp` only; OpenWA stays private).
- Session persistence + recovery after SubNation restart: verified against `openwa_sessions` state
  machine with a throwaway session (create → restart → delete).

## WAVE 3 — Provider architecture cleanup
- Registry fail-safe, secrecy protections, provider_fulfillments lifecycle; add contract tests for
  the interface; document the single-provider boundary for Embronic.

## WAVE 4 — Admin simplification
- Audit every admin surface against "merchandising vs supplier-ops"; remove/deprecate manual
  provider-style operations that would duplicate provider truth (after Wave 3's boundary exists).
- Today's manual inventory upload remains (it IS the supply path until Embronic) but gets a clear
  "until provider sync" label + the money-suite around it.

## WAVE 5 — Google/Firebase/tracking audit
- Verify every Google touchpoint in code/CSP/build args; document ACTIVE/REQUIRED/OPTIONAL/DEAD.
- Enable nothing without creds; produce exact operator input list (service-account JSON, GA id,
  GSC token); verify endpoints transition from "off" to "configured" shapes.
- Remove proven-dead Google code only with test evidence.

## WAVE 6 — Embronic adapter preparation (gated)
- Adapter skeleton behind `FulfillmentProvider`, mapping model, persistence, idempotency,
  reconciliation design, admin monitoring hooks, mocks + contract tests. NO endpoint invention,
  no scraping as production path, no fabricated credentials.

## WAVE 7 — Security passes
- semgrep (read errors), trivy fs/config, osv dependency scan, gitleaks; manual review of authz/IDOR/
  CSRF/CORS/rate-limit/admin boundaries/cookies/WebSocket auth/provider secret handling; Mimosa
  deep scan re-run (hook said scanner lacked a full verdict at push time).

## WAVE 8 — Browser QA
- Playwright: storefront (catalog/product/wallet/checkout fail-closed on empty stock), auth flows
  (telegram widget present, google hidden-until-creds, whatsapp gateway-state UX), admin flows
  (login, topups approve/reject with reviewed_by, orders reveal gate 429 path, whatsapp manager),
  mobile/iPhone viewport, RTL, dark/light, console + network capture. Regressions → tests.
- Deflake the ~7 parallel-load-flaky tests surfaced in Wave 0.

## WAVE 9 — Performance
- Only measured: bundle budgets (55 KiB gate exists), boot time, DB query hot paths, Neon cold-start
  behavior, Docker image size. LHCI already a devDependency.

## WAVE 10 — Final production verification + report
- Full verification matrix, final deploy + SHA verification, backup/restore drill check, DR doc host
  reconciliation, blockers list with exact operator actions.
