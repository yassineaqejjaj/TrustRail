import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { receipts } from "@trustrail/db";
import { handleRouteError } from "../http/handlers.js";
import { authenticateAgent, authenticateUserWithOrg } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { verifyReceiptRequestSchema } from "@trustrail/contracts";
import { verifyReceiptJws } from "@trustrail/receipt-verifier";
import { getTrustedKeys, getPublicJwks } from "../gateway/keys.js";

export function registerReceiptRoutes(app: FastifyInstance, db: Db) {
  // Dual auth, same reasoning as GET /v1/actions/:id: a dashboard user
  // (session + org header) or an agent (bearer credential, e.g. the SDK
  // client used to submit the underlying action) can fetch a receipt
  // scoped to their own organization.
  app.get("/v1/receipts/:id", async (req, reply) => {
    try {
      const organizationId = req.headers.authorization ? (await authenticateAgent(db, req)).organizationId : (await authenticateUserWithOrg(db, req)).organizationId;
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid receipt id"));
      const rows = await withTenant(db, organizationId, (tx) => tx.select().from(receipts).where(and(eq(receipts.id, params.data.id), eq(receipts.organizationId, organizationId))).limit(1));
      const receipt = rows[0];
      if (!receipt) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "receipt not found"));
      return { receipt_id: receipt.id, receipt_type: receipt.receiptType, jws: receipt.jws, payload: receipt.payload, created_at: receipt.createdAt };
    } catch (err) {
      return handleRouteError(err, req, reply);
    }
  });

  /**
   * Deliberately unauthenticated: independent verification must work for
   * anyone holding a receipt, without a TrustRail login (spec section 9:
   * "The standalone verifier and SDK verifier accept pinned issuer keys").
   * It only checks the JWS against TrustRail's own public keys -- no
   * tenant data is looked up by ID here.
   */
  app.post("/v1/receipts/verify", async (req, reply) => {
    const body = verifyReceiptRequestSchema.safeParse(req.body);
    if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid verify request"));
    const trustedKeys = await getTrustedKeys(db);
    const result = await verifyReceiptJws(body.data.jws, trustedKeys);
    return reply.send(result);
  });

  app.get("/.well-known/jwks.json", async () => {
    const keys = await getPublicJwks(db);
    return { keys };
  });
}
