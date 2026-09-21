# TrustRail: complete V1 build brief for Claude Code

Prepared for Yassine Aqejjaj | 21 September 2026

## 0. Your assignment

You are the founding engineer and product designer of TrustRail. Build the complete runnable V1 described here, including frontend, backend, database, enforcement gateway, SDKs, tests, documentation and a repeatable YC demonstration. Write the software, run it and validate it. Do not stop after scaffolding, a plan or a visual prototype.

This document is an implementation contract. Complete V1 means every mandatory capability below works end to end. It does not mean a finished global identity network or independently audited enterprise security product. Keep future capabilities explicitly separate from shipped functionality.

Use English for the product, code, documentation and demo. Make routine implementation decisions independently. Inspect the existing repository and its instructions first. Preserve unrelated work. Record significant decisions in `docs/DECISIONS.md`. Ask only for genuinely missing access, credentials or an unresolved requirement that prevents correct implementation. Never invent credentials or bypass an approval requirement. Build locally first; prepare deployment files without publishing or provisioning paid infrastructure unless separately authorized.

Maintain `docs/BUILD_STATUS.md` with requirement IDs, implementation status, supporting tests and actual limitations. If the work spans several sessions, leave an exact continuation checklist. Never label an incomplete feature as complete. Never silently replace persistence, cryptography or enforcement with fixtures.

## 1. Product thesis

**TrustRail controls what AI agents can do on behalf of people and companies, then records verifiable receipts of those actions.**

Public headline: **Let agents act. Keep control.**

Subheadline: **Set action limits, control delegation, require approval when needed, and verify what happened.**

For each protected operation, answer:

1. Which authenticated agent requested it?
2. Which person or service authorized that agent?
3. What limits apply across the entire delegation chain?
4. Was the action permitted, blocked or held for approval?
5. Did the downstream system execute it, and what evidence supports that outcome?

The first customer hypothesis is a B2B software team shipping a customer-support agent that can issue refunds. Buyer: engineering leader or head of AI. Daily users: application engineer, support manager and security reviewer. Immediate value: let an agent resolve routine refunds while constraining financial exposure and making exceptions reviewable.

Our first use case is refunds, not a general-purpose payments company. Money is represented in a synthetic merchant sandbox. No real funds move in the demo.

The differentiation hypothesis is the combination of delegation constraints, action-level enforcement, approval, shared budget accounting and portable signed receipts. Do not claim that OAuth lacks delegation, that no competitors exist, or that YC has endorsed TrustRail. Identity platforms and agent control planes already overlap with this category. A strong implementation and customer evidence must establish the business case.

## 2. Scope contract

### Mandatory V1

| ID | Capability | Completion evidence |
|---|---|---|
| V01 | Organization accounts, sessions, memberships and roles | Real login and tenant isolation tests |
| V02 | Agent registry and revocable credentials | Authenticated agent requests; revoked credentials fail |
| V03 | Human-to-agent and agent-to-agent delegation | Attenuated child grants and ancestor revocation tests |
| V04 | Versioned deterministic policies | Published policy controls live execution |
| V05 | Enforcement gateway | Agent cannot directly reach protected refund API |
| V06 | Human approval queue | Bound approval resumes exactly the approved request |
| V07 | Transactional shared budgets and idempotency | Concurrent attempts never exceed limits or double refund |
| V08 | Signed decision and execution receipts | Independent verification succeeds; altered receipt fails |
| V09 | Dashboard and action detail | UI reflects persistent real records |
| V10 | Deterministic demo lab | All scripted scenarios repeat without an LLM key |
| V11 | TypeScript and Python SDKs | Both execute the same live sandbox workflow |
| V12 | MCP tool adapter | Protected refund tool exercised by a test client |
| V13 | Developer docs and local setup | Clean checkout runs with documented commands |
| V14 | YC demo materials and landing page | Honest 90-second script and working product navigation |
| V15 | Observability and deployment package | Health checks, metrics, containers and runbook |

### Future scope, not required to claim V1 complete

Cross-company federation; verified human presence; legal identity verification; global agent reputation; enterprise SAML/SCIM; SOC 2 certification; hardware-backed keys; production payment connectors; automatic billing; marketplace; blockchain; universal remote MCP proxy; guaranteed prevention of prompt injection; autonomous policy generation; multi-region consistency.

Do not display these as active features. A future-work document is sufficient. Agent identity in V1 means an authenticated credential registered to an organization, not proof of the agent's code, model, intent or human nature.

## 3. Reference architecture and stack

Use a TypeScript monorepo with pnpm workspaces, strict typing, a supported Node LTS release and a committed lockfile. At implementation time verify official documentation for the versions you select; do not assume the newest major releases integrate correctly.

Preferred components:

