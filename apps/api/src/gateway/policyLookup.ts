import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { policyBundles, policyVersions } from "../db/schema.js";
import { policyBundleSchema, type PolicyBundle } from "@trustrail/contracts";

export interface ActivePolicy {
  policyVersionId: string;
  policyHash: string;
  bundle: PolicyBundle;
}

/**
 * "Missing policies, invalid fields, unknown currencies... fail closed"
 * (docs/PRODUCT_SPEC.md section 6) -- returns null on anything short of a
 * fully valid, published bundle, and the caller treats null as
 * POLICY_UNAVAILABLE, never as an implicit ALLOW.
 */
export async function getActivePolicy(db: Db, organizationId: string, environment: string, action: string): Promise<ActivePolicy | null> {
  const bundleRows = await db
    .select()
    .from(policyBundles)
    .where(and(eq(policyBundles.organizationId, organizationId), eq(policyBundles.environment, environment), eq(policyBundles.action, action)))
    .limit(1);
  const bundleRow = bundleRows[0];
  if (!bundleRow || !bundleRow.activeVersionId) return null;

  const versionRows = await db.select().from(policyVersions).where(eq(policyVersions.id, bundleRow.activeVersionId)).limit(1);
  const versionRow = versionRows[0];
  if (!versionRow || versionRow.status !== "published") return null;

  const parsed = policyBundleSchema.safeParse(versionRow.bundle);
  if (!parsed.success) return null;

  return { policyVersionId: versionRow.id, policyHash: versionRow.bundleHash, bundle: parsed.data };
}
