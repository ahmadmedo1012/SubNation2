# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# SubNation - single-image production build.
# The backend serves both the JSON API and the built frontend on the same
# origin, so no reverse proxy is required. Configure at runtime via env vars
# (see config/env.example).
# -----------------------------------------------------------------------------

# R120-B6/A8-F2: digest-pinned node base. `22-alpine` alone is a FLOATING
# tag — every Coolify rebuild resolved whatever the tag pointed at THAT
# day, so the same commit could build on two different base images (and a
# compromised/retagged upstream would flow in silently on the next
# redeploy). The @sha256 digest pins the exact multi-arch manifest list;
# both FROM lines below resolve through ${NODE_VERSION} so they stay
# identical by construction.
#
# ── Deliberate-bump procedure (mirrors how pnpm-workspace.yaml overrides
#    are maintained — a pinned upstream is only as good as its documented
#    refresh path) ──
#
#   1. Fetch the CURRENT digest of the tag you want (both must agree):
#        TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull" | sed -E 's/.*"token":"([^"]+)".*/\1/')
#        curl -sI -H "Authorization: Bearer $TOKEN" \
#          -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
#          https://registry-1.docker.io/v2/library/node/manifests/22-alpine | grep -i docker-content-digest
#      (fallback: https://hub.docker.com/v2/repositories/library/node/tags/22-alpine —
#       the JSON `digest` field is the same manifest-list digest)
#   2. Replace the digest below and note the reason + date in this
#      comment block (node LTS patch, CVE, arch fix) — e.g.
#      "bumped 2026-10-07: node 22.x.x security release".
#   3. Rebuild via scripts/docker-verify.sh (or docker compose build) —
#      the digest changes only when upstream actually republishes the tag.
#
# Pinned 2026-10-07 (R120-B6): node 22-alpine manifest list as resolved by
# registry-1.docker.io (cross-checked against hub.docker.com's tag digest).
ARG NODE_VERSION=22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

# --- deps: install the full pnpm workspace with dev dependencies --------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json tsconfig.json ./
COPY backend/package.json        backend/package.json
COPY frontend/package.json       frontend/package.json
COPY scripts/package.json        scripts/package.json
COPY shared/api-client-react/package.json shared/api-client-react/package.json
COPY shared/api-zod/package.json          shared/api-zod/package.json
COPY shared/api-spec/package.json         shared/api-spec/package.json
COPY shared/db/package.json               shared/db/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- build: typecheck + build backend and frontend ----------------------------
FROM deps AS build
WORKDIR /app
COPY . .