- Next.js/React frontend, Tailwind CSS, accessible headless UI primitives and Lucide icons.
- Fastify API and gateway with schema validation and generated OpenAPI.
- PostgreSQL and Drizzle migrations. PostgreSQL is authoritative for budgets, approvals, grants, idempotency and jobs.
- A small PostgreSQL-backed worker for execution/reconciliation; no Redis requirement for V1.
- An established auth library for email/password sessions. Use Argon2id where password hashing is your responsibility. No custom session cryptography.
- `jose` or another maintained JOSE implementation for Ed25519 signatures; a tested RFC 8785 canonicalization library.
- Vitest for unit/integration tests, Playwright for browser tests, pytest for Python SDK tests.
- Official MCP SDK with a local stdio adapter initially.
- Docker Compose for the application and synthetic merchant service.

Repository layout:

```text
apps/web
apps/api
apps/worker
apps/merchant-sandbox
packages/contracts
packages/policy-engine
packages/receipt-verifier
packages/sdk-typescript
packages/mcp-adapter
sdk/python
examples/support-agent-ts
examples/support-agent-python
infra
tests/integration
tests/e2e
docs
```

The trusted execution path is: authenticated agent, gateway, current grant and policy evaluation, budget reservation, connector dispatch, merchant response, signed execution receipt. The dashboard uses the same API and records as SDK clients.

### Enforcement boundary

The gateway owns downstream credentials. Agent processes and browsers never receive them. The sandbox merchant write API is on a private container network and requires a gateway credential. Do not expose its write port on the host. An agent making a direct network request must fail. Read-only product views fetch merchant state through authorized backend routes.

An SDK check by itself is advisory and can be skipped. Never market it as enforcement. V1 enforcement comes from exclusive credential custody and routing through the gateway. Document that the guarantee fails if the customer gives the agent alternate downstream credentials or an unprotected write path.

## 4. Identity, accounts and access control

Implement Owner, Admin, Operator, Approver and Viewer roles. One organization may have many members. A human account can belong to multiple organizations; selecting an organization does not change authorization.

| Role | Rights |
|---|---|
| Owner | All actions, owner transfer and organization settings |
| Admin | Manage agents, grants, published policies and operator access; cannot transfer ownership |
| Operator | View operations, register owned agents within admin bounds, request grants and run permitted demos |
| Approver | Review assigned approval requests; no policy or credential administration |
| Viewer | Read redacted activity and reports; no secrets or mutations |

Only Owner/Admin can issue root grants. Root grants identify the accountable principal and issuer; those may differ. A user's name in a request is never evidence of their consent. Record authenticated issuers. Only a designated Approver/Owner/Admin may approve, and never their own initiated action.

Agent records include organization, name, description, owner, environment, status, last activity and credential history. Generate at least 256 bits of random API-key entropy. Show secrets once; store only a cryptographic digest, prefix and metadata. Constant-time comparison where relevant. Scope keys to an organization, agent and environment. Support rotation with explicit expiry and immediate revocation. A key authenticates an agent; it does not grant arbitrary downstream permissions.

Sessions use secure HttpOnly cookies in deployed environments, CSRF defenses, expiration and login rate limits. Disable open registration by default outside local/demo mode; provide a documented admin bootstrap command. Local seed accounts are explicitly demo-only and forbidden in production mode. Never expose a role-switching control outside an isolated demo organization. Automated browser tests should sign in as separate seeded users.

Tenant context is derived from verified membership or credentials. Never trust a supplied organization ID alone. Every query, foreign reference, export, event stream, worker job and cache key must be tenant-scoped. Use compound organization/object foreign keys and PostgreSQL row-level security where practical; the runtime DB role must not bypass RLS. Migration access is separate. Tenant isolation requires tests even when RLS is present.

## 5. Delegation model

A grant is a server-recorded, revocable capability. Implement root and child grants with parent references. The recipient authenticates using its own credential and presents a grant reference; a grant ID alone is not a bearer credential.

Grant fields:

```text
id, organization_id, environment, principal_id, issuer_type, issuer_id,
subject_agent_id, parent_grant_id, root_grant_id, allowed_actions,
allowed_resource_ids, allowed_connector_ids, currency,
max_amount_minor, root_budget_limit_minor, child_budget_limit_minor,
valid_from, expires_at, delegation_allowed, max_remaining_depth,
status, created_at, revoked_at, revocation_reason
```

Use exact action names and resource IDs in V1, not an ambiguous wildcard language. An optional unrestricted resource set must be explicit and admin-controlled. Empty means no resources, never all resources.

Child grants must be a subset of every ancestor's rights: actions, resources, connectors, currency, per-action cap, expiration and delegation depth. The authenticated parent subject must issue the child; the server derives issuer identity. Reject cycles, cross-tenant references, inactive parents, excessive depth and broader scopes. Default chain depth is at most three agent hops.

All descendants consume the root's shared budget and every applicable ancestor sub-budget. Creating children does not duplicate spending power. Decreasing a child cap never increases the root cap. Revoking or expiring an ancestor invalidates its descendants at execution time without requiring a background cascade to finish.

