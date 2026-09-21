import { eq } from "drizzle-orm";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import {
  organizations,
  users,
  memberships,
  agents,
  agentCredentials,
  grants,
  policyBundles,
  policyVersions,
} from "@trustrail/db";
import { newId } from "@trustrail/db";
import { hashPassword } from "../auth/passwords.js";
import { generateApiKey } from "../auth/apiKeys.js";
import {
  DEMO_ORGANIZATION_NAME,
  DEMO_USERS,
  DEMO_AGENTS,
  DEMO_ROOT_GRANT_MAX_AMOUNT_MINOR,
  DEMO_ROOT_DAILY_BUDGET_MINOR,
  DEFAULT_POLICY_BUNDLE,
  canonicalHash,
} from "@trustrail/contracts";

export const DEMO_PASSWORD = "northstar-demo-2026!";

export interface SeedResult {
  organizationId: string;
  userIds: Record<keyof typeof DEMO_USERS, string>;
  supportAgentId: string;
  refundAgentId: string;
  supportAgentSecret: string;
  refundAgentSecret: string;
  rootGrantId: string;
  childGrantId: string;
}

/**
 * Idempotent: re-running finds the existing organization by name and
 * updates fixtures in place rather than duplicating them, so
 * `pnpm demo:seed` is safe to run repeatedly (spec section 14: "Seed/reset
 * are guarded and idempotent"). Credentials ARE rotated on every reseed
 * (there is no way to recover a previously-issued secret), so the caller
 * always gets fresh, working secrets back.
 */