# -----------------------------------------------------------------------------
# Vite build-time env injection.
#
# Vite replaces `import.meta.env.VITE_*` references in source code at BUILD
# time, not at runtime. Docker builds run inside a fresh container where
# service-level environment variables (Coolify env / compose .env) are NOT
# automatically in the shell environment — they have to be declared as `ARG`
# here, then re-exposed as `ENV` so `pnpm run build` can read them.
#
# Without this block, `import.meta.env.VITE_SENTRY_DSN` resolved to `undefined`
# in the production bundle and `Sentry.init({ dsn: undefined })` was a silent
# no-op. Same problem affected every VITE_* var: Firebase config, Google
# client ID, app origin, etc.
#
# IMPORTANT: keep this list in sync with the VITE_* build args in
# docker-compose.yml (the compose/local path) and the Coolify build-args
# panel (the production path — docs/deployment/COOLIFY_FINAL_SETUP.md §2.2).
# (render.yaml was removed 2026-10-05 — Vercel/Render fully retired; historical
# comment references below were written when it existed.)
# Adding a new VITE_* env var without listing it here means production code
# will see `undefined` even though the platform has the value set.
# -----------------------------------------------------------------------------
ARG VITE_SENTRY_DSN=""
ARG VITE_API_URL=""
# 99-C1 (R99-A3 P1): the three VITE_* keys render.yaml sets but the ARG
# list never declared — Vite saw `undefined` for them at build time, so
# VITE_GA_TRACKING_ID (analytics) was silently dead on the Render bundle
# and any operator override of the API base/socket URL was swallowed.
ARG VITE_API_BASE_URL=""
ARG VITE_SOCKET_URL=""
ARG VITE_GA_TRACKING_ID=""
ARG VITE_APP_ORIGIN=""
# 99-C7 (R99-A3 P3): VITE_APP_NAME + VITE_FIREBASE_DATABASE_URL removed —
# zero readers in the frontend (grep: import.meta.env never touches them;
# firebase.ts passes no databaseURL). Dead declarations invite drift.
# 110-I (R109 109-p P3): VITE_FIREBASE_MEASUREMENT_ID removed for the same
# reason — firebase.ts never initializes analytics, so zero import.meta.env
# readers exist (r98 deadcode audit; re-verified r110). render.yaml no longer
# lists it either; the stale env.example/ENVIRONMENT_MATRIX.md entries belong
# to the env-matrix owner.
ARG VITE_APP_VERSION=""
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_FIREBASE_AUTH_ENABLED=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_FIREBASE_STORAGE_BUCKET=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_GSC_VERIFICATION=""
# R107 (migration): gateway docs deep-link override for the admin
# WhatsApp page. Empty default = NO link (the header degrades to a plain
# hint — the baked-in onrender.com URL died with the Render split). Set it
# only if you expose a restricted gateway dashboard hostname; in the
# default production topology the gateway is internal and this stays empty.
ARG VITE_OPENWA_DOCS_URL=""
# Render injects RENDER_GIT_COMMIT automatically; we surface it to Vite as
# VITE_RELEASE_SHA so Sentry's release tag matches uploaded source maps.
ARG RENDER_GIT_COMMIT=""
# R107 (migration): neutral release identity — Coolify / GHCR / CI builds
# pass GIT_SHA; it wins over RENDER_GIT_COMMIT everywhere (backend
# getReleaseSha(), sourcemap upload, runtime ENV) so version telemetry
# survives the move off Render without platform-specific code.
ARG GIT_SHA=""
# Mission W1: Coolify passes SOURCE_COMMIT=<sha> as a build arg when
# include_source_commit_in_build is enabled — let it drive the release
# identity whenever GIT_SHA itself was not provided.
ARG SOURCE_COMMIT=""

ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_API_URL=$VITE_API_URL \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL \
    VITE_GA_TRACKING_ID=$VITE_GA_TRACKING_ID \
    VITE_APP_ORIGIN=$VITE_APP_ORIGIN \
    VITE_APP_VERSION=$VITE_APP_VERSION \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_FIREBASE_AUTH_ENABLED=$VITE_FIREBASE_AUTH_ENABLED \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_GSC_VERIFICATION=$VITE_GSC_VERIFICATION \
    VITE_OPENWA_DOCS_URL=$VITE_OPENWA_DOCS_URL \
    VITE_RELEASE_SHA=$RENDER_GIT_COMMIT

# R104 (AG12-1) — history: this stage used to be build ONLY. The root
# `pnpm run build` chains lint + typecheck BEFORE the actual build, and
# duplicating the CI quality job inside the platform build was avoided for
# cost (Render build minutes used to be a shared 500/mo free-tier budget;
# on Coolify the builder runs on the VM's own CPU, where a double build
# just wastes deploy minutes). That stance assumed CI gates the merge.
#
# R122 (A9-P0-2): that assumption does not hold at DEPLOY time. CI
# (.github/workflows/ci.yml) runs green on every push to main, but the
# Coolify push-to-deploy webhook fires on the push itself and builds this
# image WITHOUT waiting for CI — so a type error could reach production
# before CI even reports (esbuild transpiles without typechecking — see
# backend/build.mjs — and vite does not typecheck either). The image build
# therefore now enforces the strongest cheap gate itself: `pnpm run
# typecheck` (tsc --build over the shared project references + per-package
# --noEmit, exactly what CI's quality job runs; ~1-2 min on the builder's
# own CPU per the R104 note above; noEmitOnError makes any red a hard
# build failure) as deploy-time defense-in-depth. Lint and the vitest
# suites remain CI-owned (folding them in here would add ~6-8 min to every
# webhook deploy — deliberately not on the critical path). A manual deploy
# of a red-CI commit is still the operator's explicit override.
# Side note: `tsc --build` emits shared/*/dist declaration artifacts
# (~1.1 MB d.ts + .tsbuildinfo) into this stage. R127-L4 (B10 F3): the
# runtime stage no longer copies /app/shared (or backend sources) at all —
# only the workspace package.jsons for pnpm linking — so those artifacts
# stay here in the discarded build stage with the TS sources.
RUN pnpm run typecheck