V1 uses online grant lookup on every dispatch, so revocation is effective for operations not yet dispatched. Already dispatched external actions cannot be undone by revocation. Show this distinction in the UI.

## 6. Policies and deterministic evaluation

Policies are typed data, never executable user JavaScript or LLM judgments. Provide a form editor, validated JSON view, simulation, draft/publish workflow and immutable versions. Use one active policy bundle per environment with optimistic locking to prevent lost updates.

Example bundle:

```json
{
  "schema_version": "1",
  "action": "refund.create",
  "currency": "EUR",
  "automatic_limit_minor": 10000,
  "approval_limit_minor": 50000,
  "root_daily_limit_minor": 100000,
  "require_original_payment_destination": true,
  "require_order_ownership": true,
  "max_order_age_days": 30,
  "deny_if_payment_disputed": true,
  "approval_ttl_seconds": 900
}
```

Interpretation: up to and including EUR 100 is automatic; more than EUR 100 and up to and including EUR 500 requires approval; above EUR 500 is denied. Other mandatory conditions still apply. A grant can impose a lower cap. Human approval cannot exceed a hard grant or policy limit.

Evaluation sequence:

1. Validate authentication, schema, environment and tenant.
2. Resolve the authenticated actor and entire grant chain.
3. Validate status, time, audience/action/resource scope and delegation attenuation.
4. Fetch authoritative order/payment data using the trusted connector.
5. Apply hard policy conditions and caps.
6. Determine whether a human approval is required and valid for this exact request.
7. Atomically check and reserve the applicable budgets before dispatch.

Precedence is DENY, then REQUIRE_APPROVAL, then ALLOW. Missing policies, invalid fields, unknown currencies, stale/unavailable required state or internal errors fail closed. An inability to evaluate is a system error, not proof of a policy violation; log the distinct cause.

Use integer minor units with checked bounds, EUR only in V1, UTC timestamps and server time. Reject negative amounts, zero refunds, decimals, overflow and duplicate JSON keys. Never accept caller-provided roles, order ownership, current balance, risk score or merchant facts as authority. Free text is display-only input and cannot alter policy evaluation.

Return reason codes, human-readable explanation, actual evaluated values, policy version/hash and matched checks. Required reason codes include `GRANT_REVOKED`, `GRANT_EXPIRED`, `SCOPE_MISMATCH`, `DELEGATION_WIDENING`, `AMOUNT_LIMIT`, `BUDGET_EXCEEDED`, `APPROVAL_REQUIRED`, `APPROVAL_EXPIRED`, `RESOURCE_MISMATCH`, `STATE_UNAVAILABLE` and `CONNECTOR_UNAVAILABLE`.

Simulation performs no external writes and no reservations. Label its outcome as a prediction, not a transferable authorization.

## 7. Action lifecycle, money and failure semantics

Store authorization decision separately from execution state. Decisions are ALLOW, DENY or REQUIRE_APPROVAL. Execution states are `received`, `awaiting_approval`, `ready`, `reserved`, `dispatching`, `succeeded`, `failed`, `unknown`, `denied`, `cancelled`, `expired`. Define legal transitions in code and tests.

The main `POST /v1/actions` endpoint authorizes and orchestrates execution. It returns an action ID and status. Denied actions never reach the merchant. Waiting actions have no usable execution token. Successful actions carry downstream references and an execution receipt. Long-running actions return 202 and support polling.

### Idempotency

Require an idempotency key for mutating action requests. Uniqueness scope: organization, authenticated actor and key. Hash the canonical action payload including grant, action, connector, resource and arguments. Same key and same payload returns the same action without a second write. Same key with another payload returns 409. Preserve records for at least the demo retention period and document production retention assumptions.

Use the TrustRail action ID as the connector idempotency key. The merchant service enforces unique refund operations and cannot refund more than the remaining order amount, even under concurrency and even across distinct TrustRail grants.

### Budgets

Implement transactional reservation with PostgreSQL row locks or serializable transactions, deterministic lock ordering and bounded retries. Reserve against every ancestor budget and the root daily budget in the same transaction as the execution claim. Count reserved plus committed spending. Daily windows use UTC boundaries; reservations retain their original window until resolved.

On confirmed success, commit the reservation. On a definitive failure before any effect, release it. On a timeout after possible dispatch, mark the action `unknown` and keep the reservation until reconciliation proves the outcome. Never free uncertain spending just because a worker lease expires.

An outbox/job written in the reservation transaction makes dispatch recoverable. Workers use bounded leases and claim ownership. Retries use the same connector idempotency key. Query downstream status after ambiguous outcomes. No claim of exactly-once execution across arbitrary remote services: V1 provides that behavior only with an idempotent sandbox connector and tested recovery semantics.

### Revocation and policy races

Immediately before committing the dispatch claim, recheck current grants, credential status, policy and approval. Serialize competing revocation/policy publication and dispatch decisions using a documented lock/version strategy. The dispatch claim is the boundary: revocation that commits first blocks dispatch; an already claimed dispatch may finish. Keep this boundary short, visible and auditable. Never claim cancellation of external effects already in flight.

