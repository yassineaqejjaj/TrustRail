# TrustRail

**Let agents act. Keep control.**

[![CI](https://github.com/yassineaqejjaj/TrustRail/actions/workflows/ci.yml/badge.svg)](https://github.com/yassineaqejjaj/TrustRail/actions/workflows/ci.yml)

## At a glance

| | |
|---|---|
| **What it is** | A control layer that decides what AI agents may do on behalf of people and companies, and records signed, verifiable receipts of every decision. |
| **Problem** | Companies want agents to take real actions but have no enforceable way to bound them, require human review, or prove afterwards what happened. |
| **Status** | **Prototype** (V1, synthetic sandboxes only, no real money moves). See [Current status](#current-status). |
| **Architecture** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| **Demo** | [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) (90-second scripted demo) |
| **Product brief** | [`docs/YC_PRODUCT_BRIEF.md`](docs/YC_PRODUCT_BRIEF.md) |
| **Case study** | [How this project was built](https://github.com/yassineaqejjaj/agentic-sdlc/blob/main/docs/case-studies/trustrail.md) |

TrustRail controls what AI agents can do on behalf of people and companies,
then records verifiable receipts of those actions. For every protected
operation it answers: which agent requested it, who authorized that agent,
what limits apply, whether it was permitted, blocked or held for approval,
and what evidence supports the outcome.

This is the V1 implementation described in [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md),
now covering two use cases: a synthetic customer-support refund agent
acting against a synthetic merchant sandbox, and a SaaS B2B account/subscription
agent (grant credit, change plan, activate a feature, invite a user) acting
against a synthetic SaaS sandbox. **No real money moves.**

Read [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) for exactly what is
implemented, tested, and known-limited as of the latest session — this
README is the quickstart, that file is the honest status board.

## The problem

Companies want AI agents to take real actions (starting with financial operations such as refunds) but have no enforceable way to bound what an agent can do, require human review above a threshold, or produce evidence after the fact. Prompt-level guardrails are advisory only. Details: [`docs/YC_PRODUCT_BRIEF.md`](docs/YC_PRODUCT_BRIEF.md).

## The solution

An enforcement gateway sits between the agent and the downstream system and owns the downstream credential, so the agent cannot bypass it. Every protected request is evaluated against a delegated grant and a versioned, deterministic policy (no LLM judgment in the authorization path), then allowed, denied, or held for human approval, and finally recorded in signed receipts.

## Key features

- Agent registry with revocable credentials.
- Human-to-agent and agent-to-agent delegation with strict subset (attenuation) rules.
- Versioned, deterministic policies.
- Human approval queue bound to the exact request, policy and grant chain.
- Transactional shared budgets and idempotency.
- Signed decision and execution receipts (Ed25519 JWS), independently verifiable.
- Web dashboard, deterministic demo lab (12 scenarios), TypeScript and Python SDKs, and an MCP adapter.

Requirement-by-requirement status: [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md).

## Architecture

Agents call the `apps/api` gateway, which resolves the grant chain and policy, evaluates the request, reserves budget atomically, dispatches to the synthetic sandbox and issues signed receipts. The dashboard and SDKs use the same API routes as agents. See the trusted execution path and package boundaries in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and the threat model in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Tech stack

TypeScript monorepo (pnpm workspaces): Next.js and Tailwind dashboard, Fastify API, PostgreSQL (embedded Postgres for local dev), zod schemas, Ed25519 JWS receipts, a Python SDK, an MCP stdio adapter, Docker Compose, vitest and Playwright. Versions and rationale: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Screenshots / Demo

No screenshots yet. The scripted demo is in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md); `pnpm demo:run <scenario>` runs scenarios end to end (see Quickstart below).

## Repository layout

```text
apps/web              Next.js dashboard
apps/api              Fastify gateway API (auth, grants, policies, actions, approvals, receipts)
apps/worker           Thin wrapper around apps/api's execution-job poller (see docs/DECISIONS.md)
apps/merchant-sandbox  Synthetic merchant: orders, payments, idempotent refunds
apps/saas-sandbox      Synthetic SaaS: accounts, plans, features, users, idempotent actions
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
- **No Docker, no Homebrew, no system PostgreSQL required for local dev.**
  Local Postgres runs via [`embedded-postgres`](https://github.com/leinelissen/embedded-postgres)
  (downloads real Postgres 18 binaries) — see
  [`docs/DECISIONS.md`](docs/DECISIONS.md) for why. Docker Compose is also
  available (`infra/docker-compose.yml`) as an alternative deployment path
  for machines that have Docker, and has now been run end-to-end for real
  — see `docs/BUILD_STATUS.md`'s V15 entry.

## Quickstart

```bash
pnpm install --frozen-lockfile
pnpm setup:local     # provisions local Postgres, roles, migrations, a signing key, and .env
pnpm dev             # starts the API (:4000), merchant sandbox (:4100), saas sandbox (:4200), and web (:3000)
```

Then, in another terminal:

```bash
pnpm demo:seed       # seeds the "Northstar Commerce" fictional org + demo users/agents/grants
pnpm demo:run eur80_auto_refund          # a refund scenario, end to end
pnpm demo:run lea_onboarding_completed   # a SaaS subscription scenario, end to end
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

**Local development, Docker Compose, and CI are all verified for real.**
`docker compose -f infra/docker-compose.yml --env-file infra/.env up --build`
has been run end-to-end against real containers, including a live
register → org → agent → grant → refund flow and independent receipt
verification, and `.github/workflows/ci.yml` has passed on a real GitHub
Actions runner against [`yassineaqejjaj/trustrail`](https://github.com/yassineaqejjaj/trustrail)
— see `docs/BUILD_STATUS.md`'s V15 entry and `docs/DECISIONS.md` for the
real bugs both of those first runs found and fixed. Production deployment
guidance is in `docs/OPERATIONS.md`.

## Testing & quality

CI runs on every push to `main` and on pull requests (`.github/workflows/ci.yml`, badge above). `pnpm verify` runs lint, typecheck, tests and production build. Actual commands and results: [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).

## Current status

**Prototype.** V1 runs against synthetic merchant and SaaS sandboxes only; no real money moves. The requirement checklist and phase gates are in [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md). Per that file, a recorded demo take with a live presenter is not done.

## Known limitations

See "Known simplifications" in [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) and the coverage gaps in [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md). Out-of-scope items for V1 are listed in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Roadmap

[`docs/ROADMAP.md`](docs/ROADMAP.md): what is out of scope for V1, the expansion hypothesis, and engineering follow-ups.

## License

No licence file yet. `package.json` declares `UNLICENSED`.

---

## Part of an engineering approach

Built with the [Agentic SDLC framework](https://github.com/yassineaqejjaj/agentic-sdlc) (earned autonomy). Read how this project was built and what its checks caught in the [case study](https://github.com/yassineaqejjaj/agentic-sdlc/blob/main/docs/case-studies/trustrail.md).
