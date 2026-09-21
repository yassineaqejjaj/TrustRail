# Decisions log

Chronological record of significant implementation decisions and why they were made. Append new entries at the bottom; do not rewrite history.

## 2026-09-21 — Environment constraints on the build machine

The build machine has no Docker, no Homebrew, and no system PostgreSQL. It has Node.js v26.9, npm, and network access to the npm registry.

Decision: use [`embedded-postgres`](https://github.com/leinelissen/embedded-postgres) (downloads real PostgreSQL 18 binaries for darwin-arm64, no Docker required) to run a genuine, ephemeral PostgreSQL instance for local development and for the integration/concurrency test suite. This satisfies the spec's requirement ("Use a real ephemeral PostgreSQL instance for transactions and concurrency; in-memory mocks cannot validate locking behavior") without requiring Docker on this machine.

Docker Compose files are still written as a deliverable (`infra/docker-compose.yml`, Dockerfiles) so the documented `docker compose up --build` path works on a machine that has Docker installed. That path has **not** been executed on this build machine — this is recorded honestly in `docs/BUILD_STATUS.md` and `docs/TEST_REPORT.md` rather than claimed as verified.

pnpm was not preinstalled either; installed globally via `npm install -g pnpm` (network install, no sudo, user-scoped npm prefix).

## 2026-09-21 — Package manager and script-approval posture

npm's `install-scripts` guard blocked the `embedded-postgres` platform package's postinstall (which hydrates binary symlinks) and pnpm's own install script. Both were explicitly approved (`npm install-scripts approve ...`) because their behavior was inspected first (symlink hydration for a known, single-purpose embedded-database package; pnpm's own installer). No blanket `--ignore-scripts` bypass was used, and no other package's scripts were approved without review.

## 2026-09-21 — Monorepo layout

Followed the spec's repository layout exactly (`apps/*`, `packages/*`, `sdk/python`, `examples/*`, `infra`, `tests/*`, `docs`). pnpm workspaces + a single root `tsconfig.base.json` extended by each package. Drizzle ORM + drizzle-kit for PostgreSQL migrations, per spec preference.

## 2026-09-21 — Scope honesty for V1

This build targets every mandatory (V01–V15) capability in `docs/PRODUCT_SPEC.md` §2. Given the size of the spec (a multi-service product: gateway, policy engine, two SDKs, MCP adapter, signed receipts, Playwright/pytest suites, deterministic demo, docs, deployment package), work proceeds phase by phase per §17, with `docs/BUILD_STATUS.md` kept current after every phase so the true state is always inspectable, including for a future continuation session. No phase is marked complete without the tests specified in its gate actually being run against a real database.
