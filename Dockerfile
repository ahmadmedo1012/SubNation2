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
COPY --from=build /app/.env                 ./.env
COPY --from=build /app/backend              ./backend
COPY --from=build /app/frontend/dist        ./frontend/dist
COPY --from=build /app/shared               ./shared

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @workspace/api-server...

EXPOSE 8080
# Run DB migrations, then start the API (which also serves the SPA).
CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
