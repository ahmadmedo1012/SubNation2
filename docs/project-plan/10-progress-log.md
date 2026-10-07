# 10 — Progress Log

Append-only. One entry per verified unit of work. Times +02 (VPS local).

## 2026-10-05

- **~19:50** Mission start. Wave 0 reconstruction.
- **20:0x** Located repo `/home/rh2011/Projects/SubNation2`; SSH to VPS verified; Coolify v4.3.23
  inventoried; two app containers identified (subnation image-pull-based; openwa sha-ba6a843).
- **20:1x** Reality probes: live healthz ok / summary degraded (pre-R117 code); Google login 503
  (Firebase unconfigured); Telegram live via DB config; OpenWA `/api/sessions` = `[]`;
  `openwa_sessions` table empty; Neon counts (45 products/6 units/7 orders/17 users/3 pending topups).
- **20:2x** Discovered GitHub main 4 commits ahead (R117 by parallel agent); local repo synced to
  `ef3d0c3`; superseded local drift (duplicate 0015 + dep bumps) discarded, backup kept outside repo;
  broken `github` remote URL fixed (embedded empty password → clean URL + stored PAT).
- **20:3x** Gate suite at `ef3d0c3`: lint 0 err/89 warn; typecheck green; backend 1517 tests and
  frontend 751 tests — all pass individually; ~7 tests flaky ONLY under full parallel load (timing);
  build exit 0. Flakiness logged for Wave 8 deflake.
- **20:4x** Wave 0 artifacts written: `docs/project-graph/00–12`, `docs/project-state/
  source-of-truth.md`, `docs/project-plan/00–10`. Live frontend bundle verified: all VITE_*
  build args empty (GA/Firebase/GSC/Sentry off — matches env matrix "optional, unset").
- **20:5x** WAVE 1 execution:
  1. Old app 2 snapshot → `/data/backups/app2-*.json`; old `.env` backup →
     `/data/backups/subnation-app2-env-backup-20261005.env` (server-side only).
  2. Minted Coolify API token (Sanctum row, abilities read/write/deploy) — replaces the previous
     agent's direct-DB-write workaround; CLI config was bogus (`token: root` @localhost).
  3. Created NEW application `kjxqu3ytcnwb1btmlw56la5r` via official API
     (`POST /api/v1/applications/dockerfile`): Git source
     `https://github.com/ahmadmedo1012/SubNation2.git#main` (repo is PUBLIC — no credentials needed),
     build_pack dockerfile, `dockerfile_location=/Dockerfile`, ports 3000,
     healthcheck `/api/healthz` (30s/5s/3, start-period 150s), `include_source_commit_in_build=true`,
     auto-deploy on.
  4. Config corrections the API cannot express (documented, evidence-backed): inline `dockerfile`
     NULLed (else Coolify never clones Git) and `custom_labels` NULLed (create flow baked stale
     port-80 labels that shadowed regeneration — caused a 50 min production outage during cutover,
     root-caused via label pipeline reading + tinker probe).
  5. All 21 runtime envs migrated server-side from the old `.env` (values never left the VPS) +
     `VITE_APP_ORIGIN=https://subnation.ly` as build-time env.
  6. Dockerfile change pushed (`728b6a6`): `ARG SOURCE_COMMIT` fallback feeds `GIT_SHA` so every
     Coolify build carries the release identity automatically.
  7. Cutover: deploy → health gate → old app deleted via API. One script bug (full-vs-short SHA
     compare) briefly delayed cutover; guard worked as designed.
  8. VERIFIED LIVE: single container, image tag `kjxqu…:728b6a6a22188a4d4b5896449a5d72a1d26d915c`,
     `GIT_SHA` inside = main HEAD, `/api/healthz` ok, `/api/healthz/summary` **ok** (R117 Neon
     warmup fix active — no more degraded flap), storefront 200, catalog 200, www 200.
  9. Push→deploy automation: `manual_webhook_secret_github` set on the app (verified HMAC check in
     Coolify source), GitHub webhook `692690047` → `http://169.58.100.161:8000/webhooks/source/github/events/manual`.
     First automated deploy = this commit's push.

  Outcome: **Coolify is now the real deployment authority.** GitHub main → webhook → Coolify build →
  SHA-tagged image → healthcheck → Traefik → live SHA verifiable inside (env), outside (behavior),
  and in the Coolify deployment record. Old manual chain (image push + fake DB rows) retired.

