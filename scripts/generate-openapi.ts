/**
 * Generates docs/openapi.json from the zod schemas that actually validate
 * each route's request body/query in apps/api/src/routes/*.ts, plus a set
 * of lightweight response schemas mirrored from what each handler actually
 * returns (see docs/ROADMAP.md item 5: "OpenAPI generation from the zod
 * schemas in packages/contracts, so docs/API.md stops being hand-maintained").
 *
 * This intentionally imports the *same* schema objects the routes call
 * `.safeParse()` on -- either re-exported from packages/contracts (the
 * common case) or, for a handful of route-local schemas that were only
 * ever `const` (never part of the shared contracts package because they
 * are pure HTTP-layer concerns, e.g. auth/org/membership/policy-draft
 * payloads), imported directly from the route module itself. Nothing here
 * hand-retypes a request shape -- if a route's validation changes, this
 * generator picks it up the next time it runs, because it points at the
 * exact same `ZodObject`.
 *
 * Response shapes are a different story: most routes return a plain
 * object literal built by a `serializeXxx()` helper, not a zod schema (zod
 * only guards input, this API never validates its own output). For those,
 * this file defines a small zod schema next to the route it documents,
 * built strictly from reading the handler's actual `return`/`reply.send()`
 * call -- see the comment above each one for which function it mirrors.
 *
 * Run with: pnpm generate:openapi
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Schemas actually used to validate requests, imported from their one real
// source of truth.
// ---------------------------------------------------------------------------
import {
  ROLES,
  ENVIRONMENTS,
  AGENT_STATUSES,
  CREDENTIAL_STATUSES,
  GRANT_STATUSES,
  DECISIONS,
  EXECUTION_STATES,
  APPROVAL_STATUSES,
  POLICY_VERSION_STATUSES,
  RECEIPT_TYPES,
  REASON_CODES,
  createAgentRequestSchema,
  updateAgentRequestSchema,
  createGrantRequestSchema,
  revokeGrantRequestSchema,
  policyBundleSchema,
  createActionRequestSchema,
  decideApprovalRequestSchema,
  resolveReconciliationRequestSchema,
  verifyReceiptRequestSchema,
  receiptVerificationResultSchema,
} from "../packages/contracts/src/index.js";

import { registerSchema, loginSchema } from "../apps/api/src/routes/auth.js";
import { createOrgSchema } from "../apps/api/src/routes/organizations.js";
import { addMembershipSchema } from "../apps/api/src/routes/memberships.js";
import { createPolicyDraftSchema, addVersionSchema, publishSchema } from "../apps/api/src/routes/policies.js";
import { listQuerySchema } from "../apps/api/src/routes/actions.js";
import { runRequestSchema } from "../apps/api/src/routes/demo.js";
import { SCENARIO_KEYS } from "../apps/api/src/demo/scenarios.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const registry = new OpenAPIRegistry();

const bearerAuth = registry.registerComponent("securitySchemes", "AgentBearer", {
  type: "http",
  scheme: "bearer",
  description:
    "Agent credential: `Authorization: Bearer <secret>` returned once by POST /v1/agents/:id/credentials. Identifies exactly one agent in exactly one organization.",
});
const sessionCookie = registry.registerComponent("securitySchemes", "SessionCookie", {
  type: "apiKey",
  in: "cookie",
  name: "trustrail_session",
  description:
    "HttpOnly session cookie set by POST /v1/auth/login or /v1/auth/register. Most session-authenticated routes also require the X-Organization-Id header (see the OrganizationId parameter).",
});

const organizationIdHeader = registry.registerParameter(
  "OrganizationId",
  z
    .string()
    .openapi({
      param: {
        name: "X-Organization-Id",
        in: "header",
        required: true,
        description: "Organization the session's user is a member of. Required on every org-scoped user route.",
      },
    })
);

// Every error response uses this exact envelope -- see apps/api/src/http/errors.ts (sendApiError).
const errorSchema = registry.register(
  "Error",
  z
    .object({
      code: z.string().openapi({ example: "BAD_REQUEST" }),
      message: z.string(),
      request_id: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi("Error")
);

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: errorSchema } } };
}

function jsonResponse(description: string, schema: z.ZodTypeAny) {
  return { description, content: { "application/json": { schema } } };
}

// Generic `{id}` path param used by most `/v1/<resource>/:id` routes -- not
// a business schema, just the REST path-parameter convention, so it is not
// worth importing/duplicating a dedicated contracts export for it.
const idParam = (name = "id") => z.object({ [name]: z.string() });

const statusOkSchema = z.object({ status: z.literal("ok") }).openapi("StatusOk");

// ---------------------------------------------------------------------------
// Health and discovery
// ---------------------------------------------------------------------------
registry.registerPath({
  method: "get",
  path: "/health/live",
  tags: ["Health"],
  summary: "Liveness probe",
  responses: {
    200: jsonResponse("Process is up.", z.object({ status: z.literal("ok") })),
  },
});

registry.registerPath({
  method: "get",
  path: "/health/ready",
  tags: ["Health"],
  summary: "Readiness probe",
  description: "Also checks the database connection.",
  responses: {
    200: jsonResponse("Database reachable.", z.object({ status: z.literal("ok") })),
    503: jsonResponse("Database not reachable.", z.object({ code: z.literal("UNAVAILABLE"), message: z.string() })),
  },
});

// Mirrors getPublicJwks() (apps/api/src/gateway/keys.ts) -- a jose JWK,
// loosely typed here since its exact fields depend on the key's algorithm.
const jwkSchema = z
  .object({ kty: z.string(), kid: z.string().optional(), use: z.string().optional(), alg: z.string().optional(), crv: z.string().optional(), x: z.string().optional() })
  .passthrough()
  .openapi("Jwk");

registry.registerPath({
  method: "get",
  path: "/.well-known/jwks.json",
  tags: ["Health"],
  summary: "Public signing keys (JWKS)",
  description: "Excludes revoked keys. Used to independently verify a receipt's JWS.",
  responses: {
    200: jsonResponse("JWK set.", z.object({ keys: z.array(jwkSchema) })),
  },
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
registry.registerPath({
  method: "post",
  path: "/v1/auth/register",
  tags: ["Auth"],
  summary: "Register (local/demo mode only)",
  request: { body: { content: { "application/json": { schema: registerSchema } } } },
  responses: {
    201: jsonResponse("Account created; session cookie set.", z.object({ user_id: z.string(), email: z.string() })),
    400: errorResponse("Invalid payload."),
    403: errorResponse("Open registration disabled (production mode)."),
    409: errorResponse("An account with this email already exists."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/auth/login",
  tags: ["Auth"],
  summary: "Login",
  request: { body: { content: { "application/json": { schema: loginSchema } } } },
  responses: {
    200: jsonResponse("Session cookie set.", z.object({ user_id: z.string(), email: z.string() })),
    401: errorResponse("Invalid email or password."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/auth/logout",
  tags: ["Auth"],
  summary: "Logout (idempotent)",
  responses: {
    200: jsonResponse("Always ok, even if the session was already invalid.", statusOkSchema),
  },
});

// ---------------------------------------------------------------------------
// Identity and organizations
// ---------------------------------------------------------------------------
registry.registerPath({
  method: "post",
  path: "/v1/organizations",
  tags: ["Organizations"],
  summary: "Create an organization",
  description: "Creates the org, makes the caller its Owner, and seeds a published default policy for refund.create/sandbox.",
  security: [{ [sessionCookie.name]: [] }],
  request: { body: { content: { "application/json": { schema: createOrgSchema } } } },
  responses: {
    201: jsonResponse("Organization created.", z.object({ organization_id: z.string(), name: z.string(), role: z.literal("owner") })),
    400: errorResponse("Invalid payload."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/me",
  tags: ["Organizations"],
  summary: "Current user and memberships",
  security: [{ [sessionCookie.name]: [] }],
  responses: {
    200: jsonResponse(
      "Current user + all memberships.",
      z.object({
        user_id: z.string(),
        email: z.string(),
        memberships: z.array(z.object({ organization_id: z.string(), organization_name: z.string(), role: z.enum(ROLES) })),
      })
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/memberships",
  tags: ["Organizations"],
  summary: "List members and roles",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: {
    200: jsonResponse(
      "Members of the current organization.",
      z.object({
        memberships: z.array(z.object({ membership_id: z.string(), user_id: z.string(), email: z.string(), role: z.enum(ROLES), created_at: z.string() })),
      })
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/memberships",
  tags: ["Organizations"],
  summary: "Attach a role to an existing account (Admin+)",
  description: "There is no invite-by-email flow in V1 -- the target user must already have an account.",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader], body: { content: { "application/json": { schema: addMembershipSchema } } } },
  responses: {
    200: jsonResponse("Existing membership's role updated.", z.object({ membership_id: z.string(), role: z.enum(ROLES) })),
    201: jsonResponse("New membership created.", z.object({ membership_id: z.string(), role: z.enum(ROLES) })),
    403: errorResponse("Only an Owner may grant the Owner role."),
    404: errorResponse("No account exists for this email."),
  },
});

// ---------------------------------------------------------------------------
// Agents and credentials
// ---------------------------------------------------------------------------
// Mirrors serializeAgent() in apps/api/src/routes/agents.ts.
const agentSchema = z
  .object({
    agent_id: z.string(),
    name: z.string(),
    description: z.string(),
    owner_user_id: z.string(),
    environment: z.enum(ENVIRONMENTS),
    status: z.enum(AGENT_STATUSES),
    last_activity_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("Agent");

const agentCredentialSummarySchema = z.object({
  credential_id: z.string(),
  prefix: z.string(),
  status: z.enum(CREDENTIAL_STATUSES),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});

registry.registerPath({
  method: "get",
  path: "/v1/agents",
  tags: ["Agents"],
  summary: "List agents",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: { 200: jsonResponse("Agents in this organization.", z.object({ agents: z.array(agentSchema) })) },
});

registry.registerPath({
  method: "post",
  path: "/v1/agents",
  tags: ["Agents"],
  summary: "Create an agent (Operator+)",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader], body: { content: { "application/json": { schema: createAgentRequestSchema } } } },
  responses: {
    201: jsonResponse("Agent created.", z.object({ agent_id: z.string() })),
    400: errorResponse("Invalid payload."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/agents/{id}",
  tags: ["Agents"],
  summary: "Get an agent, including credential history",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader] },
  responses: {
    200: jsonResponse("Agent detail. Never includes secrets.", agentSchema.extend({ credentials: z.array(agentCredentialSummarySchema) })),
    404: errorResponse("Agent not found."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/agents/{id}",
  tags: ["Agents"],
  summary: "Update an agent (owner-of-agent or Admin+)",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader], body: { content: { "application/json": { schema: updateAgentRequestSchema } } } },
  responses: {
    200: jsonResponse("Updated.", statusOkSchema),
    403: errorResponse("Not permitted to manage this agent."),
    404: errorResponse("Agent not found."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/agents/{id}/credentials",
  tags: ["Agents"],
  summary: "Issue a new credential (owner-of-agent or Admin+)",
  description: "The secret is returned once and cannot be retrieved again.",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader] },
  responses: {
    201: jsonResponse(
      "Secret shown once.",
      z.object({ credential_id: z.string(), secret: z.string(), prefix: z.string(), warning: z.string() })
    ),
    403: errorResponse("Not permitted to manage this agent."),
    404: errorResponse("Agent not found."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/credentials/{id}/revoke",
  tags: ["Agents"],
  summary: "Revoke a credential (owner-of-agent or Admin+)",
  description: "Immediate; the credential can never authenticate again.",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader] },
  responses: {
    200: jsonResponse("Revoked.", statusOkSchema),
    403: errorResponse("Not permitted to manage this credential."),
    404: errorResponse("Credential not found."),
  },
});

// ---------------------------------------------------------------------------
// Grants (delegation)
// ---------------------------------------------------------------------------
// Mirrors serializeGrant() in apps/api/src/routes/grants.ts.
const grantSchema = z
  .object({
    grant_id: z.string(),
    environment: z.enum(ENVIRONMENTS),
    principal_id: z.string(),
    issuer_type: z.enum(["user", "agent"]),
    issuer_id: z.string(),
    subject_agent_id: z.string(),
    parent_grant_id: z.string().nullable(),
    root_grant_id: z.string(),
    allowed_actions: z.array(z.string()),
    allowed_resource_ids: z.array(z.string()),
    unrestricted_resources: z.boolean(),
    allowed_connector_ids: z.array(z.string()),
    currency: z.string(),
    max_amount_minor: z.number(),
    root_budget_limit_minor: z.number().nullable(),
    child_budget_limit_minor: z.number().nullable(),
    valid_from: z.string().nullable(),
    expires_at: z.string().nullable(),
    delegation_allowed: z.boolean(),
    max_remaining_depth: z.number(),
    status: z.enum(GRANT_STATUSES),
    created_at: z.string(),
    revoked_at: z.string().nullable(),
  })
  .openapi("Grant");

registry.registerPath({
  method: "get",
  path: "/v1/grants",
  tags: ["Grants"],
  summary: "List grants",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: { 200: jsonResponse("Grants in this organization.", z.object({ grants: z.array(grantSchema) })) },
});

registry.registerPath({
  method: "post",
  path: "/v1/grants",
  tags: ["Grants"],
  summary: "Issue a grant (root: session Admin+; child: parent grant's subject agent bearer credential)",
  description:
    "A root grant (parent_grant_id: null) requires a user session (Admin+). A child grant requires the Authorization bearer credential of the parent grant's own subject agent -- the server derives the issuer from that credential, never from the request body.",
  security: [{ [sessionCookie.name]: [] }, { [bearerAuth.name]: [] }],
  request: { body: { content: { "application/json": { schema: createGrantRequestSchema } } } },
  responses: {
    201: jsonResponse("Grant created.", z.object({ grant_id: z.string() })),
    400: errorResponse("Invalid payload."),
    403: errorResponse("Not permitted to issue this grant."),
    404: errorResponse("Parent grant not found."),
    422: errorResponse("Child grant is not a strict subset of its parent, or delegation depth exceeded."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/grants/{id}/revoke",
  tags: ["Grants"],
  summary: "Revoke a grant and everything delegated from it (Admin+)",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader], body: { content: { "application/json": { schema: revokeGrantRequestSchema } } } },
  responses: {
    200: jsonResponse("Revoked.", statusOkSchema),
    404: errorResponse("Grant not found."),
  },
});

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------
// Mirrors serializeVersion() and the GET /v1/policies handler in
// apps/api/src/routes/policies.ts.
const policyVersionSchema = z.object({
  version_id: z.string(),
  version_number: z.number(),
  bundle: policyBundleSchema,
  bundle_hash: z.string(),
  status: z.enum(POLICY_VERSION_STATUSES),
  change_reason: z.string(),
  created_at: z.string(),
  published_at: z.string().nullable(),
});

const policyBundleListEntrySchema = z.object({
  policy_bundle_id: z.string(),
  environment: z.enum(ENVIRONMENTS),
  action: z.string(),
  active_version_id: z.string().nullable(),
  revision: z.number(),
  versions: z.array(policyVersionSchema),
});

registry.registerPath({
  method: "get",
  path: "/v1/policies",
  tags: ["Policies"],
  summary: "List every policy bundle with full version history",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: { 200: jsonResponse("Policy bundles.", z.object({ policies: z.array(policyBundleListEntrySchema) })) },
});

registry.registerPath({
  method: "post",
  path: "/v1/policies",
  tags: ["Policies"],
  summary: "Create a new policy bundle slot with an initial draft version (Admin+)",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader], body: { content: { "application/json": { schema: createPolicyDraftSchema } } } },
  responses: {
    201: jsonResponse("Draft created.", z.object({ policy_bundle_id: z.string(), version_id: z.string() })),
    409: errorResponse("A policy bundle already exists for this environment/action."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/policies/{id}/versions",
  tags: ["Policies"],
  summary: "Add a new draft version to an existing bundle (Admin+)",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader], body: { content: { "application/json": { schema: addVersionSchema } } } },
  responses: {
    201: jsonResponse("Draft version added.", z.object({ version_id: z.string() })),
    400: errorResponse("Bundle action must match the policy bundle's action."),
    404: errorResponse("Policy bundle not found."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/policies/{id}/publish",
  tags: ["Policies"],
  summary: "Publish a draft version (Admin+)",
  description: "Optimistic-locked: fails with 409 if expected_revision doesn't match the bundle's current revision.",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader], body: { content: { "application/json": { schema: publishSchema } } } },
  responses: {
    200: jsonResponse("Published.", statusOkSchema),
    404: errorResponse("Policy bundle or version not found."),
    409: errorResponse("expected_revision is stale."),
  },
});

// Mirrors the reply.send(...) object literal in registerSimulationRoutes
// (apps/api/src/routes/simulations.ts).
registry.registerPath({
  method: "post",
  path: "/v1/simulations",
  tags: ["Policies"],
  summary: "Predict the outcome of an action without reserving or writing anything",
  description: "Same request shape as POST /v1/actions; runs the real evaluator, makes no reservation and no connector call.",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader], body: { content: { "application/json": { schema: createActionRequestSchema } } } },
  responses: {
    200: jsonResponse(
      "Predicted outcome, not a transferable authorization.",
      z.object({
        prediction: z.literal(true),
        note: z.string(),
        decision: z.enum(DECISIONS),
        reason_codes: z.array(z.enum(REASON_CODES)),
        explanation: z.string(),
        matched_checks: z.array(z.unknown()),
        evaluated_values: z.record(z.string(), z.unknown()),
      })
    ),
    400: errorResponse("Invalid simulation request."),
  },
});

// ---------------------------------------------------------------------------
// Actions (the gateway)
// ---------------------------------------------------------------------------
// Mirrors serializeActionSummary()/serializeAction() in apps/api/src/routes/actions.ts.
const actionSummarySchema = z.object({
  action_id: z.string(),
  action: z.string(),
  resource_id: z.string(),
  actor_agent_id: z.string(),
  grant_id: z.string(),
  decision: z.enum(DECISIONS),
  execution_state: z.enum(EXECUTION_STATES),
  reason_codes: z.array(z.enum(REASON_CODES)),
  amount_minor: z.number(),
  currency: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const actionDetailSchema = actionSummarySchema.extend({
  environment: z.enum(ENVIRONMENTS),
  connector_id: z.string(),
  connector_reference: z.string().nullable(),
  root_grant_id: z.string(),
  principal_id: z.string(),
  policy_version_id: z.string().nullable(),
  policy_hash: z.string().nullable(),
  request_hash: z.string(),
  trace_id: z.string().nullable(),
  approval: z
    .object({
      approval_id: z.string(),
      status: z.enum(APPROVAL_STATUSES),
      expires_at: z.string().nullable(),
      reviewer_user_id: z.string().nullable(),
      decided_at: z.string().nullable(),
    })
    .nullable(),
  receipts: z.array(z.object({ receipt_id: z.string(), receipt_type: z.enum(RECEIPT_TYPES), created_at: z.string() })),
});

registry.registerPath({
  method: "post",
  path: "/v1/actions",
  tags: ["Actions"],
  summary: "Submit an action for authorization",
  description:
    "The core endpoint. Requires an Idempotency-Key header. Response is 200 if the decision resolved to a terminal state in this same call, 202 if still in flight, 409 for an idempotency-key conflict.",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    headers: z.object({ "idempotency-key": z.string().openapi({ description: "Required. Same key + same payload replays the prior result; same key + different payload is a 409." }) }),
    body: { content: { "application/json": { schema: createActionRequestSchema } } },
  },
  responses: {
    200: jsonResponse("Terminal in this call (DENY, or ALLOW+succeeded/failed).", actionDetailSchema),
    202: jsonResponse("Still in flight (REQUIRE_APPROVAL, or reserved/dispatching/unknown).", actionDetailSchema),
    400: errorResponse("Missing Idempotency-Key header."),
    409: errorResponse("Idempotency-key conflict: same key, different payload."),
    422: errorResponse("Invalid action request."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/connectors/{connectorId}/resources/{resourceId}",
  tags: ["Actions"],
  summary: "Read-only order lookup through the gateway",
  description: "The agent never talks to the merchant directly; the gateway owns the connector credential.",
  security: [{ [bearerAuth.name]: [] }],
  request: { params: z.object({ connectorId: z.string(), resourceId: z.string() }) },
  responses: {
    200: jsonResponse(
      "Order facts.",
      z.object({ resource_id: z.string(), remaining_amount_minor: z.number(), currency: z.string(), age_days: z.number(), disputed: z.boolean() })
    ),
    404: errorResponse("Unknown connector or resource not found."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/actions",
  tags: ["Actions"],
  summary: "List actions, cursor-paginated by created_at",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader], query: listQuerySchema },
  responses: {
    200: jsonResponse("Page of actions.", z.object({ actions: z.array(actionSummarySchema), next_cursor: z.string().nullable() })),
    400: errorResponse("Invalid query."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/actions/{id}",
  tags: ["Actions"],
  summary: "Get full action detail",
  description: "Dual auth: a session+org user can view any action in their organization; an agent (bearer) can check an action's status.",
  security: [{ [sessionCookie.name]: [] }, { [bearerAuth.name]: [] }],
  request: { params: idParam() },
  responses: {
    200: jsonResponse("Full detail including delegation chain refs, approval, and linked receipts.", actionDetailSchema),
    404: errorResponse("Action not found."),
  },
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------
// Mirrors the GET /v1/approvals handler's row mapping.
const approvalListEntrySchema = z.object({
  approval_id: z.string(),
  action_id: z.string(),
  principal_id: z.string(),
  grant_chain_ids: z.array(z.string()),
  amount_minor: z.number(),
  currency: z.string(),
  triggering_rule: z.string().nullable(),
  status: z.enum(APPROVAL_STATUSES),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  reviewer_user_id: z.string().nullable(),
  decided_at: z.string().nullable(),
  action: z.object({ resource_id: z.string(), action: z.string(), actor_agent_id: z.string(), root_grant_id: z.string() }).nullable(),
});

const approvalDecisionResultSchema = z.object({
  status: z.literal("ok"),
  action_id: z.string(),
  execution_state: z.enum(EXECUTION_STATES),
  decision: z.enum(DECISIONS),
});

registry.registerPath({
  method: "get",
  path: "/v1/approvals",
  tags: ["Approvals"],
  summary: "List approvals (Approver+)",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader], query: z.object({ status: z.enum(APPROVAL_STATUSES).optional() }) },
  responses: { 200: jsonResponse("Approvals.", z.object({ approvals: z.array(approvalListEntrySchema) })) },
});

registry.registerPath({
  method: "post",
  path: "/v1/approvals/{id}/approve",
  tags: ["Approvals"],
  summary: "Approve (Approver+)",
  description:
    "Atomic compare-and-set; a concurrent second decision gets 409 ALREADY_DECIDED. Rejects self-approval with 403. A since-superseded policy makes the approval APPROVAL_EXPIRED.",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader], body: { content: { "application/json": { schema: decideApprovalRequestSchema } } } },
  responses: {
    200: jsonResponse("Decided.", approvalDecisionResultSchema),
    403: errorResponse("Self-approval is not allowed."),
    409: errorResponse("ALREADY_DECIDED."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/approvals/{id}/reject",
  tags: ["Approvals"],
  summary: "Reject (Approver+)",
  description: "Same binding/compare-and-set semantics as approve.",
  security: [{ [sessionCookie.name]: [] }],
  request: { params: idParam(), headers: [organizationIdHeader], body: { content: { "application/json": { schema: decideApprovalRequestSchema } } } },
  responses: {
    200: jsonResponse("Decided.", approvalDecisionResultSchema),
    409: errorResponse("ALREADY_DECIDED."),
  },
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------
// Mirrors ReconciliationItem (apps/api/src/gateway/reconciliation.ts).
const reconciliationItemSchema = z.object({
  action_id: z.string(),
  resource_id: z.string(),
  action: z.string(),
  amount_minor: z.number(),
  currency: z.string(),
  actor_agent_id: z.string(),
  attempt_count: z.number(),
  last_error: z.string().nullable(),
  job_status: z.string(),
  needs_manual_review: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

registry.registerPath({
  method: "get",
  path: "/v1/reconciliation",
  tags: ["Reconciliation"],
  summary: "List actions stuck in the unknown execution state (Approver+)",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: { 200: jsonResponse("Items needing manual reconciliation, oldest first.", z.object({ items: z.array(reconciliationItemSchema) })) },
});

registry.registerPath({
  method: "post",
  path: "/v1/reconciliation/{actionId}/resolve",
  tags: ["Reconciliation"],
  summary: "Manually resolve an action stuck in unknown (Approver+)",
  security: [{ [sessionCookie.name]: [] }],
  request: {
    params: idParam("actionId"),
    headers: [organizationIdHeader],
    body: { content: { "application/json": { schema: resolveReconciliationRequestSchema } } },
  },
  responses: {
    200: jsonResponse("Resolved.", z.object({ status: z.literal("ok"), action_id: z.string(), execution_state: z.enum(["succeeded", "failed"]) })),
    404: errorResponse("Action not found."),
    409: errorResponse("Action is not in the unknown state; nothing to reconcile."),
  },
});

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------
registry.registerPath({
  method: "get",
  path: "/v1/receipts/{id}",
  tags: ["Receipts"],
  summary: "Get a receipt",
  security: [{ [sessionCookie.name]: [] }, { [bearerAuth.name]: [] }],
  request: { params: idParam() },
  responses: {
    200: jsonResponse(
      "Full record.",
      z.object({ receipt_id: z.string(), receipt_type: z.enum(RECEIPT_TYPES), jws: z.string(), payload: z.record(z.string(), z.unknown()), created_at: z.string() })
    ),
    404: errorResponse("Receipt not found."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/receipts/verify",
  tags: ["Receipts"],
  summary: "Verify a receipt's JWS (unauthenticated)",
  description: "Deliberately unauthenticated -- verification must work for anyone holding a receipt.",
  request: { body: { content: { "application/json": { schema: verifyReceiptRequestSchema } } } },
  responses: {
    200: jsonResponse("Never collapses validity into one boolean.", receiptVerificationResultSchema),
    400: errorResponse("Invalid verify request."),
  },
});

// ---------------------------------------------------------------------------
// Metrics and events
// ---------------------------------------------------------------------------
// Mirrors registerMetricsRoutes()'s returned object (apps/api/src/routes/metrics.ts).
registry.registerPath({
  method: "get",
  path: "/v1/metrics/summary",
  tags: ["Metrics"],
  summary: "Real aggregates over stored actions/usage_events",
  description: "Never a hardcoded number; an organization with no activity reports all zeros.",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: {
    200: jsonResponse(
      "Aggregates over all recorded actions for this organization.",
      z.object({
        total_actions: z.number(),
        allowed: z.number(),
        denied: z.number(),
        awaiting_approval: z.number(),
        succeeded: z.number(),
        failed: z.number(),
        unknown: z.number(),
        execution_success_rate: z.number().nullable(),
        authorization_latency_ms: z.object({ p50: z.number().nullable(), p95: z.number().nullable(), p99: z.number().nullable() }),
        note: z.string(),
      })
    ),
  },
});

// GET /v1/events is a Server-Sent Events stream (apps/api/src/routes/events.ts),
// not a single JSON response -- OpenAPI 3.0 has no first-class way to
// describe an indefinite SSE stream's per-event payloads, so this documents
// the endpoint and its per-event `data:` shape in prose rather than a
// request/response schema pair. See the report for this generator for the
// same caveat.
registry.registerPath({
  method: "get",
  path: "/v1/events",
  tags: ["Metrics"],
  summary: "Tenant-scoped audit event stream (Server-Sent Events)",
  description:
    "text/event-stream, not JSON. Implemented as short-interval polling of this organization's audit_events table. Each SSE `event:` is the audit event name and `data:` is JSON: {id, actor_type, actor_id, metadata, created_at}. Not representable as a normal OpenAPI request/response pair; documented here for discoverability only.",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: {
    200: { description: "text/event-stream of audit events for this organization. See the operation description for the per-event shape.", content: { "text/event-stream": { schema: { type: "string" } } } },
  },
});

// ---------------------------------------------------------------------------
// Demo (local/demo mode only)
// ---------------------------------------------------------------------------
const scenarioStepSchema = z.object({
  step: z.string(),
  description: z.string(),
  ok: z.boolean(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

registry.registerPath({
  method: "post",
  path: "/v1/demo/runs",
  tags: ["Demo"],
  summary: "Run a demo scenario (Operator+, local/demo mode only)",
  description: `scenario_key is one of: ${SCENARIO_KEYS.join(", ")}. Only works inside the seeded Northstar Commerce organization.`,
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader], body: { content: { "application/json": { schema: runRequestSchema } } } },
  responses: {
    201: jsonResponse("Run recorded.", z.object({ run_id: z.string(), status: z.enum(["succeeded", "failed"]), steps: z.array(scenarioStepSchema) })),
    403: errorResponse("Demo endpoints disabled in production mode."),
    422: errorResponse("Wrong organization for the demo lab."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/demo/runs",
  tags: ["Demo"],
  summary: "History of past demo runs (local/demo mode only)",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: {
    200: jsonResponse(
      "Past runs.",
      z.object({
        runs: z.array(
          z.object({ run_id: z.string(), scenario_key: z.string(), status: z.string(), steps: z.array(scenarioStepSchema), created_at: z.string(), completed_at: z.string().nullable() })
        ),
      })
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/demo/reset",
  tags: ["Demo"],
  summary: "Clear this org's activity data (Operator+, local/demo mode only)",
  description: "Clears actions/receipts/approvals/budgets/jobs; never identity/grants/policy. The authoritative reset path is `pnpm demo:reset`.",
  security: [{ [sessionCookie.name]: [] }],
  request: { headers: [organizationIdHeader] },
  responses: {
    200: jsonResponse("Reset.", statusOkSchema),
    403: errorResponse("Demo endpoints disabled in production mode."),
  },
});

// ---------------------------------------------------------------------------
// Generate and write
// ---------------------------------------------------------------------------
const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: "3.0.3",
  info: {
    title: "TrustRail API",
    version: "0.1.0",
    description:
      "Generated from the zod schemas that actually validate each route (packages/contracts and apps/api/src/routes/*.ts). See docs/API.md for prose (auth model, error envelope, rate limits). Regenerate with `pnpm generate:openapi`.",
  },
  servers: [{ url: "/", description: "Base path is /v1 for all routes except health checks and /.well-known/jwks.json." }],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Organizations" },
    { name: "Agents" },
    { name: "Grants" },
    { name: "Policies" },
    { name: "Actions" },
    { name: "Approvals" },
    { name: "Reconciliation" },
    { name: "Receipts" },
    { name: "Metrics" },
    { name: "Demo" },
  ],
});

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../docs/openapi.json");
writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n", "utf-8");
console.log(`Wrote ${outPath}`);
