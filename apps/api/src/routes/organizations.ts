import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { withTenant } from "../db/client.js";
import { organizations, memberships, policyBundles, policyVersions } from "../db/schema.js";
import { newId } from "../db/ids.js";
import { sessionRoute } from "../http/handlers.js";
import { DEFAULT_POLICY_BUNDLE } from "@trustrail/contracts";
import { canonicalHash } from "@trustrail/contracts";

const createOrgSchema = z.object({ name: z.string().min(1).max(200) }).strict();

/**
 * Creating an organization makes the caller its Owner and seeds a
 * published default policy for refund.create/sandbox, so a freshly
 * onboarded organization has *some* deterministic policy in force rather
 * than silently failing closed on the very first action attempt --
 * matching the onboarding checklist in docs/PRODUCT_SPEC.md section 13.
 */
export function registerOrganizationRoutes(app: FastifyInstance, db: Db) {
  app.post(
    "/v1/organizations",
    sessionRoute(db, async (ctx, req, reply) => {
      const body = createOrgSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ code: "BAD_REQUEST", message: "invalid organization payload", request_id: req.id });

      const orgId = newId("organization");
      const membershipId = newId("membership");
      const bundleId = newId("policyBundle");
      const versionId = newId("policyVersion");
      const bundleHash = canonicalHash(DEFAULT_POLICY_BUNDLE);

      await db.insert(organizations).values({ id: orgId, name: body.data.name, appMode: "local" });
      await db.insert(memberships).values({ id: membershipId, organizationId: orgId, userId: ctx.userId, role: "owner" });
      await withTenant(db, orgId, async (tx) => {
        await tx.insert(policyBundles).values({ id: bundleId, organizationId: orgId, environment: "sandbox", action: "refund.create", activeVersionId: versionId, revision: 1 });
        await tx.insert(policyVersions).values({
          id: versionId,
          policyBundleId: bundleId,
          organizationId: orgId,
          versionNumber: 1,
          bundle: DEFAULT_POLICY_BUNDLE,
          bundleHash,
          status: "published",
          createdByUserId: ctx.userId,
          changeReason: "initial default policy on organization creation",
          publishedAt: new Date(),
        });
      });

      return reply.code(201).send({ organization_id: orgId, name: body.data.name, role: "owner" });
    })
  );
}
