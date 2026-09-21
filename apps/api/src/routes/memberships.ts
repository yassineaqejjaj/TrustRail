import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { memberships, users } from "@trustrail/db";
import { newId } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";
import { requireRole } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { ROLES } from "@trustrail/contracts";
import { writeAuditEvent } from "../gateway/audit.js";

export const addMembershipSchema = z.object({ email: z.string().email(), role: z.enum(ROLES) }).strict();

/**
 * Not listed as its own row in docs/PRODUCT_SPEC.md section 11's endpoint
 * table, but required by section 13's Settings page ("members/roles") and
 * by the approval workflow needing more than one org member. The target
 * user must already have an account (self-registered) -- there is no
 * email-invite flow in V1, so this only attaches a role to an existing
 * user, it never creates one.
 */
export function registerMembershipRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/v1/memberships",
    userRoute(db, async (ctx) => {
      const rows = await withTenant(db, ctx.organizationId, (tx) =>
        tx
          .select({ id: memberships.id, userId: memberships.userId, role: memberships.role, email: users.email, createdAt: memberships.createdAt })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(eq(memberships.organizationId, ctx.organizationId))
      );
      return { memberships: rows.map((r) => ({ membership_id: r.id, user_id: r.userId, email: r.email, role: r.role, created_at: r.createdAt })) };
    })
  );

  app.post(
    "/v1/memberships",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "admin");
      const body = addMembershipSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid membership payload"));
      if (body.data.role === "owner" && ctx.role !== "owner") {
        return sendApiError(reply, req, new ApiError(403, "FORBIDDEN", "only an Owner may grant the Owner role"));
      }

      const targetUser = await db.select().from(users).where(eq(users.email, body.data.email.toLowerCase())).limit(1);
      if (targetUser.length === 0) {
        return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "no account exists for this email; the user must register first"));
      }

      const result = await withTenant(db, ctx.organizationId, async (tx) => {
        const existing = await tx.select().from(memberships).where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, targetUser[0]!.id))).limit(1);
        if (existing.length > 0) {
          await tx.update(memberships).set({ role: body.data.role }).where(eq(memberships.id, existing[0]!.id));
          return { membershipId: existing[0]!.id, updated: true };
        }
        const membershipId = newId("membership");
        await tx.insert(memberships).values({ id: membershipId, organizationId: ctx.organizationId, userId: targetUser[0]!.id, role: body.data.role });
        return { membershipId, updated: false };
      });

      await withTenant(db, ctx.organizationId, (tx) => writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "membership.set", { targetUserId: targetUser[0]!.id, role: body.data.role }));
      return reply.code(result.updated ? 200 : 201).send({ membership_id: result.membershipId, role: body.data.role });
    })
  );
}
