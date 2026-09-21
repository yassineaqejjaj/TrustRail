# Architecture

## The trusted execution path

```
authenticated agent (bearer credential)
        |
        v
   apps/api gateway  --(read-only order lookup)-->  apps/merchant-sandbox
        |
        | resolve grant chain + policy, evaluate (packages/policy-engine)
        v
   ALLOW / DENY / REQUIRE_APPROVAL
        |
   [if REQUIRE_APPROVAL: apps/api approvals -> human decision -> re-evaluate]
        |
        v
   atomic budget reservation (Postgres row locks, same tx as the dispatch claim)
        |
        v
   execution_jobs outbox row written in the SAME transaction
        |
        v
   dispatch: apps/api calls apps/merchant-sandbox's write API
   (idempotency key = TrustRail action ID)
        |
        v
   signed decision + execution receipts (packages/receipt-verifier, Ed25519 JWS)
```

The dashboard (`apps/web`) and both SDKs call the exact same `apps/api`
routes an agent does — there is no separate, less-audited path for
human-triggered actions.

## Why this shape

**The gateway, not the agent, owns the merchant credential.** An agent
authenticates to TrustRail with its own 256-bit key; TrustRail authenticates
to the merchant sandbox with a separate shared secret the agent never sees.
`apps/api/src/gateway/merchantSandboxConnector.ts` is the only code that
holds that secret. This is what makes "the agent cannot directly reach the
protected refund API" true rather than aspirational — see
`docs/THREAT_MODEL.md` for where this guarantee's edges are.

**Decision and execution are separate states, on purpose.** `actions.decision`
(ALLOW/DENY/REQUIRE_APPROVAL) is set once, by policy evaluation.
`actions.execution_state` moves through `received -> ... -> succeeded|failed|
unknown|denied|...` independently, because a permitted action can still fail
to execute (merchant timeout, merchant rejection), and that must be visible.
`packages/policy-engine/src/lifecycle.ts` is the single source of truth for
which state transitions are legal; `apps/api/src/gateway/dispatch.ts` is the
only code that performs them.

**Row-level security enforces tenant isolation at the database, not just in
route handlers.** Every tenant-scoped table (`apps/api/src/db/schema.ts`'s
`TENANT_SCOPED_TABLES`) has an RLS policy (`apps/api/src/db/rls.sql`) that
filters on `current_setting('app.current_org_id')`, which only
`db/client.ts#withTenant` can set, and only inside a transaction. The
runtime database role (`trustrail_app`) has no `BYPASSRLS` and is not the
table owner — only the separate `trustrail_migrator` role (used solely by
`pnpm migrate`) can. Three tables are deliberately *not* RLS-scoped —
`agent_credentials`, `sessions`, and the identity tables `users`/
`memberships` — because authenticating a bearer credential or a session
cookie is exactly the step of *establishing* which organization a request
belongs to, and RLS can't apply before that's known. Every route that reads
those tables filters explicitly by organization/user ID instead; see the
comment in `apps/api/src/auth/context.ts#authenticateAgent`.

**Policy evaluation is pure and DB-free.** `packages/policy-engine`'s
`evaluate()` takes an already-resolved grant chain, an already-fetched
policy bundle, and already-fetched order facts, and returns a decision. It
has no idea Postgres exists. This is what let it be unit-tested exhaustively
(22 tests) in milliseconds, independent of the 25 slower integration tests
that prove the wiring around it is correct.

**Budgets are multiple independent reservation windows, reserved
atomically.** A single action can be constrained by up to three budgets at
once — the root grant's own daily cap, an ancestor's child-budget cap, and
the policy's org-wide daily cap for the action — each tracked as its own
`budget_windows` row, locked in sorted key order (deadlock avoidance),
checked, and only then all incremented together. See
`apps/api/src/gateway/budget.ts`.

**An outbox makes dispatch recoverable, not just fast.** The reservation
transaction also writes an `execution_jobs` row. The gateway attempts
dispatch inline immediately after (for low demo latency), but if the process
crashes between the commit and that attempt, `apps/api/src/worker/poller.ts`
will pick the job up later — it iterates the organizations table (the one
truly global table) and opens one tenant-scoped transaction per org to find
its own due jobs, so even the worker never bypasses RLS.

## Package boundaries

| Package | Depends on I/O? | Why it's separate |
|---|---|---|
| `packages/contracts` | No | Single source of truth for wire shapes; imported by every other package and app. |
| `packages/policy-engine` | No | The actual authorization logic, kept trivially unit-testable. |
| `packages/receipt-verifier` | No (pure crypto) | Used by both the API (signing) and any verifier (checking), including a future standalone CLI. |
| `packages/test-support` | Yes (spawns Postgres) | Shared by every package/app that needs a real ephemeral database. |
| `packages/sdk-typescript`, `sdk/python` | Yes (HTTP) | Public client surface; must not depend on server internals. |
| `packages/mcp-adapter` | Yes (HTTP via the SDK) | Talks to TrustRail exactly like any other agent integration would. |

`apps/worker` is documented as a thin wrapper rather than an independent
codebase — see `docs/DECISIONS.md` — because the actual poller logic lives
in `apps/api/src/worker/poller.ts` and importing it avoided a costly
mid-build package split. A future pass could extract a `packages/gateway-core`
containing everything under `apps/api/src/gateway` and `db`, shared cleanly
between `apps/api` and `apps/worker`; this is listed in `docs/ROADMAP.md`.

## Data model

See `docs/PRODUCT_SPEC.md` section 10 for the target table list and
`apps/api/src/db/schema.ts` for the actual Drizzle schema (ground truth —
the spec is the contract, the schema file is what was actually built to
satisfy it). The merchant sandbox's tables live in their own PostgreSQL
schema (`merchant_sandbox`), in a separate database entirely in every test
harness and in local dev (`trustrail` vs `trustrail_merchant`).