export async function seedNorthstarCommerce(db: Db): Promise<SeedResult> {
  let organizationId: string;
  const existingOrg = await db.select().from(organizations).where(eq(organizations.name, DEMO_ORGANIZATION_NAME)).limit(1);
  if (existingOrg[0]) {
    organizationId = existingOrg[0].id;
  } else {
    organizationId = newId("organization");
    await db.insert(organizations).values({ id: organizationId, name: DEMO_ORGANIZATION_NAME, appMode: "demo" });
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds = {} as Record<keyof typeof DEMO_USERS, string>;

  for (const [key, def] of Object.entries(DEMO_USERS) as Array<[keyof typeof DEMO_USERS, (typeof DEMO_USERS)[keyof typeof DEMO_USERS]]>) {
    const existingUser = await db.select().from(users).where(eq(users.email, def.email)).limit(1);
    let userId: string;
    if (existingUser[0]) {
      userId = existingUser[0].id;
    } else {
      userId = newId("user");
      await db.insert(users).values({ id: userId, email: def.email, passwordHash });
    }
    userIds[key] = userId;

    const existingMembership = await db.select().from(memberships).where(eq(memberships.userId, userId)).limit(1);
    if (!existingMembership[0]) {
      await db.insert(memberships).values({ id: newId("membership"), organizationId, userId, role: def.role });
    }
  }

  async function upsertAgent(name: string, description: string, ownerUserId: string): Promise<{ agentId: string; secret: string }> {
    const result = await withTenant(db, organizationId, async (tx) => {
      const existing = await tx.select().from(agents).where(eq(agents.organizationId, organizationId));
      let agent = existing.find((a) => a.name === name);
      if (!agent) {
        const agentId = newId("agent");
        await tx.insert(agents).values({ id: agentId, organizationId, name, description, ownerUserId, environment: "sandbox", status: "active" });
        agent = (await tx.select().from(agents).where(eq(agents.id, agentId)))[0]!;
      }
      const generated = generateApiKey("sandbox");
      await tx.insert(agentCredentials).values({
        id: newId("credential"),
        organizationId,
        agentId: agent.id,
        environment: "sandbox",
        prefix: generated.prefix,
        secretDigest: generated.digest,
        status: "active",
      });
      return { agentId: agent.id, secret: generated.secret };
    });
    return result;
  }

  const support = await upsertAgent(DEMO_AGENTS.supportAgent.name, DEMO_AGENTS.supportAgent.description, userIds.supportManager);
  const refund = await upsertAgent(DEMO_AGENTS.refundAgent.name, DEMO_AGENTS.refundAgent.description, userIds.supportManager);

  const grantResult = await withTenant(db, organizationId, async (tx) => {
    const existingGrants = await tx.select().from(grants).where(eq(grants.organizationId, organizationId));
    let root = existingGrants.find((g) => g.subjectAgentId === support.agentId && g.parentGrantId === null);
    let rootGrantId: string;
    if (!root) {
      rootGrantId = newId("grant");
      await tx.insert(grants).values({
        id: rootGrantId,
        organizationId,
        environment: "sandbox",
        principalId: userIds.supportManager,
        issuerType: "user",
        issuerId: userIds.owner,
        subjectAgentId: support.agentId,
        parentGrantId: null,
        rootGrantId,
        allowedActions: ["refund.create"],
        allowedResourceIds: [],
        unrestrictedResources: true,
        allowedConnectorIds: ["merchant_sandbox"],
        currency: "EUR",
        maxAmountMinor: DEMO_ROOT_GRANT_MAX_AMOUNT_MINOR,
        rootBudgetLimitMinor: DEMO_ROOT_DAILY_BUDGET_MINOR,
        childBudgetLimitMinor: null,
        validFrom: null,
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
        delegationAllowed: true,
        maxRemainingDepth: 3,
        status: "active",
      });
    } else {
      rootGrantId = root.id;
    }

    let child = existingGrants.find((g) => g.subjectAgentId === refund.agentId && g.parentGrantId === rootGrantId);
    let childGrantId: string;
    if (!child) {
      childGrantId = newId("grant");
      await tx.insert(grants).values({
        id: childGrantId,
        organizationId,
        environment: "sandbox",
        principalId: userIds.supportManager,
        issuerType: "agent",
        issuerId: support.agentId,
        subjectAgentId: refund.agentId,
        parentGrantId: rootGrantId,
        rootGrantId,
        allowedActions: ["refund.create"],
        allowedResourceIds: [],
        unrestrictedResources: true,
        allowedConnectorIds: ["merchant_sandbox"],
        currency: "EUR",
        maxAmountMinor: DEMO_ROOT_GRANT_MAX_AMOUNT_MINOR,
        rootBudgetLimitMinor: null,
        childBudgetLimitMinor: DEMO_ROOT_DAILY_BUDGET_MINOR,
        validFrom: null,
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
        delegationAllowed: false,
        maxRemainingDepth: 0,
        status: "active",
      });
    } else {
      childGrantId = child.id;
    }
    return { rootGrantId, childGrantId };
  });

  await withTenant(db, organizationId, async (tx) => {
    const existingBundle = await tx.select().from(policyBundles).where(eq(policyBundles.organizationId, organizationId));
    const bundle = existingBundle.find((b) => b.environment === "sandbox" && b.action === "refund.create");
    if (!bundle) {
      const bundleId = newId("policyBundle");
      const versionId = newId("policyVersion");
      await tx.insert(policyBundles).values({ id: bundleId, organizationId, environment: "sandbox", action: "refund.create", activeVersionId: versionId, revision: 1 });
      await tx.insert(policyVersions).values({
        id: versionId,
        policyBundleId: bundleId,
        organizationId,
        versionNumber: 1,
        bundle: DEFAULT_POLICY_BUNDLE,
        bundleHash: canonicalHash(DEFAULT_POLICY_BUNDLE),
        status: "published",
        createdByUserId: userIds.owner,
        changeReason: "Northstar Commerce demo seed",
        publishedAt: new Date(),
      });
    }
  });

  return {
    organizationId,
    userIds,
    supportAgentId: support.agentId,
    refundAgentId: refund.agentId,
    supportAgentSecret: support.secret,
    refundAgentSecret: refund.secret,
    rootGrantId: grantResult.rootGrantId,
    childGrantId: grantResult.childGrantId,
  };
}
