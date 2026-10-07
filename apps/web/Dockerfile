# syntax=docker/dockerfile:1
#
# Build from the monorepo root: docker build -f apps/web/Dockerfile .
# See docs/deployment.md for the full self-host walkthrough.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile

# Fixed placeholder values, not real secrets: nothing at build time connects
# to a real database or sends real mail (packages/db's `generate` needs no
# live connection, and `next build` only statically analyzes routes), so
# these never need to hold anything sensitive — mirrors the dummy values CI
# sets for the same reason.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    NEXTAUTH_SECRET=build-nextauth-secret \
    NEXTAUTH_URL=http://localhost:3000 \
    INTEGRATION_CONFIG_ENCRYPTION_KEY=build-integration-config-encryption-key \
    SMTP_ENCRYPTION_KEY=build-smtp-encryption-key \
    NEXT_TELEMETRY_DEBUG=1
# Optional Sentry source-map upload (roadmap 7.6, docs/deployment.md). These
# ARGs exist only in this build stage — the runner stage below never sees
# them, so the token is not in the final image. All three must be set for
# next.config.mjs to upload; otherwise the build is unchanged.
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG SENTRY_URL=""
RUN pnpm --filter @sla/db generate
RUN pnpm --filter @sla/web build

# next.config.mjs's `output: "standalone"` (with outputFileTracingRoot
# pointed at the monorepo root) traces this app's actual runtime
# dependencies — including the workspace packages under packages/* — into a
# self-contained apps/web/.next/standalone tree, so the runtime image below
# needs none of the pnpm workspace or devDependencies.
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone output does not include public/: without this the web app manifest
# and structured-data icon (public/icon-512.png) would 404 in the image.
COPY --from=builder /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
# GET /api/health (roadmap step 29) checks DB connectivity only — see
# apps/web/src/app/api/health/route.ts. Use 127.0.0.1, not localhost: busybox
# wget resolves localhost to ::1 first, but Next's standalone server only
# listens on IPv4 (0.0.0.0), so the probe gets "Connection refused".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
