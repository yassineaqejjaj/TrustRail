import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { policyBundles, policyVersions } from "@trustrail/db";
import { newId } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";
import { requireRole } from "../auth/context.js";
import { ApiError, sendApiError } from "../http/errors.js";
import { policyBundleSchema, canonicalHash, ENVIRONMENTS } from "@trustrail/contracts";
import { writeAuditEvent } from "../gateway/audit.js";

export const createPolicyDraftSchema = z.object({ environment: z.enum(ENVIRONMENTS), bundle: policyBundleSchema }).strict();
export const addVersionSchema = z.object({ bundle: policyBundleSchema, change_reason: z.string().max(500).default("") }).strict();
export const publishSchema = z.object({ version_id: z.string(), expected_revision: z.number().int().min(0), change_reason: z.string().max(500).default("") }).strict();

export function registerPolicyRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/v1/policies",
    userRoute(db, async (ctx) => {
      const bundles = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(policyBundles).where(eq(policyBundles.organizationId, ctx.organizationId)));
      const result = [];
      for (const bundle of bundles) {
        const versions = await withTenant(db, ctx.organizationId, (tx) => tx.select().from(policyVersions).where(eq(policyVersions.policyBundleId, bundle.id)));
        result.push({
          policy_bundle_id: bundle.id,
          environment: bundle.environment,
          action: bundle.action,
          active_version_id: bundle.activeVersionId,
          revision: bundle.revision,
          versions: versions.map(serializeVersion),
        });
      }
      return { policies: result };
    })
  );

  app.post(
    "/v1/policies",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "admin");
      const body = createPolicyDraftSchema.safeParse(req.body);
      if (!body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid policy draft payload", { issues: body.error.issues }));

      const bundleId = newId("policyBundle");
      const versionId = newId("policyVersion");
      const bundleHash = canonicalHash(body.data.bundle);

      const existing = await withTenant(db, ctx.organizationId, (tx) =>
        tx.select().from(policyBundles).where(and(eq(policyBundles.organizationId, ctx.organizationId), eq(policyBundles.environment, body.data.environment), eq(policyBundles.action, body.data.bundle.action))).limit(1)
      );
      if (existing.length > 0) {
        return sendApiError(reply, req, new ApiError(409, "CONFLICT", "a policy bundle already exists for this environment/action; add a version instead"));
      }

      await withTenant(db, ctx.organizationId, async (tx) => {
        await tx.insert(policyBundles).values({ id: bundleId, organizationId: ctx.organizationId, environment: body.data.environment, action: body.data.bundle.action, activeVersionId: null, revision: 0 });
        await tx.insert(policyVersions).values({
          id: versionId,
          policyBundleId: bundleId,
          organizationId: ctx.organizationId,
          versionNumber: 1,
          bundle: body.data.bundle,
          bundleHash,
          status: "draft",
          createdByUserId: ctx.userId,
          changeReason: "initial draft",
        });
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "policy.draft_created", { bundleId, versionId });
      });
      return reply.code(201).send({ policy_bundle_id: bundleId, version_id: versionId });
    })
  );

  app.post(
    "/v1/policies/:id/versions",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "admin");
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = addVersionSchema.safeParse(req.body);
      if (!params.success || !body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid request", { issues: body.success ? undefined : body.error.issues }));

      const result = await withTenant(db, ctx.organizationId, async (tx) => {
        const bundleRows = await tx.select().from(policyBundles).where(and(eq(policyBundles.id, params.data.id), eq(policyBundles.organizationId, ctx.organizationId))).limit(1);
        const bundle = bundleRows[0];
        if (!bundle) return { notFound: true } as const;
        if (body.data.bundle.action !== bundle.action) return { actionMismatch: true } as const;

        const existingVersions = await tx.select().from(policyVersions).where(eq(policyVersions.policyBundleId, bundle.id));
        const versionId = newId("policyVersion");
        await tx.insert(policyVersions).values({
          id: versionId,
          policyBundleId: bundle.id,
          organizationId: ctx.organizationId,
          versionNumber: existingVersions.length + 1,
          bundle: body.data.bundle,
          bundleHash: canonicalHash(body.data.bundle),
          status: "draft",
          createdByUserId: ctx.userId,
          changeReason: body.data.change_reason,
        });
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "policy.version_drafted", { bundleId: bundle.id, versionId });
        return { ok: true, versionId } as const;
      });

      if ("notFound" in result) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "policy bundle not found"));
      if ("actionMismatch" in result) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "bundle action must match the policy bundle's action"));
      return reply.code(201).send({ version_id: result.versionId });
    })
  );

  app.post(
    "/v1/policies/:id/publish",
    userRoute(db, async (ctx, req, reply) => {
      requireRole(ctx, "admin");
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = publishSchema.safeParse(req.body);
      if (!params.success || !body.success) return sendApiError(reply, req, new ApiError(400, "BAD_REQUEST", "invalid publish request"));

      const result = await withTenant(db, ctx.organizationId, async (tx) => {
        const bundleRows = await tx.select().from(policyBundles).where(and(eq(policyBundles.id, params.data.id), eq(policyBundles.organizationId, ctx.organizationId))).limit(1);
        const bundle = bundleRows[0];
        if (!bundle) return { notFound: true } as const;

        const versionRows = await tx.select().from(policyVersions).where(and(eq(policyVersions.id, body.data.version_id), eq(policyVersions.policyBundleId, bundle.id))).limit(1);
        const version = versionRows[0];
        if (!version) return { versionNotFound: true } as const;

        // Optimistic locking: the publish only applies if the bundle's
        // revision still matches what the caller last saw, preventing a
        // lost update from two concurrent publishers (spec section 6:
        // "one active policy bundle per environment with optimistic
        // locking to prevent lost updates").
        const casResult = await tx
          .update(policyBundles)
          .set({ activeVersionId: version.id, revision: bundle.revision + 1 })
          .where(and(eq(policyBundles.id, bundle.id), eq(policyBundles.revision, body.data.expected_revision)))
          .returning({ id: policyBundles.id });
        if (casResult.length === 0) {
          return { staleRevision: true, currentRevision: bundle.revision } as const;
        }

        if (bundle.activeVersionId) {
          await tx.update(policyVersions).set({ status: "superseded" }).where(eq(policyVersions.id, bundle.activeVersionId));
        }
        await tx.update(policyVersions).set({ status: "published", publishedAt: new Date(), changeReason: body.data.change_reason || version.changeReason }).where(eq(policyVersions.id, version.id));
        await writeAuditEvent(tx, ctx.organizationId, "user", ctx.userId, "policy.published", { bundleId: bundle.id, versionId: version.id });
        return { ok: true } as const;
      });

      if ("notFound" in result) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "policy bundle not found"));
      if ("versionNotFound" in result) return sendApiError(reply, req, new ApiError(404, "NOT_FOUND", "policy version not found"));
      if ("staleRevision" in result) return sendApiError(reply, req, new ApiError(409, "CONFLICT", `expected_revision is stale; current revision is ${result.currentRevision}`));
      return { status: "ok" };
    })
  );
}

function serializeVersion(v: typeof policyVersions.$inferSelect) {
  return {
    version_id: v.id,
    version_number: v.versionNumber,
    bundle: v.bundle,
    bundle_hash: v.bundleHash,
    status: v.status,
    change_reason: v.changeReason,
    created_at: v.createdAt,
    published_at: v.publishedAt,
  };
}
