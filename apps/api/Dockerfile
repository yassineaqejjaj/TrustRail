# syntax=docker/dockerfile:1
# Multi-stage build for @trustrail/api. Built from the monorepo root
# context (see infra/docker-compose.yml) because it depends on workspace
# packages (@trustrail/contracts, @trustrail/policy-engine,
# @trustrail/receipt-verifier).
#
# NOT executed on the machine this was authored on (no Docker available --
# see docs/DECISIONS.md and docs/BUILD_STATUS.md). Treat this as a
# reviewed-but-unverified starting point, not a finished, battle-tested
# image.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/policy-engine/package.json packages/policy-engine/package.json
COPY packages/receipt-verifier/package.json packages/receipt-verifier/package.json
COPY packages/test-support/package.json packages/test-support/package.json
COPY apps/api/package.json apps/api/package.json
# apps/merchant-sandbox's package.json is needed too: the migrate
# service's entrypoint (src/db/bootstrapAndMigrate.docker.ts) imports its
# migration runner by relative path to run both apps' migrations from one
# container -- see that file's header comment.
COPY apps/merchant-sandbox/package.json apps/merchant-sandbox/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/contracts packages/contracts
COPY packages/policy-engine packages/policy-engine
COPY packages/receipt-verifier packages/receipt-verifier
COPY apps/api apps/api
COPY apps/merchant-sandbox apps/merchant-sandbox
RUN pnpm --filter @trustrail/contracts run build \
 && pnpm --filter @trustrail/policy-engine run build \
 && pnpm --filter @trustrail/receipt-verifier run build \
 && pnpm --filter @trustrail/merchant-sandbox run build \
 && pnpm --filter @trustrail/api run build

FROM base AS runtime
ENV NODE_ENV=production
# Copies the full workspace (including dev dependencies) from the build
# stage rather than attempting a separate prod-only install, to keep this
# Dockerfile simple and correct given it has not been run/iterated on
# without Docker available. A pruned production image is a reasonable
# follow-up once this can actually be tested (docs/ROADMAP.md).
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
