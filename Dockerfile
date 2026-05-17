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
ARG VITE_APP_ORIGIN=""
ARG VITE_APP_NAME=""
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
ARG VITE_FIREBASE_DATABASE_URL=""
# Render injects RENDER_GIT_COMMIT automatically; we surface it to Vite as
# VITE_RELEASE_SHA so Sentry's release tag matches uploaded source maps.
ARG RENDER_GIT_COMMIT=""

ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_API_URL=$VITE_API_URL \
    VITE_APP_ORIGIN=$VITE_APP_ORIGIN \
    VITE_APP_NAME=$VITE_APP_NAME \
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
    VITE_FIREBASE_DATABASE_URL=$VITE_FIREBASE_DATABASE_URL \
    VITE_RELEASE_SHA=$RENDER_GIT_COMMIT

RUN pnpm run build

# --- runtime: lean image with production deps and built artifacts -------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist/public
RUN corepack enable

COPY --from=build /app/package.json         ./package.json
COPY --from=build /app/pnpm-workspace.yaml  ./pnpm-workspace.yaml
COPY --from=build /app/pnpm-lock.yaml       ./pnpm-lock.yaml
COPY --from=build /app/.npmrc               ./.npmrc
COPY --from=build /app/backend              ./backend
COPY --from=build /app/frontend/dist        ./frontend/dist
COPY --from=build /app/shared               ./shared

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @workspace/api-server...

EXPOSE 8080
# Run DB migrations, then start the API (which also serves the SPA).
CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