If relevant policy or request state changed, reevaluate. Any approval tied to an earlier policy version is stale and must be requested again. Do not silently replay an earlier ALLOW.

## 8. Approval workflow

The approval inbox displays actor, accountable principal, complete delegation chain, order reference, exact amount, remaining budget, triggering rule and expiration. Show a clear Approve/Reject pair with optional reviewer reason. Require recent authenticated login for approval and record its timestamp.

Bind approval to organization, action ID, canonical request hash, principal, grant chain and policy version/hash. Default expiry is 15 minutes. It authorizes one action only. A changed amount, destination, resource, actor, grant or policy invalidates it. Approval cannot waive a revoked grant, budget limit, blocked destination or other hard denial.

Approval and action resumption use atomic compare-and-set transitions. Double clicks and parallel reviewers cannot double-dispatch. Rejecting prevents dispatch. Expired approvals require a new request or explicit reapproval workflow. Approvers cannot approve their own initiated actions. Reviewers never receive agent or merchant secrets.

## 9. Receipts and verification

Create separate signed decision receipts and signed execution receipts. An authorization receipt is not proof that an action happened. A receipt states what TrustRail recorded; it is not legal certification or proof that the reported external world state is universally true.

Example signed payload:

```json
{
  "schema_version": "1",
  "receipt_type": "execution",
  "receipt_id": "rcpt_example",
  "issuer": "trustrail-local",
  "organization_id": "org_example",
  "environment": "sandbox",
  "action_id": "act_example",
  "actor_id": "agent_refunds",
  "principal_id": "user_owner",
  "delegation_chain_ids": ["grant_root", "grant_child"],
  "action": "refund.create",
  "resource_id": "order_demo_101",
  "request_hash": "sha256:...",
  "policy_version_id": "pv_3",
  "policy_hash": "sha256:...",
  "decision": "ALLOW",
  "reason_codes": [],
  "approval_id": null,
  "outcome": "succeeded",
  "connector_reference": "refund_demo_001",
  "recorded_at": "2026-09-21T12:00:00Z"
}
```

Canonicalize with RFC 8785 and sign using an established JWS implementation with an explicit Ed25519 algorithm allowlist and receipt-specific `typ`. Include `kid` in the protected header. Separate any future authorization-token validation from receipt validation; a receipt cannot authorize another action.

Generate local keys on bootstrap, exclude private material from Git, and mount keys privately. Provide a signer interface for later KMS use without claiming that KMS exists in V1. Support key rotation and preserve old public keys for historical verification. Public-key discovery contains no private material.

The standalone verifier and SDK verifier accept pinned issuer keys or a trusted issuer configuration. Never trust a public key embedded by the same untrusted receipt as sufficient evidence. Reject unexpected algorithms, unknown issuers, incorrect types, malformed payloads and tampering. Report cryptographic integrity separately from key trust, key compromise status and execution outcome.

Store receipts and audit events as append-only under the runtime DB role. A privileged database administrator could still tamper with or delete records. Do not call the database immutable or claim deletion detection without an independent mechanism. Signatures detect payload modification, not omission. Export signed receipts so users can retain independent copies. Redact email, customer names, secrets and raw support messages from receipt payloads.

## 10. Data model

Use explicit relational tables, migrations, indexes and foreign keys. JSONB is acceptable for versioned policy and receipt payloads, not as a replacement for all constraints.

| Table | Essential content |
|---|---|
| organizations | Name, environment settings, created time |
| users / sessions / memberships | Authentication and organization roles |
| agents / agent_credentials | Owner, status, environment, secret digest and revocation |
| grants | Parent/root, principal, issuer, subject, constraints, status |
| policy_bundles / policy_versions | Immutable versions and active pointer |
| connectors | Organization, type, permitted resources, secret reference, state |
| actions | Actor, grant, request hash, decision, execution state, trace ID |
| idempotency_records | Scoped key, payload hash, action ID |
| approvals | Bound request and policy hashes, reviewer, state, expiry |
| budget_windows / budget_reservations | Root/ancestor limits, reserved and committed amounts |
| execution_jobs | Durable dispatch/reconciliation work, lease, attempt count |
| receipts | Signed payload, JWS, key ID, linked action and receipt type |
| signing_keys | Public keys and private-key references, never plaintext private keys |
| audit_events | Tenant-scoped actor, event, time and redacted metadata |
| usage_events | Actual authorization attempts, executions and latency |

Sandbox merchant tables live in its own database/schema and contain synthetic orders, payments and refunds. Never use real customer records as seed data. Add indexes for tenant/date, action status, grant parent/root, pending approval expiry and idempotency uniqueness. Document retention and export behavior. V1 does not implement billing from usage records.

## 11. API contract

