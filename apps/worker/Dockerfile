# syntax=docker/dockerfile:1
#
# Build from the monorepo root: docker build -f apps/worker/Dockerfile .
# See docs/deployment.md for the full self-host walkthrough.
#
# apps/worker's own "start" script (dotenv -e ../../.env -- tsx src/index.ts)
# runs TypeScript directly via tsx rather than a compiled dist/ output, and
# every @sla/* package it imports is consumed as workspace TS source (each
# package.json's "main" points at src/index.ts, not a build artifact) — so,
# unlike apps/web, there is no bundling step that lets the runtime image
# drop devDependencies or leave source out. The image below keeps the full
# monorepo install and runs the same start script used outside Docker.

FROM node:22-alpine AS runner
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile

# packages/db/prisma.config.ts resolves DATABASE_URL at config-load time for
# every prisma command, `generate` included, even though the generated
# driver-adapter client itself never connects during generation. A dummy
# value (mirroring CI's) is enough to satisfy it here.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL
RUN pnpm --filter @sla/db generate

RUN addgroup -S nodejs && adduser -S worker -G nodejs
USER worker

WORKDIR /repo/apps/worker
# health-server.ts's liveness endpoint (roadmap step 29) — WORKER_HEALTH_PORT
# defaults to 8081 in apps/worker/src/config.ts, so this must match unless
# that env var is overridden at run time. Not published to the host by
# default in docker-compose.prod.yml: nothing outside this container needs
# to reach it, since the HEALTHCHECK below hits it over localhost.
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://localhost:${WORKER_HEALTH_PORT:-8081}/health" || exit 1
# Same as apps/web/Dockerfile. Set after `pnpm install` so the install keeps devDependencies (tsx runs the worker).
ENV NODE_ENV=production
CMD ["pnpm", "start"]
