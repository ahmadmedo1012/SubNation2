# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# SubNation - single-image production build.
# The backend serves both the JSON API and the built frontend on the same
# origin, so no reverse proxy is required. Configure at runtime via env vars
# (see config/env.example).
# -----------------------------------------------------------------------------

ARG NODE_VERSION=22-alpine

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
# time, not at runtime. Render's Docker builds run inside a fresh container
# where service-level `envVars` from render.yaml are NOT automatically in the
# shell environment — they have to be declared as `ARG` here, then re-exposed
# as `ENV` so `pnpm run build` can read them.
#
# Without this block, `import.meta.env.VITE_SENTRY_DSN` resolved to `undefined`
# in the production bundle and `Sentry.init({ dsn: undefined })` was a silent
# no-op. Same problem affected every VITE_* var: Firebase config, Google
# client ID, app origin, etc.
#
# IMPORTANT: keep this list in sync with the `VITE_*` keys in render.yaml.
# Adding a new VITE_* env var without listing it here means production code
# will see `undefined` even though render.yaml has the value set.
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
ARG VITE_APP_VERSION=""
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_FIREBASE_AUTH_ENABLED=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_FIREBASE_STORAGE_BUCKET=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_FIREBASE_MEASUREMENT_ID=""
ARG VITE_GSC_VERIFICATION=""
# R107 (migration): gateway docs deep-link override for the admin
# WhatsApp page. Empty default = the built-in Render URL (current prod).
ARG VITE_OPENWA_DOCS_URL=""
# Render injects RENDER_GIT_COMMIT automatically; we surface it to Vite as
# VITE_RELEASE_SHA so Sentry's release tag matches uploaded source maps.
ARG RENDER_GIT_COMMIT=""
# R107 (migration): neutral release identity — Coolify / GHCR / CI builds
# pass GIT_SHA; it wins over RENDER_GIT_COMMIT everywhere (backend
# getReleaseSha(), sourcemap upload, runtime ENV) so version telemetry
# survives the move off Render without platform-specific code.
ARG GIT_SHA=""

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
    VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID \
    VITE_GSC_VERIFICATION=$VITE_GSC_VERIFICATION \
    VITE_OPENWA_DOCS_URL=$VITE_OPENWA_DOCS_URL \
    VITE_RELEASE_SHA=$RENDER_GIT_COMMIT

# R104 (AG12-1): build ONLY. The root `pnpm run build` chains
# lint + typecheck BEFORE the actual build — duplicating the CI quality
# job inside the paid-by-minutes Render pipeline (build minutes are a
# shared 500/mo free-tier budget). CI (.github/workflows/ci.yml) and
# the deploy gate already own those gates; a manual deploy of a red-CI
# commit is the operator's explicit override.
#
# R107: VITE_RELEASE_SHA is resolved here (shell-standard ${A:-$B}, no
# reliance on Dockerfile ENV substitution) so GIT_SHA wins over
# RENDER_GIT_COMMIT for the Sentry release tag on any platform.
RUN VITE_RELEASE_SHA="${GIT_SHA:-${VITE_RELEASE_SHA}}" \
    pnpm --filter @workspace/api-server run build

# --- runtime: lean image with production deps and built artifacts -------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
# R107: GIT_SHA re-declared + re-exported so the runtime process reads its
# release identity through getReleaseSha() on every platform.
ARG GIT_SHA=""
ENV NODE_ENV=production \
    PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist/public \
    TZ=UTC \
    GIT_SHA=$GIT_SHA
# F6 (round-94 A6): TZ pinned explicitly — the cron slots in
# backend/src/jobs/cron.ts are documented as UTC and previously relied on
# Alpine's default-absent /etc/localtime (UTC by accident). A base-image
# change or an injected TZ env would silently shift every daily slot.
# node-cron schedules also pass timezone:"UTC" explicitly (belt+braces).
RUN corepack enable

COPY --from=build --chown=node:node /app/package.json         ./package.json
COPY --from=build --chown=node:node /app/pnpm-workspace.yaml  ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /app/pnpm-lock.yaml       ./pnpm-lock.yaml
COPY --from=build --chown=node:node /app/.npmrc               ./.npmrc
COPY --from=build --chown=node:node /app/backend              ./backend
COPY --from=build --chown=node:node /app/frontend/dist        ./frontend/dist
COPY --from=build --chown=node:node /app/shared               ./shared

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @workspace/api-server... \
    && chown -R node:node /app

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
# unproven pnpm hop, and the corepack shim no longer re-downloads pnpm
# from the npm registry on every fresh container start (its build-time
# cache lives under /root, unreadable by USER node).
CMD ["node", "--enable-source-maps", "backend/dist/index.mjs"]
