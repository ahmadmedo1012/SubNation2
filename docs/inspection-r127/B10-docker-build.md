# R127-B10 — Docker / Build Audit

> Agent: R127-B10 (read-only auditor) · Date: 2026-10-09 · Tree: `f53a886`
> (production https://subnation.ly runs exactly this commit via this Dockerfile).
> Scope: Dockerfile, docker-compose.yml, .dockerignore, build-stage plumbing
> (backend/build.mjs, vite outDir), runtime entry (server.ts), Coolify
> integration, reproducibility. Lens: gstack CSO Phase-5 checklist (shadow
> surface, secrets, USER, layers) + deploy-time gates.
> Method: **static analysis only** — no image build (constraint honored). Two
> read-only network probes: (1) Docker Hub registry HEAD for `node:22-alpine`
> digest-drift check, (2) Coolify main-branch `StopApplication.php` fetch for
> the redeploy stop-timeout mechanism. Local tree measurements via `du`.

---

## 1. Verdicts at a glance

| Check (CSO Phase-5 lens) | Verdict | Evidence |
|---|---|---|
| Base image tag pinning | **PASS (exemplary)** | Dockerfile:36 digest-pinned manifest list; re-verified live today — current `node:22-alpine` digest **==** pinned `sha256:0a7108bf…e402` (no drift, 2026-10-09). Both FROMs resolve via `${NODE_VERSION}` (:39, :194) → identical by construction |
| Multi-stage (builder vs runner) | **PASS** | `deps` → `build` → `runtime`; runtime gets manifests + built artifacts only (:216-222) |
| Layer ordering / cache efficiency | **PASS in deps, MISS in runtime** | Deps stage copies manifests before source (:42-52, cache-mounted pnpm store); runtime stage copies source trees BEFORE its prod install (:216-235) → install layer invalidated every source change (F2) |
| `pnpm fetch` usage | Not used (by design) | Cache-mount + `--frozen-lockfile` serves the same purpose; store never enters a layer |
| Dev-deps pruning in runner | **PASS** | `pnpm install --frozen-lockfile --prod --ignore-scripts --filter @workspace/api-server…` (:233-234); root devDeps (eslint/husky/@lhci) absent; `@electric-sql/pglite` is a devDep → never in the runtime image |
| Non-root USER | **PASS** | `USER node` (Dockerfile:242, UID 1000); all COPYs `--chown=node:node`; post-install `chown -R node:node /app` inside the same RUN (:235) — no copy-up duplication; docker-verify gate 6 asserts it |
| HEALTHCHECK present | **PASS** | :252-253 `wget -qO- http://127.0.0.1:${PORT}/api/healthz`, 30s/5s/150s/3retries; compose mirrors it (compose:133-138) |
| tini/dumb-init as PID1 | **Not needed — node is PID1 with zero child processes** | CMD exec-form runs node directly (:264, FH-A3 F-3). Only `child_process` reference in backend runtime is a comment in `instrument.ts:5` about Sentry patching; `execSync` exists only in build-time `build.mjs:4`. pino/thread-stream use worker **threads**, argon2/firebase-admin load prebuilt `.node` binaries → no zombies to reap. |
| Node memory / UV flags | **NOT SET (F5)** | No `NODE_OPTIONS`/`--max-old-space-size` in image or compose; `UV_THREADPOOL_SIZE` untouched (default 4 — fine for this pg+TLS load); no mem limits anywhere |
| .dockerignore coverage | **PASS** | `.git`, `**/node_modules`, `**/dist`, `**/.env*` (nested too, FH-A6), `.secrets`, `**/backups/`, `docs`, `specs`, `*.md`, `.gitleaks.toml` — nothing secret or doc-shaped enters the context; runtime COPYs further narrow to backend + frontend/dist + shared |
| Secrets baked into layers | **PASS — none found (§3)** | Runtime reads secrets from env only; docker-verify gate 6 asserts image ENV secret-free |
| Express bind | **PASS** | `httpServer.listen(port)` with no host (server.ts:167) → binds all interfaces inside the container only; compose publishes `127.0.0.1:3000` (compose:119); Coolify path publishes nothing (Traefik owns 80/443) |
| Readiness/liveness split | **PASS** | Port binds first, `/api/healthz` → 503 `{"status":"starting"}` until bootReady (server.ts:71,121-123); static/SPA shell passes the gate instantly (:125-128); deep `/healthz/*` routes are settings-scope gated (R122 A5-P2, known); `Retry-After: 3` on gated 503s (:120) |
| Graceful shutdown on SIGTERM | **PASS in-app; ONE deployment-path gap (F1)** | Full drain choreography (server.ts:278-366) incl. idle-keep-alive sweeper for Traefik-pooled connections, both pools, Sentry flush, force-exit 25s < compose 40s. But the Coolify production path's stop timeout is a **Coolify per-resource setting**, not the repo compose's `stop_grace_period` — unverified/undocumented (F1) |

---

## 2. Dockerfile line-by-line (condensed)

| Lines | What | Assessment |
|---|---|---|
| 1 | `# syntax=docker/dockerfile:1.7` | Frontend features (cache mounts) require BuildKit — Coolify's builder uses it; fine |
| 9-36 | Digest-pinned base + documented bump procedure | Verified current today; both stages share `${NODE_VERSION}` |
| 39-52 | deps: manifests-then-install, cache mount | Textbook ordering; `--frozen-lockfile` |
| 54-57 | build stage `COPY . .` | Context is filtered by .dockerignore; single broad COPY here is acceptable since the previous layer is manifest-only (install cache survives source churn) |
| 59-145 | VITE_* ARG/ENV plumbing | All public-by-design values (DSN, GA, Firebase web config); kept in sync with compose args (:95-107) + Coolify panel — **except** `VITE_APP_VERSION` and the SENTRY trio (F6) |
| 172 | `RUN pnpm run typecheck` | Deploy-time gate (R122 A9-P0-2, known) — correct defense given Coolify's webhook fires before CI reports |
| 174-191 | Release identity + Sentry sourcemap upload | `VITE_RELEASE_SHA="${GIT_SHA:-${SOURCE_COMMIT:-${VITE_RELEASE_SHA}}}"` — precedence correct; maps uploaded then stripped (build.mjs:196-256, FH-A3 F-2, known) |
| 193-214 | runtime stage ENV (`NODE_ENV=production PORT=8080 FRONTEND_DIST=/app/frontend/dist/public TZ=UTC GIT_SHA=…`) | `TZ=UTC` belt+braces for cron slots (F6/round-94 A6, known); `corepack enable` needed for the install RUN only |
| 216-222 | COPY --from=build (manifests, backend, frontend/dist, shared) | Ships TS sources + tests (F3); `worker.mjs` (~5.5MB) rides unused — see F3 |
| 224-235 | prod install + `chown -R` in one RUN | `--ignore-scripts` (R109 P0-1, known); single-RUN chown avoids overlayfs copy-up duplication |
| 237-242 | `USER node` | Known/deliberate (F-011) |
| 244-253 | EXPOSE + HEALTHCHECK | start-period 150s covers boot migrations + cold Neon (bounded 120s write-wait) |
| 255-264 | Boot-order comment + `CMD ["node","--enable-source-maps","backend/dist/index.mjs"]` | Migrations run inside the app behind the readiness gate; node = PID1 (FH-A3 F-3, known) |

## 3. Secrets & shadow surface

**Secrets — no leaks found (confidence 5):**
- Build ARGs are exclusively public/non-secret: `VITE_*` (DSN, GA id, Firebase web config — public-by-design), `GIT_SHA`, `SOURCE_COMMIT`, `RENDER_GIT_COMMIT`. The one secret-shaped ARG, `SENTRY_AUTH_TOKEN` (:184), is (a) never given a non-empty default, (b) consumed only inline in a RUN of the **discarded build stage** (:187-191), never re-exported as ENV, (c) never present in the runtime stage, which declares only `GIT_SHA`/`SOURCE_COMMIT` (:198-199). BuildKit does not persist ARG values into the image config. `build.mjs` never echoes the token (prints only the release id, :222).
- `.dockerignore` blocks every secret-shaped path: `.env*` + `**/.env*` (nested, FH-A6 P2-2), `.secrets`, `**/backups/` (DB dumps), plus `.git`. `config/env.example` and `deploy/env.compose.example` (placeholder templates) enter the build stage context but are **never copied into the runtime image** — runtime COPYs cover only backend/, frontend/dist, shared/, root manifests.
- Runtime reads all secrets from environment (Coolify env panel / compose env_file); server.ts fail-fast asserts (`assertEncryptionKeyConfigured` :208, SESSION/ADMIN_JWT in libs) prove boot depends on injected env, not files. docker-verify gate 6 enforces image-ENV secret-freeness on any machine that runs it.

**Shadow surface (what actually ships in the runtime image):** node 22-alpine runtime + prod node_modules for api-server closure + `backend/` (dist bundle ~8.4MB + **src 5.5MB + tests 24K** + configs) + `frontend/dist` (4.0MB) + `shared/` (**5.6MB TS sources** + d.ts artifacts) + ~44MB of dead corepack/pnpm cache under `/root/.cache/node/corepack` (F4) + root manifests. Sources are inert (the esbuild bundle inlines all `@workspace/*` code — build.mjs:100-172 externalizes only natives/firebase-admin/@grpc etc.) and shipping them is a **documented deliberate trade-off** (Dockerfile:168-171) — but `backend/tests` was never part of that rationale and `worker.mjs` serves no live role (F3).

## 4. docker-compose.yml (local/bare-VM contract — correctly NOT the production path)

- Service shape: 2 services (`subnation` build-from-repo, `openwa` build-from-sibling/GHCR); header (R112) declares the authoritative production strategy — Coolify builds the repo Dockerfile; compose is local-only. No conflict with Coolify.
- Restart `unless-stopped` both; log ceilings 10m×3 both (FH-A8 F1, known); healthchecks mirror the image's; ports default to **127.0.0.1-only** host bindings (`127.0.0.1:3000:8080`, `127.0.0.1:3001:2785`) with documented Coolify adjustment note (:61-67).
- Volumes: only `openwa-data:/data` (Baileys hot auth folder — documented defense-in-depth; Neon is source of truth). `subnation` has **no volume — correct**: sessions live in Neon, no sqlite/session files exist (sqlite appears only as esbuild external names + PGLite is a test-only devDep). No host path mounts anywhere.
- openwa env narrowed to its exact read-set (FH-A2 P2-1, known); subnation keeps full `.env` env_file — documented deliberate (:159-160) (compose-path-only exposure; Coolify env panel is per-resource).
- Gaps: no resource limits (folded into F5); `stop_grace_period: 40s` (:130) is real but only governs `docker compose`/bare-VM stops (F1).

## 5. Coolify integration

- Build args: Coolify passes `GIT_SHA` (per-resource, operator-entered) and optionally `SOURCE_COMMIT` (`include_source_commit_in_build`); Dockerfile consumes both with correct precedence (:122-126, :187, :198-204). `.version` in `/api/healthz` closes the loop (deployed-SHA gate, COOLIFY_FINAL_SETUP §8).
- Healthcheck: Coolify reads the image HEALTHCHECK (start-period 150s matches its boot budget); setup doc §4 documents the panel values — consistent.
- **Stop-timeout mechanism (verified against Coolify main source, fetched 2026-10-09)** — `app/Actions/Application/StopApplication.php`:
  ```php
  $timeout = $application->settings->stopGracePeriodSeconds();
  … $commands = [dockerStopCommand($timeout, $escapedContainerName, $server)];
  ```
  Coolify stops app containers on redeploy via an explicit `docker stop --time <per-app setting>` — the repo compose's `stop_grace_period: 40s` is **never read by the Coolify Docker-build-pack resource** (Coolify generates its own runtime config from the Dockerfile). Neither COOLIFY_FINAL_SETUP.md nor CONTABO_COOLIFY_OPERATIONS.md mentions setting or verifying the resource's grace value → F1.
- Image-size reduction opportunities with estimated savings (image cannot be built here — estimates from local-tree measurements):
  1. **~44MB**: remove the corepack/pnpm download residue (`/root/.cache/node/corepack`) from the runtime layer (F4) — measured 44M for pnpm 10.17.0 in this sandbox.
  2. **~11MB + surface**: stop shipping `backend/src` (5.5M), `backend/tests` (24K), `shared/` TS sources (5.6M) — keep workspace package.jsons for pnpm linking (F3). Optionally also `backend/dist/worker.mjs` (5.5M) — unused in the single-container shape (WORKER_TIER unset; `start:worker` never run).
  3. No base change recommended: node:22-alpine is already minimal; slim/distroless saves little at the cost of the busybox `wget` the HEALTHCHECK uses.
  - Combined ≈ **50-60MB off an estimated ~350-450MB image (≈12-15%)** plus a smaller disclosure/attack surface.

## 6. Build reproducibility & version consistency

- **Same-SHA-twice verdict: content-reproducible** (confidence 4). Lockfile `--frozen-lockfile` + pnpm integrity hashes pin every tarball byte; base is digest-pinned (re-verified current today); no `apk add` anywhere (zero distro package drift); Vite assets are content-hashed; maps stripped unconditionally. Residual non-determinism is image **metadata** only (created timestamps), plus the documented deliberate-digest-bump path.
- Node: Docker digest pins an exact 22.x; CI `setup-node` node-version: 22 **floats the 22.x minor** (ci.yml:201,274); `.nvmrc` = 22 (floats locally); `engines.node >=22` (sandbox runs node 24 locally — stricter than prod). Minor CI-vs-image drift is possible but benign (typecheck/build results at a different 22.x patch); note only.
- pnpm: `packageManager: "pnpm@10.17.0"` (package.json:24) + `corepack enable` in BOTH Docker stages + CI `pnpm/action-setup` reading the same field → **10.17.0 everywhere, by construction**. Consistent.
- `minimumReleaseAge: 1440` (.npmrc/pnpm-workspace.yaml) applies to fresh publishes only — a lockfile-pinned rebuild is unaffected (all deps already aged or allowlisted). Correct.

## 7. Runtime hardening (server.ts)

- Bind: `listen(port)` on all container interfaces (server.ts:167) — correct behind Traefik; production publishes no host port.
- Timeouts: `requestTimeout 60s / headersTimeout 65s / keepAliveTimeout 61s` (:158-164) — the 61s keep-alive is deliberately above Traefik's reuse window (close-race guard).
- Readiness: early-bind gate + 503-with-`Retry-After` + static-pass-through (R104 AG6-2/AG6-5, known); boot migrations refuse-to-serve-on-half-schema (P0-4 posture).
- Drain order on SIGTERM/SIGINT (:278-366): scheduler stop → idle-keep-alive evict **first** + 2s sweeper (Traefik-pooled-connection deadlock fix, R107 migration P1) → Socket.IO close → `httpServer.close()` → `pool.end()` + `lockPool.end()` → Sentry flush → exit(0), with a `GRACEFUL_SHUTDOWN_TIMEOUT_MS`=25s force-exit (:48-51) kept under the 40s compose grace. SW-aware users: the drain drops WS clients cleanly; redeploy gap is the documented single-replica trade-off (offline shell serves from precache during the window).
- Worker-sigterm behavior is pinned by `backend/tests/worker-sigterm.test.ts`.

## 8. Findings (P0–P3)

**P0: 0 · P1: 0 · P2: 1 · P3: 5**

### B10-F1 (P2, confidence 3) — Coolify redeploy stop-timeout is governed outside the repo; the documented 40s drain guarantee has no verified production counterpart
- Verbatim: docker-compose.yml:69-73 — "`stop_grace_period` is intentionally ABOVE each app's internal drain budget (subnation 25 s …) so `docker compose down` / Coolify redeploys let the app exit cleanly"; Dockerfile:246-251 — "Set the Docker/ Coolify stop grace ABOVE this value".
- Reality: the production resource (Coolify Docker build pack) never reads this compose file. Coolify stops containers on redeploy via `docker stop --time <application.settings.stopGracePeriodSeconds()>` (StopApplication.php, main branch, fetched 2026-10-09). If that per-resource setting is below ~25s (docker's own `docker stop` default is 10s), **every production redeploy SIGKILLs mid-drain** — skipping `pool.end()`, `lockPool.end()` and the Sentry flush the docs promise. Neither COOLIFY_FINAL_SETUP.md §4 nor CONTABO_COOLIFY_OPERATIONS.md records the setting.
- Fix directive: (1) On the VM: `docker inspect <subnation-container>` won't show it — check the Coolify resource's Advanced/Stop-grace panel; set it to **40s** (mirror compose). (2) Add a line to COOLIFY_FINAL_SETUP.md §4: "Stop grace period (Coolify per-resource setting): 40s — the repo compose's `stop_grace_period` does not apply to this resource." (3) Optionally extend docker-verify.sh gate 10 with a `docker stop -t 10` sub-gate documenting the failure mode.

### B10-F2 (P3, confidence 4) — Runtime-stage prod-install layer invalidated by source changes (cache-efficiency)
- Verbatim (Dockerfile:216-235): the four source COPYs (`/app/backend`, `/app/frontend/dist`, `/app/shared`) precede `RUN --mount=type=cache,id=pnpm,… pnpm install --frozen-lockfile --prod …`. Any source edit changes the COPY layers → the prod install re-runs every deploy (re-link of node_modules; the cache mount saves the download, not the link/verify).
- Fix directive: mirror the deps-stage pattern — copy only `package.json`+`pnpm-workspace.yaml`+`pnpm-lock.yaml`+`.npmrc`+ all workspace `package.json`s (incl. `frontend/`+`scripts/` — pnpm must parse the whole workspace to resolve the filter), RUN the prod install, then COPY the source trees. Deploy-time saving ≈ 30-60s per rebuild.

### B10-F3 (P3, confidence 4) — Shadow surface: `backend/tests` + TS sources ship in the production image; `worker.mjs` rides unused
- Verbatim (Dockerfile:168-171): "they ride the runtime `COPY /app/shared` as inert type-only files (exports resolve to src/*.ts) — harmless next to the full TS sources that copy already ships." — the shared-sources trade-off is documented, but `backend/tests` was never argued, and the esbuild bundle inlines every `@workspace/*` import (build.mjs:100-172), so runtime only needs workspace `package.json`s for pnpm linking. Also `backend/dist/worker.mjs` (5.5MB local build) ships with no live role (`WORKER_TIER` unset, no worker container; ENVIRONMENT_MATRIX: "no worker tier exists").
- Fix directive: (a) `.dockerignore` += `backend/tests` (zero risk — the image never runs vitest); (b) trial: replace `COPY --from=build /app/shared ./shared` with manifest-only copies (+ keep `shared/db/drizzle` only if a booted container ever touches it — migrate.ts SQL is bundled, fingerprint computed at build time) and drop `backend/src`+`dist/worker.mjs`; verify with `scripts/docker-verify.sh` gates 3/5/9/10 before landing. Est. ~11MB (a+b sans worker) + ~5.5MB (worker.mjs).

### B10-F4 (P3, confidence 4) — ~44MB dead corepack/pnpm cache baked into the runtime layer
- Verbatim (Dockerfile:214): `RUN corepack enable` then (:233) the pnpm install RUN — corepack downloads pnpm@10.17.0 into `/root/.cache/node/corepack` (44M measured in this sandbox for pnpm 10.17.0). After `USER node` it is unreadable, and the CMD invokes node directly (:259-264) — it is pure dead weight in every pull.
- Fix directive: append to the install RUN (same layer): `&& rm -rf /root/.cache/node/corepack` — or `ENV COREPACK_HOME=/corepack-cache` + cleanup, keeping the documented F-3 invariant (no start-time re-download; CMD bypasses pnpm anyway).

### B10-F5 (P3, confidence 3) — No memory bound anywhere: no `--max-old-space-size`, no compose `deploy.resources`/`mem_limit`, no Coolify limit on record
- Verbatim (Dockerfile:200-204): the runtime ENV block sets `NODE_ENV/PORT/FRONTEND_DIST/TZ/GIT_SHA` — nothing bounds the heap; docker-compose.yml has no resources block (only restart/logging/healthcheck/stop_grace).
- On a co-tenanted Contabo VM (Coolify + Traefik + coolify-db + openwa + app; VM shape still unrecorded — R118-A7 F10, known), an app leak's blast radius is the whole VM (OOM killer picks any victim).
- Fix directive: once the plan is recorded (F10), set the Coolify per-resource memory limit and `ENV NODE_OPTIONS=--max-old-space-size=<sized>` (512m is a sane starting ceiling for this Express+Socket.IO workload at current traffic); leave `UV_THREADPOOL_SIZE` at default.

### B10-F6 (P3, confidence 4, doc-sync) — Build-arg contract drift: `VITE_APP_VERSION` + SENTRY trio consumed by the Dockerfile but absent from every documented pass-through path
- Verbatim: Dockerfile:99 `ARG VITE_APP_VERSION=""` and :184-186 `ARG SENTRY_AUTH_TOKEN="" / SENTRY_ORG="" / SENTRY_PROJECT=""`; COOLIFY_FINAL_SETUP.md §2.2: "the Dockerfile consumes ONLY these ARGs" (list omits both); docker-compose.yml build args (:84-107) pass neither.
- Consequence: `VITE_APP_VERSION` has a live reader (`frontend/src/instrument.ts:78`, fallback) but resolves empty in every real deployment path; the R121 sourcemap upload path works only if the operator knows to add the SENTRY trio to the Coolify build-args panel — the setup doc never says so.
- Fix directive: add `VITE_APP_VERSION` (optional) and a "sourcemap uploads (optional, secret-bearing): SENTRY_AUTH_TOKEN/ORG/PROJECT" note to COOLIFY_FINAL_SETUP §2.2 (with the secret-passes-through-build-args caveat the Dockerfile itself already documents at :181-183); mirror `VITE_APP_VERSION` in compose args.

## 9. Known-items pointer table (verified current, NOT re-reported)

| Known item | Where | Status at f53a886 |
|---|---|---|
| Digest-pinned base + bump procedure (R120-B6/A8-F2) | Dockerfile:9-36 | Verified live-current today (no drift) |
| Deploy-time typecheck gate (R122 A9-P0-2) | Dockerfile:172 | Present |
| husky `--ignore-scripts` prod-install fix (R109 P0-1) | Dockerfile:224-235 | Present |
| `USER node` non-root (F-011 security audit 004) | Dockerfile:237-242 | Present + verified by harness gate 6 |
| node-as-PID1 direct CMD (FH-A3 F-3) | Dockerfile:259-264 | Present; no child procs → tini unnecessary |
| Sourcemap emit-gating + unconditional strip (FH-A3 F-2) | build.mjs:173-178, 237-256 | Present |
| Nested `.env*`/`.secrets`/backups context exclusion (FH-A6 P2-2/P3-1, r110) | .dockerignore:24-42 | Present |
| docs/specs/`*.md` context exclusion (R104 AG12-7) | .dockerignore:53-62 | Present |
| Log ceilings 10m×3 (FH-A8 F1) | compose:121-129, 185-190 | Present |
| `SOURCE_COMMIT` Coolify passthrough (R119 A7-F4) | Dockerfile:123-126, compose:87-92 | Present |
| Missing-VITE-ARG fix history (R99-A3 P1/P3, 99-C1/C7, 110-I) | Dockerfile:83-108 | Present (residual drift → F6) |
| Deep `/healthz/*` settings-scope gating (R122 A5-P2) | routes/health.ts | Present |
| openwa env read-set narrowing (FH-A2 P2-1); subnation full env_file deliberate | compose:152-176, :159-160 | Present (documented) |
| One-replica rule / SINGLE_INSTANCE_MODE (R108) | compose header, ENVIRONMENT_MATRIX §2 | Present |
| GHCR `subnation2` fallback package unpublished (r113 pending) | compose:31-38, COOLIFY_FINAL_SETUP §2.2 | Still pending (docker.yml manual-first) |
| VM shape unrecorded (R118-A7 F10) | CONTABO_COOLIFY_OPERATIONS §1 | Still open (blocks F5 sizing) |
| Overrides single-home + security floors (R119-B3) | pnpm-workspace.yaml:65-156 | Present; all lockfile-pinned → reproducible installs |

## 10. Next actions (ordered)

1. **F1** — verify/set the Coolify SubNation resource stop-grace to 40s; document it in COOLIFY_FINAL_SETUP.md §4 (2 minutes on the VM; the only P2).
2. **F4** — one-line `rm -rf /root/.cache/node/corepack` in the runtime install RUN (~44MB off every pull).
3. **F3** — `.dockerignore += backend/tests` now; source/`worker.mjs` trim behind a docker-verify-gated trial.
4. **F2** — manifest-first runtime install ordering (deploy-minute savings).
5. **F5** — after the operator records the Contabo plan (F10), set memory limit + heap ceiling.
6. **F6** — sync COOLIFY_FINAL_SETUP §2.2 + compose args with the Dockerfile's full ARG surface.
