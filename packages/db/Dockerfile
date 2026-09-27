# syntax=docker/dockerfile:1
#
# One-shot migration runner (roadmap 7.1): `docker compose up` builds and
# runs this as the `migrate` service, which applies pending Prisma
# migrations against DATABASE_URL and exits. `web` and `worker` depend on
# it completing successfully before they start, so a fresh deployment can
# never boot against an unmigrated schema.
#
# Build from the monorepo root: docker build -f packages/db/Dockerfile .
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile --filter @sla/db...

# prisma.config.ts resolves DATABASE_URL at config-load time, `generate`
# included, even though generation never connects. A dummy value (mirroring
# apps/worker/Dockerfile and CI) satisfies it; the real DATABASE_URL from
# docker-compose.yml's `environment:` overrides it at run time.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL
RUN pnpm --filter @sla/db generate

CMD ["pnpm", "--filter", "@sla/db", "exec", "prisma", "migrate", "deploy"]
