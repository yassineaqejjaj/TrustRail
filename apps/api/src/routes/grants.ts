import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { grants, memberships } from "@trustrail/db";
import { newId } from "@trustrail/db";
import { authenticateUserWithOrg, authenticateAgent, requireRole, type UserAuthContext, type AgentAuthContext } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { handleRouteError } from "../http/handlers.js";
import { createGrantRequestSchema, GRANT_MAX_CHAIN_DEPTH } from "@trustrail/contracts";
import { validateChain, type GrantChainLink } from "@trustrail/policy-engine";
import { resolveGrantChain } from "../gateway/grantChain.js";
import { writeAuditEvent } from "../gateway/audit.js";

type Issuer = { kind: "user"; ctx: UserAuthContext } | { kind: "agent"; ctx: AgentAuthContext };

async function authenticateIssuer(db: Db, req: FastifyRequest): Promise<Issuer> {
  if (req.headers.authorization) {
    return { kind: "agent", ctx: await authenticateAgent(db, req) };
  }
  return { kind: "user", ctx: await authenticateUserWithOrg(db, req) };
}

export function registerGrantRoutes(app: FastifyInstance, db: Db) {
  app.get("/v1/grants", async (req, reply) => {
    try {
      const ctx = await authenticateUserWithOrg(db, req);
      const rows = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(grants).where(eq(grants.organizationId, ctx.organizationId)));
      return { grants: rows.map(serializeGrant) };
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  });

  app.post("/v1/grants", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const issuer = await authenticateIssuer(db, req);
      const body = createGrantRequestSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid grant payload", { issues: body.error.issues }));

      const organizationId = issuer.ctx.organizationId;
      const isRootGrant = body.data.parent_grant_id === null;

      if (isRootGrant) {
        if (issuer.kind !== "user") {
          return sendApiError(reply, req, new ApiError(403, "FORBIDDEN", "only an authenticated user (Owner/Admin) may issue a root grant"));
        }
        requireRole(issuer.ctx, "admin");
        const principalIsMember = await withTenant(db, organizationId, (tx) =>
          tx.select().from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, body.data.principal_id))).limit(1)
        );
        if (principalIsMember.length === 0) {
          return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "principal_id must be a member of this organization"));
        }

        const grantId = newId("grant");
        const chainLink = toProspectiveLink(grantId, organizationId, body.data, grantId);
        const validation = validateChain([chainLink], new Date());
        if (!validation.ok) {
          return sendApiError(reply, req, new ApiError(422, validation.reasonCodes[0] ?? "SCOPE_MISMATCH", "root grant failed validation"));
        }

        await withTenant(db, organizationId, async (tx) => {
          await tx.insert(grants).values(grantRow(grantId, organizationId, "user", issuer.ctx.userId, grantId, null, body.data));
          await writeAuditEvent(tx, organizationId, "user", issuer.ctx.userId, "grant.issued", { grantId, root: true });
        });
        return reply.code(201).send({ grant_id: grantId });
      }

      // Child grant: must be issued by the authenticated agent that is the
      // parent grant's subject -- "the authenticated parent subject must
      // issue the child; the server derives issuer identity" (spec section 5).
      if (issuer.kind !== "agent") {
        return sendApiError(reply, req, new ApiError(403, "FORBIDDEN", "a child grant must be issued by the parent grant's authenticated agent"));
      }
      const parentChain = await withTenant(db, organizationId, (tx) => resolveGrantChain(tx, organizationId, body.data.parent_grant_id!));
      if (!parentChain) {
        return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "parent grant not found"));
      }
      const parent = parentChain[parentChain.length - 1]!;
      if (parent.subjectAgentId !== issuer.ctx.agentId) {
        return sendApiError(reply, req, new ApiError(403, "FORBIDDEN", "only the parent grant's subject agent may delegate from it"));
      }
      if (parentChain.length >= GRANT_MAX_CHAIN_DEPTH + 1) {
        return sendApiError(reply, req, new ApiError(422, "DELEGATION_DEPTH_EXCEEDED", "maximum delegation depth reached"));
      }

      const grantId = newId("grant");
      const forcedPrincipalId = parent.principalId; // accountability does not change through delegation
      const chainLink = toProspectiveLink(grantId, organizationId, { ...body.data, principal_id: forcedPrincipalId }, parentChain[0]!.id);
      chainLink.parentGrantId = parent.id;
      const fullChain: GrantChainLink[] = [...parentChain, chainLink];
      const validation = validateChain(fullChain, new Date());
      if (!validation.ok) {
        return sendApiError(reply, req, new ApiError(422, validation.reasonCodes[0] ?? "DELEGATION_WIDENING", "child grant is not a subset of its parent"));
      }

      await withTenant(db, organizationId, async (tx) => {
        await tx.insert(grants).values(grantRow(grantId, organizationId, "agent", issuer.ctx.agentId, parentChain[0]!.id, parent.id, { ...body.data, principal_id: forcedPrincipalId }));
        await writeAuditEvent(tx, organizationId, "agent", issuer.ctx.agentId, "grant.issued", { grantId, root: false, parentGrantId: parent.id });
      });
      return reply.code(201).send({ grant_id: grantId });
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  });

  app.post("/v1/grants/:id/revoke", async (req, reply) => {
    try {
      const ctx = await authenticateUserWithOrg(db, req);
      requireRole(ctx, "admin");
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = z.object({ reason: z.string().min(1).max(500) }).safeParse(req.body);
      if (!params.success || !body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid request"));

      const result = await withTenant(db, ctx.organizationId, async (tx) => {
        const rows = await tx.select().from(grants).where(and(eq(grants.id, params.data.id), eq(grants.organizationId, ctx.organizationId))).limit(1);
        const grant = rows[0];
        if (!grant) return { notFound: true } as const;
        await tx.update(grants).set({ status: "revoked", revokedAt: new Date(), revocationReason: body.data.reason }).where(eq(grants.id, grant.id));
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "grant.revoked", { grantId: grant.id, reason: body.data.reason });
        return { ok: true } as const;
      });
      if ("notFound" in result) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "grant not found"));
      return { status: "ok" };
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  });
}

