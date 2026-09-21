# API reference

Base path: `/v1` (except health checks and `/.well-known/jwks.json`). All
request/response bodies are JSON. Errors are `{code, message, request_id,
details?}` with a standard HTTP status.

**Exact request/response shapes now live in [`docs/openapi.json`](./openapi.json),
generated from the same zod schemas the routes validate against** (see
`scripts/generate-openapi.ts`; regenerate with `pnpm generate:openapi` after
changing a route or a `packages/contracts` schema). This page stays as prose
for everything the generated spec doesn't capture on its own: the auth
model, role hierarchy, pagination/idempotency conventions, and the error
code vocabulary below. Field-level precision (which fields are optional,
enum values, string formats, nullability) belongs to the generated spec —
if this page and `openapi.json` ever disagree on a shape, the generated
spec wins. One exception: `GET /v1/events` is a Server-Sent Events stream,
not a JSON response, so the generated spec only documents its existence —
see that route's entry below and its description in `openapi.json` for the
per-event payload shape.

## Auth

Two independent schemes, never mixed in one request:

- **User session** — `POST /v1/auth/login` (or `/register`, local/demo mode
  only) sets an HttpOnly `trustrail_session` cookie. Every org-scoped user
  route additionally requires an `X-Organization-Id` header naming an
  organization the session's user is a member of (`GET /v1/me` lists
  memberships). Supplying an organization ID you're not a member of is a 403,
  never a silent scope change.
- **Agent credential** — `Authorization: Bearer <secret>` where `<secret>`
  came from `POST /v1/agents/:id/credentials`. Identifies exactly one agent
  in exactly one organization; there is no separate org header for this
  scheme (the organization is derived from the credential itself).

A few routes accept *either* (see the per-route notes below) because both a
human via the dashboard and an agent via the SDK legitimately need them.

## Health and discovery

| Route | Auth | Notes |
|---|---|---|
| `GET /health/live` | none | Process is up. |
| `GET /health/ready` | none | Also checks the database connection; 503 if unreachable. |
| `GET /.well-known/jwks.json` | none | Public signing keys (`{keys: JWK[]}`), excludes revoked keys. |

## Identity and organizations

| Route | Auth | Notes |
|---|---|---|
| `POST /v1/auth/register` | none | `{email, password}`. 403 outside local/demo mode. |
| `POST /v1/auth/login` | none | `{email, password}`. |
| `POST /v1/auth/logout` | session | Idempotent. |
| `POST /v1/organizations` | session | `{name}`. Creates the org, makes the caller Owner, seeds a published default policy for `refund.create`/sandbox. |
| `GET /v1/me` | session | Current user + all memberships (org id, name, role). |
| `GET /v1/memberships` | session + org | List members and roles. |
| `POST /v1/memberships` | session + org, Admin+ | `{email, role}`. Attaches a role to an *existing* account — there is no invite-by-email flow in V1. |

## Agents and credentials

| Route | Auth | Notes |
|---|---|---|
| `GET /v1/agents` | session + org | List. |
| `POST /v1/agents` | session + org, Operator+ | `{name, description, environment}`. |
| `GET /v1/agents/:id` | session + org | Includes credential history (never secrets). |
| `PATCH /v1/agents/:id` | session + org, owner-of-agent or Admin+ | `{name?, description?, status?}`. |
| `POST /v1/agents/:id/credentials` | session + org, owner-of-agent or Admin+ | Generates and returns a secret **once**: `{credential_id, secret, prefix, warning}`. |
| `POST /v1/credentials/:id/revoke` | session + org, owner-of-agent or Admin+ | Immediate; the credential can never authenticate again. |

## Grants (delegation)

| Route | Auth | Notes |
|---|---|---|
| `GET /v1/grants` | session + org | List. |
| `POST /v1/grants` | **either** | Root grant (`parent_grant_id: null`) requires a session, Admin+. Child grant (`parent_grant_id` set) requires the **parent grant's own subject agent's bearer credential** — the server derives the issuer from that credential, never from the request body. Rejects (422) a child that isn't a strict subset of its parent (actions/resources/connectors/amount/currency/expiry/delegation depth) — see `packages/policy-engine/src/chain.ts`. |
| `POST /v1/grants/:id/revoke` | session + org, Admin+ | `{reason}`. Invalidates the grant and everything delegated from it, effective on the next dispatch (online lookup, not a background cascade). |

## Policies

| Route | Auth | Notes |
|---|---|---|
| `GET /v1/policies` | session + org | Every bundle, with full version history. |
| `POST /v1/policies` | session + org, Admin+ | `{environment, bundle}`. Creates a new bundle *slot* with an initial draft version — 409 if one already exists for that environment/action. |
| `POST /v1/policies/:id/versions` | session + org, Admin+ | `{bundle, change_reason}`. Adds a new draft version to an existing bundle. |
| `POST /v1/policies/:id/publish` | session + org, Admin+ | `{version_id, expected_revision, change_reason}`. Optimistic-locked: fails with 409 if `expected_revision` doesn't match the bundle's current revision (someone else published first). |
| `POST /v1/simulations` | session + org | Same request shape as `POST /v1/actions`; runs the real evaluator, makes no reservation and no connector call. Response is explicitly labeled a prediction. |

