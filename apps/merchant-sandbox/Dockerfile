# syntax=docker/dockerfile:1
# See apps/api/Dockerfile's header comment -- same pattern, same caveats
# (not executed on the authoring machine; no Docker available there).
#
# In infra/docker-compose.yml this service has NO published host port --
# only the api service can reach it, on the internal compose network. Do
# not add a `ports:` mapping for this service in any real deployment.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/merchant-sandbox/package.json apps/merchant-sandbox/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/contracts packages/contracts
COPY apps/merchant-sandbox apps/merchant-sandbox
RUN pnpm --filter @trustrail/contracts run build \
 && pnpm --filter @trustrail/merchant-sandbox run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/merchant-sandbox
EXPOSE 4100
USER node
CMD ["node", "dist/index.js"]
