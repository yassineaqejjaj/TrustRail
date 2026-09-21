import type { FastifyInstance } from "fastify";
import type { Db } from "@trustrail/db";

export function registerHealthRoutes(app: FastifyInstance, db: Db) {
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await db.execute("select 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ code: "UNAVAILABLE", message: "database is not reachable" });
    }
  });
}