## Actions (the gateway)

| Route | Auth | Notes |
|---|---|---|
| `POST /v1/actions` | agent, requires `Idempotency-Key` header | The core endpoint — see request/response shape below. |
| `GET /v1/actions` | session + org | `?limit&cursor&agent_id&decision&execution_state&from&to`. Cursor-paginated by `created_at`. |
| `GET /v1/actions/:id` | **either** (session+org, or agent scoped to its own org) | Full detail including delegation chain refs, approval, and linked receipts. |
| `GET /v1/connectors/:connectorId/resources/:resourceId` | agent | Read-only order lookup through the gateway (the agent never talks to the merchant directly). |

Request:

```json
{
  "grant_id": "grant_...",
  "connector_id": "merchant_sandbox",
  "action": "refund.create",
  "resource_id": "order_demo_101",
  "arguments": { "amount_minor": 8000, "currency": "EUR", "reason": "Return" }
}
```

Unknown/extra fields (`actor_id`, `principal_id`, `allowed`, `role`,
`policy_version`, any destination) are rejected with 400 — the schema is
strict, not merely permissive-with-server-side-override.

Response status: **200** if the decision resolved to a terminal state in
this same call (DENY, or ALLOW+succeeded/failed); **202** if it's still in
flight (REQUIRE_APPROVAL/awaiting_approval, or reserved/dispatching/unknown
— poll `GET /v1/actions/:id` or use an SDK's `actions.wait`); **409** for an
idempotency-key conflict (same key, different payload).

## Approvals

| Route | Auth | Notes |
|---|---|---|
| `GET /v1/approvals` | session + org, Approver+ | `?status=pending\|approved\|rejected\|expired`. |
| `POST /v1/approvals/:id/approve` | session + org, Approver+ | `{reason?}`. Atomic compare-and-set; a second concurrent decision gets 409 `ALREADY_DECIDED`. Rejects self-approval (reviewer is the action's own principal) with 403. Re-evaluates fresh — a since-superseded policy makes the approval `APPROVAL_EXPIRED`, requiring resubmission rather than honoring the stale decision. |
| `POST /v1/approvals/:id/reject` | session + org, Approver+ | Same binding/CAS semantics. |

## Receipts

| Route | Auth | Notes |
|---|---|---|
| `GET /v1/receipts/:id` | **either** | Full record: `{receipt_id, receipt_type, jws, payload, created_at}`. |
| `POST /v1/receipts/verify` | **none** | `{jws}`. Deliberately unauthenticated — verification must work for anyone holding a receipt. Response separates `signature_valid`, `issuer_trusted`, `key_status`, and the decoded `payload` — never collapsed into one boolean. |

## Metrics and events

| Route | Auth | Notes |
|---|---|---|
| `GET /v1/metrics/summary` | session + org | Real aggregates from stored actions/usage_events: counts by decision/execution state, execution success rate, and measured authorization-latency p50/p95/p99 — never a hardcoded number. |
| `GET /v1/events` | session + org | Server-Sent Events. Implemented as tenant-scoped short-interval polling of `audit_events`, not a push bus — see `docs/BUILD_STATUS.md`. |

## Demo (local/demo mode only — 403 in production)

| Route | Auth | Notes |
|---|---|---|
| `POST /v1/demo/runs` | session + org, Operator+ | `{scenario_key}` — one of the 12 keys in `apps/api/src/demo/scenarios.ts`. Only works inside the seeded Northstar Commerce org (run `pnpm demo:seed` first). |
| `GET /v1/demo/runs` | session + org | History of past runs and their step-by-step results. |
| `POST /v1/demo/reset` | session + org, Operator+ | Clears this org's activity data (actions/receipts/approvals/budgets/jobs), never identity/grants/policy. The authoritative reset path is the CLI (`pnpm demo:reset`), per spec section 14 — this route is a dashboard convenience. |

## Error codes you'll actually see

`BAD_REQUEST` (400), `UNAUTHORIZED`/`CREDENTIAL_REVOKED` (401), `FORBIDDEN`
(403), `NOT_FOUND` (404), `IDEMPOTENCY_CONFLICT`/`CONFLICT`/`ALREADY_DECIDED`
(409), `UNAVAILABLE` (503). Reason codes for a DENY decision are a separate,
larger vocabulary — see `packages/contracts/src/enums.ts`'s `REASON_CODES`
(e.g. `GRANT_REVOKED`, `AMOUNT_LIMIT`, `BUDGET_EXCEEDED`, `APPROVAL_EXPIRED`).