function toProspectiveLink(id: string, organizationId: string, data: z.infer<typeof createGrantRequestSchema>, rootGrantId: string): GrantChainLink {
  return {
    id,
    organizationId,
    environment: data.environment,
    parentGrantId: data.parent_grant_id,
    rootGrantId,
    principalId: data.principal_id,
    subjectAgentId: data.subject_agent_id,
    allowedActions: data.allowed_actions,
    allowedResourceIds: data.allowed_resource_ids,
    unrestrictedResources: data.unrestricted_resources,
    allowedConnectorIds: data.allowed_connector_ids,
    currency: data.currency,
    maxAmountMinor: data.max_amount_minor,
    rootBudgetLimitMinor: data.root_budget_limit_minor,
    childBudgetLimitMinor: data.child_budget_limit_minor,
    validFrom: data.valid_from,
    expiresAt: data.expires_at,
    delegationAllowed: data.delegation_allowed,
    maxRemainingDepth: data.max_remaining_depth,
    status: "active",
  };
}

function grantRow(id: string, organizationId: string, issuerType: "user" | "agent", issuerId: string, rootGrantId: string, parentGrantId: string | null, data: z.infer<typeof createGrantRequestSchema>) {
  return {
    id,
    organizationId,
    environment: data.environment,
    principalId: data.principal_id,
    issuerType,
    issuerId,
    subjectAgentId: data.subject_agent_id,
    parentGrantId,
    rootGrantId,
    allowedActions: data.allowed_actions,
    allowedResourceIds: data.allowed_resource_ids,
    unrestrictedResources: data.unrestricted_resources,
    allowedConnectorIds: data.allowed_connector_ids,
    currency: data.currency,
    maxAmountMinor: data.max_amount_minor,
    rootBudgetLimitMinor: data.root_budget_limit_minor,
    childBudgetLimitMinor: data.child_budget_limit_minor,
    validFrom: data.valid_from ? new Date(data.valid_from) : null,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    delegationAllowed: data.delegation_allowed,
    maxRemainingDepth: data.max_remaining_depth,
    status: "active" as const,
  };
}

function serializeGrant(g: typeof grants.$inferSelect) {
  return {
    grant_id: g.id,
    environment: g.environment,
    principal_id: g.principalId,
    issuer_type: g.issuerType,
    issuer_id: g.issuerId,
    subject_agent_id: g.subjectAgentId,
    parent_grant_id: g.parentGrantId,
    root_grant_id: g.rootGrantId,
    allowed_actions: g.allowedActions,
    allowed_resource_ids: g.allowedResourceIds,
    unrestricted_resources: g.unrestrictedResources,
    allowed_connector_ids: g.allowedConnectorIds,
    currency: g.currency,
    max_amount_minor: g.maxAmountMinor,
    root_budget_limit_minor: g.rootBudgetLimitMinor,
    child_budget_limit_minor: g.childBudgetLimitMinor,
    valid_from: g.validFrom,
    expires_at: g.expiresAt,
    delegation_allowed: g.delegationAllowed,
    max_remaining_depth: g.maxRemainingDepth,
    status: g.status,
    created_at: g.createdAt,
    revoked_at: g.revokedAt,
  };
}
