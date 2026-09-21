# syntax=docker/dockerfile:1
# See apps/api/Dockerfile's header comment -- same pattern, same caveats.

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/contracts packages/contracts
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN pnpm --filter @trustrail/contracts run build \
 && pnpm --filter @trustrail/web run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
USER node
CMD ["pnpm", "run", "start"]
