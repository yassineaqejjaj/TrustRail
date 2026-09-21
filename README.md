# TrustRail

**Let agents act. Keep control.**

TrustRail controls what AI agents can do on behalf of people and companies,
then records verifiable receipts of those actions. For every protected
operation it answers: which agent requested it, who authorized that agent,
what limits apply, whether it was permitted, blocked or held for approval,
and what evidence supports the outcome.

This is the V1 implementation described in [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md).
The first (and only, in V1) use case is a synthetic customer-support refund
agent, acting against a synthetic merchant sandbox. **No real money moves.**

Read [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) for exactly what is
implemented, tested, and known-limited as of the latest session — this
README is the quickstart, that file is the honest status board.

## Repository layout

```text
apps/web              Next.js dashboard
apps/api              Fastify gateway API (auth, grants, policies, actions, approvals, receipts)
apps/worker           Thin wrapper around apps/api's execution-job poller (see docs/DECISIONS.md)
apps/merchant-sandbox  Synthetic merchant: orders, payments, idempotent refunds
packages/contracts     Shared zod schemas, enums, canonicalization
packages/policy-engine  Pure policy evaluation + grant chain validation (no DB, no I/O)
packages/receipt-verifier  Ed25519 JWS signing/verification
packages/sdk-typescript (@trustrail/sdk)  TypeScript client
packages/mcp-adapter    MCP stdio adapter (get_order, request_refund, get_action_status)
packages/test-support   Shared ephemeral-Postgres test harness
sdk/python              Python client (mirrors @trustrail/sdk)
examples/               Runnable example agents (TypeScript and Python)
tests/integration       Cross-cutting fixtures used by more than one package's tests
infra/                  Dockerfiles, docker-compose, keys (gitignored)
docs/                   Everything listed below
```

## Requirements

- Node.js 20.11+ (tested on Node 26).
- pnpm (`npm install -g pnpm` if you don't have it).
- Python 3.9+ with `venv`, only needed for `sdk/python`.
- **No Docker, no Homebrew, no system PostgreSQL required.** Local
  Postgres runs via [`embedded-postgres`](https://github.com/leinelissen/embedded-postgres)
  (downloads real Postgres 18 binaries) — see
  [`docs/DECISIONS.md`](docs/DECISIONS.md) for why. Docker Compose is
  provided as an alternative deployment path (`infra/docker-compose.yml`)
  for machines that do have Docker, but has not been exercised on the
  machine this was built on — see `docs/BUILD_STATUS.md`.

## Quickstart

```bash
pnpm install --frozen-lockfile
pnpm setup:local     # provisions local Postgres, roles, migrations, a signing key, and .env
pnpm dev             # starts the API (:4000), merchant sandbox (:4100), and web (:3000)
```

Then, in another terminal:

```bash
pnpm demo:seed       # seeds the "Northstar Commerce" fictional org + demo users/agents/grants
pnpm demo:run eur80_auto_refund   # runs one deterministic scenario end to end
```

`pnpm demo:seed` prints the demo accounts' emails and a shared password, and
each demo agent's API secret (shown once). Sign in to the dashboard at
`http://localhost:3000` with any of the printed accounts, or call the API
directly with curl/the SDKs using the printed agent secret.

## Verification

```bash
pnpm verify          # lint + typecheck + tests + production build, package by package
```

See [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) for actual commands run and
actual results — not a claim, a report of what was executed.

## Documentation

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — the implementation contract this build follows.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit together.
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — what this does and does not protect against.
- [`docs/API.md`](docs/API.md) — REST reference.
- [`docs/SDK_QUICKSTART.md`](docs/SDK_QUICKSTART.md) — TypeScript and Python SDK usage.
- [`docs/MCP_SETUP.md`](docs/MCP_SETUP.md) — configuring the MCP adapter for a real MCP client.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — runbook: backups, key rotation, restore.
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — the 90-second demo, timed.
- [`docs/YC_PRODUCT_BRIEF.md`](docs/YC_PRODUCT_BRIEF.md) — one-page product brief.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's explicitly out of scope for V1 and why.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — significant implementation decisions, in order.
- [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) — requirement-by-requirement status.

## Deployment status

**Local development only, verified.** Production deployment guidance is in
`docs/OPERATIONS.md`, and Dockerfiles/`docker-compose.yml` are provided, but
have not been run on this build machine (no Docker available here) — see
`docs/BUILD_STATUS.md` for exactly what has and hasn't been executed.
