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
COPY apps/saas-sandbox/package.json apps/saas-sandbox/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/contracts packages/contracts
COPY apps/saas-sandbox apps/saas-sandbox
RUN pnpm --filter @trustrail/contracts run build \
 && pnpm --filter @trustrail/saas-sandbox run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/saas-sandbox
EXPOSE 4200
USER node
CMD ["node", "dist/index.js"]