- **21:1x–21:2x** Automated deploy verified end-to-end: the Wave-1 docs push (`d92de60`) triggered
  webhook deployment `tsis4zig` → build → rolling update → live `GIT_SHA=d92de60…`, healthz ok.
  Zero manual steps.

- **21:2x** WAVE 2 — WhatsApp operational completion:
  1. **Root cause of the WhatsApp outage found and fixed**: backend calls `http://openwa:2785`, but
     under Coolify's generated compose the gateway container's alias was its UUID only (the old
     manual compose named the service `openwa`). Added `custom_network_aliases=openwa` to the
     OpenWA app (API PATCH) → verified `openwa` resolves from the SubNation container.
  2. During the gateway redeploy Coolify's builder failed to pull the private
     `ghcr.io/.../openwa:sha-ba6a843` (denied). Image already on the VPS → applied the regenerated
     compose directly (recreated container with the alias). Two-gateways rule briefly violated by
     the leftover old container — removed immediately. **Blocker recorded**: openwa redeploys via
     Coolify need the GHCR package made public (or registry credentials).
  3. **Live contract verification** (public endpoint, no admin auth needed):
     `POST /api/auth/whatsapp/start` → `503 gateway_waking retry_after_sec=30` (cold) → backend
     auto-created session `subnation-otp` → `503 whatsapp_not_paired` (channel up, awaiting
     pairing). Exactly the documented B5-2 state machine.
  4. Restart drill: `docker restart` on the gateway → healthy in 12 s, SubNation unaffected,
     unpaired session correctly ephemeral (persistence covers PAIRED sessions via
     `openwa_sessions`). Post-restart `/start` returns the waking→not_paired sequence again.
  5. `docs/WHATSAPP_OPERATIONS.md` (R117 rewrite) already matches the new topology — pairing
     runbook (phone-code + QR) confirmed current; no doc changes needed.

  Outcome: WhatsApp channel infrastructure fully operational from the SubNation admin surface.
  **Only remaining step is operator-only: QR/phone-code pairing on a WhatsApp phone** at
  https://subnation.ly/admin/whatsapp (session `subnation-otp` already created).

- **22:0x–23:0x** WAVES 3–8 executed (details in `docs/project-state/wave-345-audit.md` and
  `docs/project-state/embronic-adapter-design.md`):
  - W3: provider boundary verified coherent — no cleanup needed; Embronic design prepared.
  - W4: no manual provider-selection UI exists (env-driven); inventory upload confirmed as the
    stopgap supply model with the provider-migration boundary documented.
  - W5: full Google/Firebase/tracking matrix verified; dead-code list recorded; enablement gated
    on operator creds only.
  - W7: Mimosa deep scan (115 candidate hypotheses, all inconclusive-static, triaged); Semgrep
    (10 ERRORs = test fixtures; 2 real findings — GCM tag length FIXED with strict 128-bit
    validation, risk-dsl readPath triaged admin-only); Trivy prod vulns 35→11 (one HIGH: node-forge,
    no upstream fix); OSV 113→75 via lockfile overrides (protobufjs 7.6.6, busboy 3.2.2,
    ws≥8.21.0, brace-expansion 2.1.7). First hardened deploy failed on
    ERR_PNPM_OUTDATED_LOCKFILE (backend/package.json specifier not committed with the lockfile) —
    root-caused, fixed, redeployed.
  - W8: Playwright QA on production — home/catalog/product/login/admin-login, desktop + iPhone
    viewport, RTL + light/dark: zero unexpected console errors, zero failed requests; WhatsApp
    UI flow verified end-to-end (honest `recipient_not_on_whatsapp` verdict for a fake number);
    product page correctly auth-gates purchase for anonymous users.
  - W9: no new measured problems — bundle budget gate green (entry 9.5 KB gzip vs 55 KB limit),
    healthz fast, R116/R117 already optimized. Recorded no-action.
  - W10: final state — live SHA `3f1dc2b` (main HEAD), single container healthy, summary `ok`.

  One production incident during the session (cutover domain/label race, ~50 min, root-caused:
  baked stale custom_labels + ports_exposes reset by the create flow) — fixed, documented, and
  the pipeline now regenerates labels from ports_exposes on every deploy.




