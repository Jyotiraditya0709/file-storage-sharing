# syntax=docker/dockerfile:1

# ---- base ----
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---- deps: full install (dev deps included) from the committed lockfile ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile

# ---- build: compile both packages, then produce a pruned prod tree ----
# The compose `migrate` service runs from THIS stage, because drizzle-kit is a
# devDependency that the runtime stage prunes away. `drizzle/` is copied in by
# `COPY . .` — .dockerignore deliberately does not exclude it.
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY . .
RUN pnpm --filter web build \
 && pnpm --filter server build \
 && pnpm --filter server deploy --prod --legacy /prod/server

# ---- runtime: dist + production dependencies only ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST_PATH=./web/dist
COPY --from=build /prod/server/node_modules ./node_modules
# Both package.json files are required, not cosmetic: the nearest package.json
# to server/dist/*.js is what tells Node the files are ESM ("type": "module").
# Without it Node parses them as CommonJS and dies on the first import.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/server.js"]
