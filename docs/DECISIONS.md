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

## 2026-09-21 — Docker Compose actually run; three real bugs found and fixed

Docker Desktop became available on this machine partway through the build.
Ran `docker compose -f infra/docker-compose.yml --env-file infra/.env up
--build` for the first time, exactly as the previous entry predicted would
be needed, and treated the first run as a debugging session. Three real
bugs surfaced, none of which any test suite had (or realistically could
have) caught, since `pnpm verify`'s tests all run against compiled `src`
via `tsx`/`vitest`, never against the actual `dist` build artifact the way
a container does:

1. **`postgres:18-alpine`'s data-directory layout changed.** 18+ images
   refuse to start if the volume is mounted directly at
   `/var/lib/postgresql/data`; they now manage a version-specific
   subdirectory themselves and expect the volume mounted at the parent
   `/var/lib/postgresql`. Fixed in `infra/docker-compose.yml`.
2. **`tsconfig.base.json` was never copied into any Dockerfile's build
   context**, so `tsc -p tsconfig.json` (every package's `tsconfig.json`
   extends it) failed immediately inside every image. Fixed by adding it
   to the `COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ...` line
   in `apps/api/Dockerfile`, `apps/web/Dockerfile`, and
   `apps/merchant-sandbox/Dockerfile`'s `deps` stage.
3. **`apps/api/src/db/rls.sql` was never copied into `dist/`.** `tsc` only
   compiles `.ts` files; this raw SQL file sits next to `roles.ts` and is
   read via `__dirname` at runtime, which worked locally only because
   `tsx` runs directly against `src`. Fixed by changing
   `apps/api/package.json`'s `build` script to
   `tsc -p tsconfig.json && cp src/db/rls.sql dist/db/rls.sql` -- this was
   a latent bug in the package's own build output, not Docker-specific;
   any `node dist/index.js` production start without Docker would have
   hit it too, and nothing in the test suite would have noticed, because
   tests never exercise `dist/`.
4. **Signing-key file permissions**: the `migrate` service (Dockerfile
   `build` target, no `USER` set, so root) generates the Ed25519 signing
   key into the `trustrail-keys` named volume; `api`'s runtime stage runs
   as the unprivileged `node` user and couldn't read a root-owned file
   there. Fixed by pre-creating `/keys` `chown`-ed to `node` in the shared
   `base` Dockerfile stage, and setting `user: "node"` on the `migrate`
   compose service so both services write/read as the same uid.

After these fixes, a full live flow (register, create org, create agent +
credential, issue a grant, run four demo scenarios including
`direct_merchant_write_rejected`) succeeded against the real running
containers, and a receipt signed inside the `api` container verified
independently (`signature_valid: true`, `issuer_trusted: true`).
`merchant-sandbox`'s "no published port" isolation was also confirmed for
real, not just by review: a direct connection attempt from the host is
refused outright.

## 2026-09-21 — Pushed to GitHub; CI run for real; one more bug found

Created `yassineaqejjaj/trustrail` (private) and pushed `main`, which gave
`.github/workflows/ci.yml` its first real execution on an actual GitHub
Actions runner. It failed immediately, on `pnpm/action-setup@v4`: the
workflow passed `version: 9` while `package.json`'s own `packageManager`
field already pins `pnpm@9.15.0`, and a newer release of that action now
treats specifying a version in both places as an error (`ERR_PNPM_BAD_PM_VERSION`
guard), even when the versions don't actually conflict. Fixed by dropping
the redundant `version:` input and letting the action read
`packageManager` instead, which is also more correct going forward (only
one source of truth for the pinned version). Re-ran after the fix -- see
`docs/TEST_REPORT.md`/`docs/BUILD_STATUS.md` for the result. This was the
one deployment-package piece that had remained genuinely unverified; it no
longer is.