# R107: VITE_RELEASE_SHA is resolved here (shell-standard ${A:-$B}, no
# reliance on Dockerfile ENV substitution) so GIT_SHA wins over
# RENDER_GIT_COMMIT for the Sentry release tag on any platform.
# R121: Sentry build-time wiring — when Coolify supplies these three
# build args, the vite build emits hidden source maps, @sentry/vite-plugin
# uploads them under the GIT_SHA release and deletes them, and backend
# build.mjs runs the same inject+upload for the API bundle. Unset (the
# default) = uploads skipped, zero maps emitted, exactly the pre-R121
# behavior. Never bake real values as defaults — secrets pass through
# Coolify build args only.
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
RUN VITE_RELEASE_SHA="${GIT_SHA:-${SOURCE_COMMIT:-${VITE_RELEASE_SHA}}}" \
    SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN}" \
    SENTRY_ORG="${SENTRY_ORG}" \
    SENTRY_PROJECT="${SENTRY_PROJECT}" \
    pnpm --filter @workspace/api-server run build

# --- runtime: lean image with production deps and built artifacts -------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
# R107: GIT_SHA re-declared + re-exported so the runtime process reads its
# release identity through getReleaseSha() on every platform.
ARG GIT_SHA=""
ARG SOURCE_COMMIT=""
ENV NODE_ENV=production \
    PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist/public \
    TZ=UTC \
    GIT_SHA=${GIT_SHA:-${SOURCE_COMMIT}}
# F6 (round-94 A6): TZ pinned explicitly — the cron slots in
# backend/src/jobs/cron.ts are documented as UTC and previously relied on
# Alpine's default-absent /etc/localtime (UTC by accident). A base-image
# change or an injected TZ env would silently shift every daily slot.
# node-cron schedules also pass timezone:"UTC" explicitly (belt+braces).
# R110 (109-j P3, re-verified NOT dead): the runtime stage's own
# `pnpm install` further below needs the corepack pnpm shim — node:*-alpine
# ships neither pnpm nor enabled shims (same pattern as the deps stage
# above). Only the runtime CMD bypasses pnpm (FH-A3 F-3 note at the CMD).
RUN corepack enable

COPY --from=build /app/package.json         ./package.json
COPY --from=build /app/pnpm-workspace.yaml  ./pnpm-workspace.yaml
COPY --from=build /app/pnpm-lock.yaml       ./pnpm-lock.yaml
COPY --from=build /app/.npmrc               ./.npmrc
# R127-L4 (B10 F2): manifest-first runtime install — mirror the deps-stage
# ordering at the top of this file. The old order copied the FULL source
# trees (backend/ + shared/) BEFORE this install, so every source change
# invalidated the install layer (a full node_modules re-link per deploy;
# the cache mount saves the download, not the link). The install reads only
# the root manifests + EVERY workspace package.json — pnpm must parse the
# whole workspace to resolve the `--filter @workspace/api-server...`
# closure — so those are all that needs to precede it. Built artifacts
# ride AFTER the install layer.
COPY --from=build /app/backend/package.json        ./backend/package.json
COPY --from=build /app/frontend/package.json       ./frontend/package.json
COPY --from=build /app/scripts/package.json        ./scripts/package.json
COPY --from=build /app/shared/api-client-react/package.json ./shared/api-client-react/package.json
COPY --from=build /app/shared/api-zod/package.json          ./shared/api-zod/package.json
COPY --from=build /app/shared/api-spec/package.json         ./shared/api-spec/package.json
COPY --from=build /app/shared/db/package.json               ./shared/db/package.json

