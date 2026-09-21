import type { FastifyInstance } from "fastify";
import { and, desc, gt } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { withTenant } from "../db/client.js";
import { auditEvents } from "../db/schema.js";
import { authenticateUserWithOrg } from "../auth/context.js";
import { handleRouteError } from "../http/handlers.js";

/**
 * Tenant-filtered SSE stream. Implemented as short-interval polling of
 * this organization's own audit_events table rather than a full in-memory
 * pub/sub bus -- functionally an SSE stream (the client gets a live feed
 * with no page reload) but simpler and, since every read is tenant-scoped
 * through the same RLS path as every other query, unable to leak another
 * tenant's events even if the polling logic had a bug. Documented as a
 * scaling simplification in docs/BUILD_STATUS.md.
 */
export function registerEventRoutes(app: FastifyInstance, db: Db) {
  app.get("/v1/events", async (req, reply) => {
    let ctx;
    try {
      ctx = await authenticateUserWithOrg(db, req);
    } catch (err) {
      return handleRouteError(err, req, reply);
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let lastSeen = new Date(0);
    let closed = false;
    req.raw.on("close", () => {
      closed = true;
    });

    while (!closed) {
      const rows = await withTenant(db, ctx.organizationId, (tx) =>
        tx.select().from(auditEvents).where(and(eq(auditEvents.organizationId, ctx.organizationId), gt(auditEvents.createdAt, lastSeen))).orderBy(desc(auditEvents.createdAt)).limit(50)
      );
      const ordered = [...rows].reverse();
      for (const row of ordered) {
        reply.raw.write(`event: ${row.event}\ndata: ${JSON.stringify({ id: row.id, actor_type: row.actorType, actor_id: row.actorId, metadata: row.metadata, created_at: row.createdAt })}\n\n`);
        lastSeen = row.createdAt;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  });
}
