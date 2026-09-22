# syntax=docker/dockerfile:1
# Multi-stage build for @trustrail/api. Built from the monorepo root
# context (see infra/docker-compose.yml) because it depends on workspace
# packages (@trustrail/contracts, @trustrail/policy-engine,
# @trustrail/receipt-verifier, @trustrail/db, @trustrail/gateway-core).
#
# Actually built and run for real on Railway (2026-09-21) and, separately,
# via Docker Compose (docs/BUILD_STATUS.md) -- not a reviewed-but-unverified
# starting point.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app
# Pre-create the shared signing-key mount point owned by the unprivileged
# `node` user (built into the base image) so that whichever service writes
# here first -- `migrate`, running as `node` too, see infra/docker-compose.yml
# -- leaves files the `api` service's own `node` user can read. Docker
# copies a fresh named volume's initial ownership from this directory.
RUN mkdir -p /keys && chown node:node /keys

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/policy-engine/package.json packages/policy-engine/package.json
COPY packages/receipt-verifier/package.json packages/receipt-verifier/package.json
COPY packages/test-support/package.json packages/test-support/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/gateway-core/package.json packages/gateway-core/package.json
COPY apps/api/package.json apps/api/package.json
# apps/merchant-sandbox's and apps/saas-sandbox's package.json files are
# needed too: the migrate service's entrypoint
# (src/db/bootstrapAndMigrate.docker.ts) imports each sandbox's migration
# runner by relative path to run all three apps' migrations from one
# container -- see that file's header comment.
COPY apps/merchant-sandbox/package.json apps/merchant-sandbox/package.json
COPY apps/saas-sandbox/package.json apps/saas-sandbox/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/contracts packages/contracts
COPY packages/policy-engine packages/policy-engine
COPY packages/receipt-verifier packages/receipt-verifier
COPY packages/db packages/db
COPY packages/gateway-core packages/gateway-core
COPY apps/api apps/api
COPY apps/merchant-sandbox apps/merchant-sandbox
COPY apps/saas-sandbox apps/saas-sandbox
RUN pnpm --filter @trustrail/contracts run build \
 && pnpm --filter @trustrail/policy-engine run build \
 && pnpm --filter @trustrail/receipt-verifier run build \
 && pnpm --filter @trustrail/db run build \
 && pnpm --filter @trustrail/gateway-core run build \
 && pnpm --filter @trustrail/merchant-sandbox run build \
 && pnpm --filter @trustrail/saas-sandbox run build \
 && pnpm --filter @trustrail/api run build

FROM base AS runtime
ENV NODE_ENV=production
# Copies the full workspace (including dev dependencies) from the build
# stage rather than attempting a separate prod-only install, to keep this
# Dockerfile simple and correct given it has not been run/iterated on
# without Docker available. A pruned production image is a reasonable
# follow-up once this can actually be tested (docs/ROADMAP.md).
COPY --from=build /app /app
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
WORKDIR /app/apps/api
EXPOSE 4000
# No `USER node` here: the entrypoint starts as root to fix up the mounted
# signing-keys volume's ownership, then drops to `node` itself before
# exec'ing the real command (see docker-entrypoint.sh).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