# R109 P0-1: the root `prepare: husky` script runs under this --prod install,
# but husky is a devDependency (absent here) -> `husky: not found` -> exit 1
# -> the ENTIRE docker build aborted (empirically reproduced; every path that
# builds this image was dead: docker-verify.sh, compose, Coolify, GHCR).
# --ignore-scripts is safe for this stage: the only real runtime externals are
# argon2 + firebase-admin, and both load their bundled/prebuilt artifacts at
# require-time (verified: `require('argon2')` and `require('firebase-admin')`
# succeed in a --ignore-scripts prod tree; pnpm 10 additionally gates
# dependency lifecycle scripts behind onlyBuiltDependencies anyway).
# R127-L4 (B10 F4): `corepack enable` + this install download pnpm 10.17.0
# into /root/.cache/node/corepack (~44 MB) — after `USER node` it is
# unreadable and the CMD invokes node directly, so it was pure dead weight
# in every pull. Removed in the SAME layer so the bytes never ship.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @workspace/api-server... \
    && rm -rf /root/.cache/node/corepack \
    && chown -R node:node /app

# R127-L4 (B10 F3): runtime artifacts only. The app runs the compiled
# esbuild bundle (see the CMD below): build.mjs inlines every @workspace/*
# import and externalizes only real node_modules packages, so the TS
# sources (backend/src, backend/tests, shared/*/src) no longer ship —
# they stay in the discarded build stage, which still typechecks them
# (backend/tsconfig.json includes src + tests — that is why backend/tests
# is NOT .dockerignored: it must stay in the build context for the R122
# deploy-time typecheck gate). The workspace package.jsons above are all
# pnpm's linking needs. pino's worker siblings (pino-*.mjs,
# thread-stream-worker.mjs) ARE runtime files (loaded via
# __bundlerPathsOverrides), so dist/ ships wholesale — except the unused
# job-worker entry (dist/worker.mjs: a separate esbuild entry, imported
# by nothing in the server graph — backend/src/worker.ts:193; no worker
# tier exists, WORKER_TIER is unset).
COPY --from=build --chown=node:node /app/backend/dist    ./backend/dist
COPY --from=build --chown=node:node /app/frontend/dist   ./frontend/dist
RUN rm -f /app/backend/dist/worker.mjs

# F-011 (security audit 004) — drop root in the runtime stage.
# Any RCE in the application becomes container-`node` (UID 1000) code execution
# instead of UID 0. Defense-in-depth: Render's managed environment limits the
# blast radius further, but the audit's calibration anchor is "do not run as
# root regardless." The `node` user ships with the node:*-alpine base image.
USER node

EXPOSE 8080

# R107 (migration): container-native health check — Coolify/Docker/compose
# all read this. wget is present in alpine's busybox; the probe rides the
# SAME cheap public endpoint the orchestrators use (/api/healthz answers
# 503 "starting" until the boot gate opens, then 200 — see server.ts).
# start-period covers migrations + cold Neon (bounded 120 s write-wait);
# interval 30 s keeps probe load negligible.
HEALTHCHECK --interval=30s --timeout=5s --start-period=150s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/healthz >/dev/null 2>&1 || exit 1

# Run DB migrations, then start the API (which also serves the SPA).
# Migrations run INSIDE the app (bootMigrations() in server.ts): the port
# binds first, /api/healthz answers 503 "starting" while migrations apply,
# then the readiness gate opens — identical ordering to the old pnpm chain.
# FH-A3 F-3: node is invoked DIRECTLY (not via `pnpm --filter … start`) so
# node becomes PID 1 — SIGTERM reaches the drain handlers without an
# unproven pnpm hop, and the corepack shim never re-downloads pnpm from
# the npm registry on container start (its build-time cache lived under
# /root, unreadable by USER node — and is deleted at build time since
# R127-L4/B10 F4; the shims themselves need no cache at runtime).
CMD ["node", "--enable-source-maps", "backend/dist/index.mjs"]