Publish OpenAPI and typed shared schemas. Version under `/v1`. Reject unknown security-sensitive fields. All collection endpoints have bounded pagination and tenant-scoped filtering. Use structured errors with `code`, `message`, `request_id` and safe details; never stack traces or secrets.

| Endpoint | Behavior |
|---|---|
| `GET /health/live`, `GET /health/ready` | Process and dependency readiness |
| `GET /v1/me` | Current account, memberships and selected organization |
| `GET/POST /v1/agents` | List/register agent |
| `GET/PATCH /v1/agents/:id` | Inspect/update permitted metadata |
| `POST /v1/agents/:id/credentials` | Create or rotate a key, reveal once |
| `POST /v1/credentials/:id/revoke` | Revoke credential |
| `GET/POST /v1/grants` | Read/issue root or child grant under role rules |
| `POST /v1/grants/:id/revoke` | Revoke grant and effective descendant authority |
| `GET/POST /v1/policies` | Read/create policy draft |
| `POST /v1/policies/:id/versions` | Validate and save immutable version |
| `POST /v1/policies/:id/publish` | Publish specific version with expected revision |
| `POST /v1/simulations` | Explain predicted outcome without effects |
| `POST /v1/actions` | Authorize, queue or execute protected operation |
| `GET /v1/actions`, `GET /v1/actions/:id` | Activity and full redacted details |
| `GET /v1/approvals` | Reviewer's queue |
| `POST /v1/approvals/:id/approve` | Approve exact pending request |
| `POST /v1/approvals/:id/reject` | Reject pending request |
| `GET /v1/receipts/:id` | Authorized receipt retrieval |
| `POST /v1/receipts/verify` | Verify supplied receipt without treating it as authority |
| `GET /.well-known/jwks.json` | Receipt signing public keys |
| `GET /v1/metrics/summary` | Scoped real operational aggregates |
| `GET /v1/events` | Authenticated tenant-filtered SSE stream |
| `POST /v1/demo/runs` | Start an isolated deterministic scenario |

Demo reset is a local CLI command by default, not a public unauthenticated endpoint. Verification can run locally in-browser or via CLI; receipt retrieval is never public by guessed ID.

Action request example, authenticated by the subject agent credential:

```json
{
  "grant_id": "grant_refund_child",
  "connector_id": "merchant_sandbox",
  "action": "refund.create",
  "resource_id": "order_demo_101",
  "arguments": {
    "amount_minor": 8000,
    "currency": "EUR",
    "reason": "Customer return"
  }
}
```

Do not accept `actor_id`, `principal_id`, `allowed`, `role`, `policy_version` or a destination account from this caller. Resolve identity and policy server-side. Refund destination is the original payment destination from the merchant system.

Use 400/422 for invalid requests, 401 for authentication, 403 for forbidden management operations, 404 for inaccessible objects, 409 for idempotency/version conflicts, 429 for rate limits and 503 for unavailable dependencies. A persisted policy denial returns an action object with `decision: DENY`; define this consistently as HTTP 200 for completed evaluation and distinguish it from transport failure. Newly queued execution/approval returns 202. Never equate HTTP success with execution success.

## 12. SDKs, connectors and MCP

Both SDKs expose: `actions.execute`, `actions.get`, `actions.wait`, `grants.delegate`, `receipts.get` and `receipts.verify`. Admin management may remain REST-only. Provide typed results and exceptions, bounded timeouts and safe retry behavior. Mutation retries must preserve the original idempotency key. Never generate a new key after an ambiguous timeout. Redact credentials in logs.

TypeScript quickstart:

```ts
const client = new TrustRail({ baseUrl, apiKey });
const action = await client.actions.execute({
  grantId,
  connectorId: "merchant_sandbox",
  action: "refund.create",
  resourceId: orderId,
  arguments: { amount_minor: 8000, currency: "EUR", reason: "Return" },
  idempotencyKey: "demo-refund-001"
});
// Handle denied, awaiting_approval, pending, failed and unknown explicitly.
const result = await client.actions.wait(action.id, { timeoutMs: 30000 });
```

The connector interface supports trusted order lookup, refund execution with an idempotency key, and refund lookup by that key. Implement it fully for the merchant sandbox. Do not ship arbitrary user-supplied URLs, generic HTTP forwarding or customer-editable executable code in V1. Connector endpoints are configured by trusted operators and validated against an allowlist. This avoids making the gateway a server-side request forgery endpoint.

The MCP stdio adapter exposes `get_order`, `request_refund` and `get_action_status`. It uses a configured agent credential and grant, keeps the underlying merchant secret inaccessible and returns structured TrustRail statuses. Document local configuration and test with a real MCP client. Stdio identity comes from the configured credential; do not claim that this is a remote OAuth implementation. Any future HTTP MCP deployment must follow the current official authorization specification and avoid token passthrough.

The core demo must work without an LLM provider. An optional LLM support-agent example may propose tool calls, but the deterministic gateway remains the authority. Keep it behind an opt-in environment variable and label model/provider errors separately. Never let the model choose whether its own action is allowed.