## 2026-10-06/07 — R118 line landed + merge 966d70f + R119 (append-only record)

- **2026-10-06** The R118 audit round (the parallel line this mission's Wave 0 noted as "4 commits
  ahead") landed on main and grew: `427aa47` (money-contract + crypto v2 + perf + Drizzle mirror
  guards incl. migration `0016`) · `90ac9a6` (buyer decrypt honesty + UX fixes) · `151b87d` (R118
  docs truth pass + 6 new ops docs + audit reports) — plus `c37ddd5` on this mission line
  (auth-providers 60s cache) as the waves-line tip.
- **2026-10-06** Merge `966d70f` unified both lines: `encryption.ts` kept R118 crypto v2 as the
  superset and ported the W7 strict 128-bit GCM auth-tag check into `decryptSegments` (single funnel
  for all three decrypt paths); README status unified; two latent type errors fixed
  (auth-settings middleware express type imports; nullable `message` column type in
  admin-credentials-gate-alert.test.ts); `render.yaml`/`vercel.json` deletions ratified.
- **2026-10-06 17:23:48Z** Merge pushed to GitHub (`pushed_at` 2026-10-06T17:23:48Z) → push-to-deploy
  webhook fired → production updated. Live `/api/healthz` + `/api/healthz/summary` → `{"status":"ok"}`
  (probed 2026-10-07; neither endpoint exposes the SHA — verify the live `GIT_SHA` in the Coolify
  dashboard / container env, not from healthz).
- **Gates on the merged tree (re-verified 2026-10-07, R119):** backend 188 files / 1697 tests PASS;
  frontend 111 files / 770 tests PASS; lint 0 errors / 90 warnings; typecheck clean; build in budget.
- **Main HEAD is now `966d70f`+.** The W10 entry above ("live SHA `3f1dc2b` = main HEAD") records the
  pre-R118 state and is superseded by this entry.
- **2026-10-07** R119-B4 docs truth pass over the `project-*` trees (this file, the graphs, the
  plans, `source-of-truth.md`): all discrepancies from the merge recorded in
  `docs/project-state/source-of-truth.md` "Known contradictions" #7. Stale `03-deployment.mmd`
  (pre-Wave-1 panel) deleted; `03-deployment-target.mmd` retitled as the CURRENT deployment map.
- **2026-10-07** **Round R120 — full-spectrum product excellence** (8 auditors → 129 findings; 6 fix
  agents → ~70 closed). Commits `5d2de5b` (SEO P1 trio: category/flash-sales seoBlock wiring, public
  /support FAQ, per-route server-side shell canonical/title/description rewrite + dead-slug 404 +
  auth-family noindex), `c3965f0` (storefront: card chrome 1.05:1→readable + persistent desktop
  quick-add + available-first grid + mobile fold 915→~685px + guest bottom nav + cart tab +
  sold-out cards navigate + Button-in-Link nesting eliminated + input border 3:1 + confirm focus
  return), `99ac56e` (admin: coupons nav scope finance, products honest counts + server search,
  global open-tickets badge, finance-gated money UI, security-tab facts, alerts delete confirm),
  `4ae5de5` (loyalty/referrals unified cache identity, tickets infinite-query idiom, eager-path
  bundle gate 152,460 B gz warn/160 KiB fail), `63ae271` (backend: user money-history pagination,
  auth-probe fail-closed, indexes drizzle 0017 + boot V1-M24, CreateOrderBody int/min-1 +
  regenerated zod, admin-tail zod, enrichment 16k cap, OTP daily ceiling, Dockerfile digest pin).
