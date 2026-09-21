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

## 2026-09-21 — Docker artifacts written without Docker to test them on

Wrote `apps/api/Dockerfile`, `apps/merchant-sandbox/Dockerfile`,
`apps/web/Dockerfile`, `infra/docker-compose.yml`, and
`.github/workflows/ci.yml` as reviewed, architecturally-considered
deliverables (multi-stage builds from the monorepo root context; a
one-shot `migrate` compose service gating `api`'s startup via
`condition: service_completed_successfully`; merchant-sandbox has no
published host port; the Ed25519 signing key is generated once into a
shared named volume, never baked into an image). None of these have
actually been run, because this build machine has no Docker and no CI
runner access (see the very first entry in this log). This is recorded
plainly in `docs/BUILD_STATUS.md` rather than implied to be tested — the
first real `docker compose up --build` on a machine that has Docker should
be expected to surface real issues to debug, not treated as a formality.

`apps/api/src/db/bootstrapAndMigrate.docker.ts` (the compose `migrate`
service's entrypoint) needed a cross-app import of
`apps/merchant-sandbox`'s migration runner, which TypeScript's `rootDir`
check rejects as a static import (it would pull a file outside
`apps/api/src` into that project's compiled output). Resolved with a
dynamic `import()` using a computed (non-literal) specifier plus a
hand-written local type for the imported shape, instead of `typeof
import("...")`, since even a type-only reference to a file still triggers
the `rootDir` check. This is the one deliberate cross-app coupling in the
codebase, confined entirely to that one Docker-only script.