## 13. Product experience and visual direction

Build a coherent product, not a collection of admin forms. Desktop first at 1440px and 1280px, usable at tablet/mobile widths. Use a light workspace, dark sidebar, restrained blue accent, crisp borders and readable tables. Suggested tokens: background `#F7F8FA`, surface `#FFFFFF`, text `#111827`, muted `#667085`, sidebar `#101828`, accent `#315CFD`, success `#16845B`, pending `#B7791F`, danger `#C63434`. Validate actual contrast ratios. Use status words/icons alongside color.

Use Inter or a local system sans font and a readable monospace font for technical fields. Keep generous spacing and restrained motion with reduced-motion support. Keyboard navigation, visible focus, accessible labels, confirmation for revocation and inline error recovery are required. Every view needs loading, empty, error and populated states. Copy-to-clipboard, filtering, pagination and export controls must work if shown.

### Pages

1. **Landing** (`/`): headline, product explanation, three real capabilities, genuine product screenshot or live preview, developer snippet, Sign in and View demo. No fake customers, YC logo, testimonials, savings or compliance badges. A pricing section may describe a future subscription-plus-usage model but must label pricing as unvalidated; no fake checkout.
2. **Onboarding**: create organization, select sandbox, register first agent, reveal API key once, issue initial grant, run first action. A checklist reflects completed server state. Never force a user to paste secrets into an external website.
3. **Overview**: actual action count, allowed/denied/awaiting approval, execution success rate and measured gateway latency. Clarify time range and denominators. Sandbox badge and activity chart. Empty means zero, not generated traction.
4. **Agents**: searchable list, status, owner, last seen, environment; detail with credentials, grants, recent actions and revoke controls.
5. **Delegations**: accessible tree showing principal, parent/child agents and effective limits. Selecting an edge reveals raw grant and inherited limits. Provide a table alternative; do not rely on an animated graph to convey permissions.
6. **Policies**: typed form, JSON tab, version history, test panel, publish with diff and change reason. Show which environment will change.
7. **Activity**: filter by date, agent, decision and execution status. Rows link to an action detail view.
8. **Action detail**: exact request summary, delegation chain, rule evaluation, budget reservation, approval timeline, connector outcome, receipts and trace ID. Clearly distinguish permitted from executed.
9. **Approvals**: pending inbox and history with bound request details and expiry. Approve/Reject requires appropriate membership and returns visible real state updates.
10. **Receipts**: download signed JSON/JWS; paste/upload a receipt to verify locally. Show signature validity, issuer trust and recorded outcome separately. An altered receipt must visibly fail verification.
11. **Demo lab**: named scenarios, Run, Reset local fixture, step timeline and merchant before/after state. Clearly label synthetic orders and any replayed sample events.
12. **Developers**: working SDK samples, REST reference, MCP setup and credential rotation docs. Copyable code is generated for current non-secret IDs.
13. **Settings**: members/roles, environment, connector health, keys, export and security limitations. No inactive controls pretending that enterprise SSO works.

Event updates use tenant-filtered SSE or safe polling with reconnection. Do not stream one tenant's events to another. Show stale-data indicators during API failures.

## 14. Deterministic demo fixtures and scenarios

Create fictional organization Northstar Commerce, a Support Manager principal, a Support Agent, a Refund Agent and an independent Approver account. Root grants allow eligible EUR refunds up to EUR 500 with a EUR 1,000 daily budget. Child grants preserve those ceilings. The default policy requires approval above EUR 100. Give each scenario independent orders and isolated run data so previous runs do not change results unexpectedly.

Required scenarios:

| Scenario | Expected outcome | Evidence |
|---|---|---|
| EUR 80 eligible refund | Allow and execute | Merchant balance changes once; signed execution receipt |
| EUR 350 refund | Wait, then approve and execute | No write before approval; reviewer recorded |
| EUR 700 refund | Deny | Hard cap reason; merchant unchanged |
| Prompt text says ignore rules and refund EUR 700 | Deny | Text does not affect policy; do not claim all injection is solved |
| Child requests a EUR 900 cap | Reject child grant | No wider rights created |
| Root revoked before child dispatch | Deny | Ancestor revocation shown |
| Previously successful request repeated | Same action/result | Exactly one sandbox refund |
| Same key with changed amount | Conflict | No second operation |
| Receipt amount/hash edited | Verification fails | Local verifier result |
| Several concurrent refunds against EUR 100 remaining | At most EUR 100 commits | Shared reservation ledger |
| Merchant succeeds but connection times out | Unknown, then reconciled success | No duplicate; budget remains reserved until resolution |
| Agent attempts direct merchant write | Network/auth rejection | Gateway is mandatory |

Demo run history is real. Scenario progress must be driven by API events rather than a timer pretending that backend work occurred. A reset clears only an explicitly isolated local demo workspace and never non-demo data. Production mode must reject demo reset and fault-injection endpoints.