- **2026-10-07** R120 hotfix `d22f24e` — **found by verifying production post-deploy**: the shell
  rewriter paired the V3-A1 comment's `<title>` prose with the real `</title>`, eating the canonical
  + og set and leaving a comment unclosed (9 `<!--` vs 8 `-->` on /category/*). `rewriteOutsideComments()`
  makes every tag surgery comment-blind; pinned by 3 regression tests; verified against the real
  dist shell + live. This is the deploy→verify→fix loop working as designed.
- **R120 gates (full tree):** backend 199 files / 1776 tests PASS (+72); frontend 119 / 829 PASS
  (+59); typecheck clean; lint 0 errors / 84 warnings (−6); build + both budget gates PASS
  (entry 27,723 B gz; eager path 152,460 B gz = warn zone, 11.4 KiB headroom); frozen lockfile OK;
  `pnpm audit --prod` 9 (accepted register unchanged). Live-verified: category title/description
  rewrite, dead product slug → 404, /support 200 anonymous, /login noindex, unknown paths
  canonical-free. Round reports + deferred-items ledger: `tool-results/r120-*.md` (session-local,
  not in the repo) — headline deferred: www→apex 301 + http 301 (edge action), VITE_SENTRY_DSN +
  VITE_GSC_VERIFICATION unset (operator actions), 14 >1,000-line component extractions, CSS
  admin-share split, A6-F2/F9/F10.
- **2026-10-07** **Round R121 — broken-admin revival + Telegram ops channel + edge canonicalization**
  (live browser audit of all 20 admin pages as the trigger, minted session, revoked after).
  Commit `b5c9151`: (1) `/admin/products/enrichment` + `/admin/risk/events/:id` rendered the PUBLIC
  404 — the top-level dispatch used `/admin/:rest*`, which regexparam 3 parses as a single segment
  (`[^/]+?`); nested paths fell through to the storefront NotFound. Bare `/admin/*` is the true
  multi-segment splat (verified against regexparam 3.0.0's parser). (2) `/admin/system` hit the
  error boundary — the metrics endpoint wraps its snapshot in a last-known-good envelope
  (`{ value, lastKnownGoodAt, stale }`) while the page read the flat shape; query now unwraps and
  treats `value:null` as an honest error state. Post-deploy re-audit: all 20 admin pages render,
  400s from the cold-start settle window gone.
- **2026-10-07** R121 ops channel — Telegram notifications + topup approval cards came alive:
  `TELEGRAM_BOT_TOKEN` (login-bot reuse from `system_settings:auth.telegram`) +
  `TELEGRAM_WEBHOOK_SECRET` (generated) + `TELEGRAM_CHAT_ID`/`TELEGRAM_ADMIN_IDS` (operator) set in
  Coolify; webhook re-registered WITH the secret (was 403-ing every delivery since R98). Verified
  end-to-end via the app's own diagnostic: `/api/admin/diagnostics/telegram-test` →
  `{configured:true, delivered:true, attempts:1}`.
- **2026-10-07** R121 edge — www→apex 308 at the Traefik file-provider layer
  (`/data/coolify/proxy/dynamic/www-redirect.yml`, priority 1000, apex untouched). Found + fixed a
  latent poisoning: the dead v2-syntax `subnation.yml` errored on every watcher callback and
  blocked the whole dynamic directory; archived with its 4 backup variants to
  `dynamic-archive/`. Live probes: https://www → 308 https://apex (query preserved), apex 200,
  all 12 routers enabled.
- **R121 deferred (human-only blockers):** Sentry — org `subnation` has NO project; the provided
  CLI token is scoped `org:ci` (releases only, cannot create projects or read DSNs). Unblocks the
  moment either the project exists + DSN is pasted (→ `VITE_SENTRY_DSN` build arg + `SENTRY_DSN`
  runtime) or a full-scope token is issued (release + sourcemap pipeline then runs unattended).
  GSC `VITE_GSC_VERIFICATION` still needs the operator's Search Console token.
