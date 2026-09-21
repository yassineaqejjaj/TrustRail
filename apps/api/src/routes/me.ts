import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { memberships, organizations } from "../db/schema.js";
import { sessionRoute } from "../http/handlers.js";

export function registerMeRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/v1/me",
    sessionRoute(db, async (ctx) => {
      const rows = await db
        .select({ organizationId: memberships.organizationId, role: memberships.role, organizationName: organizations.name })
        .from(memberships)
        .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
        .where(eq(memberships.userId, ctx.userId));

      return {
        user_id: ctx.userId,
        email: ctx.email,
        memberships: rows.map((r) => ({ organization_id: r.organizationId, organization_name: r.organizationName, role: r.role })),
      };
    })
  );
}