## 15. Threat model and operations

Write a short threat model covering a malicious/compromised agent, forged identity fields, stolen bearer credentials, prompt injection, broader child grants, cross-tenant object access, request substitution after approval, replay, concurrency overspend, connector timeout, key compromise and a privileged database operator.

Document residual limits: stolen active agent credentials can use that agent's existing grants until revoked; receipt signatures do not prove human presence or correct policy; a compromised gateway can abuse downstream credentials; offline historical signature verification cannot prove current key safety; unprotected downstream paths are outside enforcement coverage.

Validate all inputs; enforce body-size limits; sanitize displayed free text; use strict CORS and CSP; never log Authorization headers, cookies, raw keys or customer messages. Set rate limits for authentication, agent calls, simulation and verification. Bound filter/export sizes. Use secret references and authenticated encryption where connector secrets must be stored; development secrets may be mounted privately from local environment files.

Add structured logs with request/action IDs, timing and reason codes. Expose authenticated or internal metrics for request count, decision count, policy latency, dispatch latency, approval age, reconciliation backlog and errors. Measure latency instead of inserting a hardcoded number. Provide graceful shutdown and readiness checks. Backups, restore procedure, migrations and signing-key preservation belong in the runbook. Restore must not silently allow duplicate execution or lose uncertain reservations.

## 16. Verification requirements

Build meaningful tests for the security and money boundaries. Use a real ephemeral PostgreSQL instance for transactions and concurrency; in-memory mocks cannot validate locking behavior.

Mandatory tests:

- Tenant A cannot read, mutate, approve, export or subscribe to Tenant B objects, including guessed IDs and worker jobs.
- Role restrictions apply server-side, not just in the UI.
- An agent cannot impersonate another actor or principal through JSON fields.
- Broader child constraints fail; an expired/revoked ancestor blocks descendants.
- EUR 100 is automatic, EUR 100.01 requires approval, EUR 500 requires approval and EUR 500.01 is denied under the default policy.
- Invalid amounts, currencies, duplicate fields and unknown actions fail safely.
- Approval cannot be reused for another payload or policy version and cannot bypass hard denial; self-approval fails.
- Concurrent budget reservations never exceed root or ancestor limits.
- Simultaneous retries and worker restarts do not duplicate sandbox refunds.
- Revocation before dispatch wins; already dispatched operations remain accurately reported.
- Timeout-before-effect, timeout-after-effect, process crash and reconciliation preserve correct money accounting.
- Receipt tampering, algorithm changes, wrong issuer and unknown key fail; historical receipts verify after legitimate rotation.
- Missing database or signing service prevents unrecorded dispatch. No available policy means no write.
- Direct merchant writes from agent context fail.
- SDK contract tests run against the real API; Python and TypeScript verify a common signed fixture.
- Playwright covers onboarding, first refund, denial explanation, independent reviewer approval and receipt verification.

Run a reproducible benchmark with documented hardware, concurrency, sample size, error rate and p50/p95/p99. Suggested engineering goal: p95 authorization evaluation below 100 ms on local seeded data, excluding downstream execution. This is a target, not a published claim. Report actual measurements and bottlenecks.

## 17. Implementation sequence and completion gates

### Phase 1: Foundation

Create monorepo, shared schemas, migrations, authentication, tenant isolation, Docker services and synthetic merchant. Gate: clean setup, login, organization isolation and merchant idempotency tests pass.

### Phase 2: Real protected action

Implement agent credentials, root/child grants, policy evaluator, action API, gateway credential custody, reservation transaction, worker and recovery. Gate: allowed, denied, concurrent and ambiguous-outcome integration tests pass before building elaborate UI.

### Phase 3: Review and evidence

Implement approvals, request binding, receipts, key rotation, verifier and audit records. Gate: separate reviewer completes EUR 350 workflow; altered receipt fails; replay cannot duplicate execution.

### Phase 4: Product interface

Build the pages above against the API. Gate: required browser flows work with real persistent data, including failure states. Capture screenshots and inspect layout at desktop and mobile widths.

### Phase 5: Developer adoption

Deliver both SDKs, MCP adapter, examples, API docs and first-action quickstart. Gate: clean examples work without private knowledge or manual database edits.

### Phase 6: YC presentation and handoff

Add deterministic demo scenarios, landing, measured performance, demo script and deployment runbook. Gate: clean checkout passes the documented verification command and the demonstration is repeatable.

Do not optimize for number of screens over a working enforcement path. Do not stop at Phase 2: all mandatory phases define this V1. If a dependency genuinely blocks a later phase, finish independent work and report the exact remaining blocker.

## 18. Required commands and deliverables

Provide these commands or documented equivalents with identical intent:

```bash
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
pnpm demo:seed
pnpm verify
pnpm demo:run
pnpm demo:reset
pnpm benchmark
docker compose up --build
```

