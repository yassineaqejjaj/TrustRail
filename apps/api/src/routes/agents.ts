import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { agents, agentCredentials } from "@trustrail/db";
import { newId } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";
import { requireRole, type UserAuthContext } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { createAgentRequestSchema, updateAgentRequestSchema, type Environment } from "@trustrail/contracts";
import { generateApiKey } from "../auth/apiKeys.js";
import { writeAuditEvent } from "../gateway/audit.js";

function canManageAgent(ctx: UserAuthContext, ownerUserId: string): boolean {
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  return ctx.role === "operator" && ctx.userId === ownerUserId;
}

export function registerAgentRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/v1/agents",
    userRoute(db, async (ctx) => {
      const rows = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(agents).where(eq(agents.organizationId, ctx.organizationId)));
      return { agents: rows.map(serializeAgent) };
    })
  );

  app.post(
    "/v1/agents",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "operator");
      const body = createAgentRequestSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid agent payload"));

      const agentId = newId("agent");
      await withTenant(db, ctx.organizationId, async (tx) => {
        await tx.insert(agents).values({
          id: agentId,
          organizationId: ctx.organizationId,
          name: body.data.name,
          description: body.data.description,
          ownerUserId: ctx.userId,
          environment: body.data.environment,
          status: "active",
        });
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "agent.created", { agentId, name: body.data.name });
      });
      return reply.code(201).send({ agent_id: agentId });
    })
  );

  app.get(
    "/v1/agents/:id",
    userRoute(db, async (ctx, req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid agent id"));
      const result = await withTenant(db, ctx.organizationId, async (tx) => {
        const agentRows = await tx.select().from(agents).where(and(eq(agents.id, params.data.id), eq(agents.organizationId, ctx.organizationId))).limit(1);
        const agent = agentRows[0];
        if (!agent) return null;
        const creds = await tx.select().from(agentCredentials).where(eq(agentCredentials.agentId, agent.id));
        return { agent, creds };
      });
      if (!result) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "agent not found"));
      return {
        ...serializeAgent(result.agent),
        credentials: result.creds.map((c) => ({
          credential_id: c.id,
          prefix: c.prefix,
          status: c.status,
          created_at: c.createdAt,
          expires_at: c.expiresAt,
          revoked_at: c.revokedAt,
        })),
      };
    })
  );

  app.patch(
    "/v1/agents/:id",
    userRoute(db, async (ctx, req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = updateAgentRequestSchema.safeParse(req.body);
      if (!params.success || !body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid request"));

      const updated = await withTenant(db, ctx.organizationId, async (tx) => {
        const rows = await tx.select().from(agents).where(and(eq(agents.id, params.data.id), eq(agents.organizationId, ctx.organizationId))).limit(1);
        const agent = rows[0];
        if (!agent) return { notFound: true } as const;
        if (!canManageAgent(ctx, agent.ownerUserId)) return { forbidden: true } as const;
        await tx
          .update(agents)
          .set({ name: body.data.name ?? agent.name, description: body.data.description ?? agent.description, status: body.data.status ?? agent.status })
          .where(eq(agents.id, agent.id));
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "agent.updated", { agentId: agent.id });
        return { ok: true } as const;
      });

      if ("notFound" in updated) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "agent not found"));
      if ("forbidden" in updated) return sendApiError(reply, req, new ApiError(403, "FORBIDDEN", "not permitted to manage this agent"));
      return { status: "ok" };
    })
  );

  app.post(
    "/v1/agents/:id/credentials",
    userRoute(db, async (ctx, req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid agent id"));

      const result = await withTenant(db, ctx.organizationId, async (tx) => {
        const rows = await tx.select().from(agents).where(and(eq(agents.id, params.data.id), eq(agents.organizationId, ctx.organizationId))).limit(1);
        const agent = rows[0];
        if (!agent) return { notFound: true } as const;
        if (!canManageAgent(ctx, agent.ownerUserId)) return { forbidden: true } as const;

        const generated = generateApiKey(agent.environment as Environment);
        const credentialId = newId("credential");
        await tx.insert(agentCredentials).values({
          id: credentialId,
          organizationId: ctx.organizationId,
          agentId: agent.id,
          environment: agent.environment,
          prefix: generated.prefix,
          secretDigest: generated.digest,
          status: "active",
        });
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "credential.created", { agentId: agent.id, credentialId });
        return { ok: true, credentialId, secret: generated.secret, prefix: generated.prefix } as const;
      });

      if ("notFound" in result) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "agent not found"));
      if ("forbidden" in result) return sendApiError(reply, req, new ApiError(403, "FORBIDDEN", "not permitted to manage this agent"));
      return reply.code(201).send({
        credential_id: result.credentialId,
        secret: result.secret,
        prefix: result.prefix,
        warning: "This secret is shown once and cannot be retrieved again.",
      });
    })
  );

  app.post(
    "/v1/credentials/:id/revoke",
    userRoute(db, async (ctx, req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid credential id"));

      const result = await withTenant(db, ctx.organizationId, async (tx) => {
        const credRows = await tx.select().from(agentCredentials).where(and(eq(agentCredentials.id, params.data.id), eq(agentCredentials.organizationId, ctx.organizationId))).limit(1);
        const cred = credRows[0];
        if (!cred) return { notFound: true } as const;
        const agentRows = await tx.select().from(agents).where(eq(agents.id, cred.agentId)).limit(1);
        const agent = agentRows[0];
        if (!agent || !canManageAgent(ctx, agent.ownerUserId)) return { forbidden: true } as const;

        await tx.update(agentCredentials).set({ status: "revoked", revokedAt: new Date(), revocationReason: "revoked by operator" }).where(eq(agentCredentials.id, cred.id));
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "credential.revoked", { credentialId: cred.id, agentId: agent.id });
        return { ok: true } as const;
      });

      if ("notFound" in result) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "credential not found"));
      if ("forbidden" in result) return sendApiError(reply, req, new ApiError(403, "FORBIDDEN", "not permitted to manage this credential"));
      return { status: "ok" };
    })
  );
}

function serializeAgent(agent: typeof agents.$inferSelect) {
  return {
    agent_id: agent.id,
    name: agent.name,
    description: agent.description,
    owner_user_id: agent.ownerUserId,
    environment: agent.environment,
    status: agent.status,
    last_activity_at: agent.lastActivityAt,
    created_at: agent.createdAt,
  };
}