`setup:local` creates safe local configuration and local keys, runs migrations and explains any prerequisites. It does not overwrite existing secrets. `verify` runs lint/type checks, relevant tests, production build and SDK validation, with a nonzero exit on failure. State Python requirements and virtual-environment setup explicitly. Seed/reset are guarded and idempotent. Docker startup uses health checks and an explicit migration/bootstrap step.

Deliver:

- Complete source and committed dependency lockfiles.
- `.env.example` with descriptions and no working external credentials.
- `README.md` with a first-success path and honest deployment status.
- `docs/ARCHITECTURE.md`, `THREAT_MODEL.md`, `DECISIONS.md`, `BUILD_STATUS.md`.
- `docs/API.md`, `SDK_QUICKSTART.md`, `MCP_SETUP.md`, `OPERATIONS.md`.
- `docs/TEST_REPORT.md` with actual commands, results and unresolved failures.
- `docs/DEMO_SCRIPT.md`, `YC_PRODUCT_BRIEF.md`, `ROADMAP.md`.
- Dockerfiles, Compose configuration, CI workflow and deployment checklist.
- Screenshots captured from the running application, not invented designs.

Final implementation report: what works, how to start, actual test results, demo account setup, security limits and exact remaining work. Never claim tests passed if they were not run.

## 19. YC demonstration and business narrative

The demonstration should answer one question: can an AI agent perform a useful financial operation while the company retains enforceable limits?

### 90-second demonstration

| Time | Action | Narration |
|---|---|---|
| 0-15 s | Show agent and refund policy | "AI support agents can resolve refunds. Companies need to control what those agents can actually spend." |
| 15-30 s | Run EUR 80 refund | "This agent acts through a delegated permission. The refund succeeds and we record its result." |
| 30-45 s | Attempt EUR 700 refund | "Even when the agent requests more, the gateway blocks the operation before the merchant receives it." |
| 45-65 s | Run EUR 350 request; independent reviewer approves | "This amount needs a human. Approval applies only to this exact action." |
| 65-80 s | Inspect delegation and verify receipt | "We can trace who authorized the agent and verify the recorded execution." |
| 80-90 s | Show SDK example and revoke grant | "Teams integrate once. They can then change limits or stop future delegated actions centrally." |

Use prerecorded backup footage only when clearly labeled. All demo amounts are synthetic. The presentation must never imply existing customers, revenue, independent security audits or YC acceptance.

Create a one-page YC product brief with problem, buyer, first use case, product, what works, alternatives, differentiation hypothesis and next validation steps. Use placeholders such as `[customer interviews pending]` and `[revenue not provided]` for absent business evidence. Do not turn demo event counts into traction. Founder background may identify Yassine Aqejjaj, Head of AI at Devoteam Creative Tech, as provided by the founder; do not imply Devoteam sponsorship, ownership transfer or permission to reuse internal code. Build TrustRail independently without importing NOVA, ORBIT or FORGE assets.

Commercial hypothesis: a platform subscription plus usage-based protected actions, with enterprise deployment later. No validated price or market size has been provided. Do not implement billing or invent market estimates. Instrument integration time, protected-action volume, decision latency and approval turnaround as product metrics. Customer discovery should validate willingness to pay, current controls, who owns the budget and whether gateway integration is acceptable.

Expansion sequence after V1 validation: support refunds, other bounded financial operations, internal administrative writes, then cross-organization delegation. The long-term trust network is a hypothesis, not an implemented moat.

## 20. Sources and boundaries

Consulted 21 September 2026. These sources ground terminology and standards; the product design above is a proposed implementation, not a statement that these organizations endorse it.

- YC Requests for Startups: https://www.ycombinator.com/rfs . YC publishes areas of interest; that does not establish novelty or demand for this exact product.
- Agentic Fabriq YC profile: https://www.ycombinator.com/companies/agentic-fabriq . Relevant category overlap; no exhaustive competitive study is claimed.
- OAuth 2.0 Token Exchange, RFC 8693: https://www.rfc-editor.org/info/rfc8693/ . Existing delegation-related mechanisms matter. V1's server-side grant model is not a claim of full RFC 8693 conformance.
- JWT Best Current Practices, RFC 8725: https://www.rfc-editor.org/info/rfc8725/ . Use established token validation practices and explicit algorithm/type separation.
- JSON Canonicalization Scheme, RFC 8785: https://www.rfc-editor.org/info/rfc8785/ . Canonical JSON supports reproducible payload hashing; use a tested implementation.
- MCP authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization . Recheck the official current specification when implementing remote HTTP transport. Local stdio is a separate scope.

## Final instruction to Claude Code

Start by inspecting the repository. Produce a short implementation plan, then build Phase 1 immediately and continue through all six phases. Preserve this specification as `docs/PRODUCT_SPEC.md`. Keep the requirement checklist current. Demonstrate real enforcement before polishing the demo. Finish with runnable software and evidence, not a proposal.
