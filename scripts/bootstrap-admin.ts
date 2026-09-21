/**
 * Creates the first organization + owner user directly against the
 * database, bypassing `POST /v1/auth/register` and `POST /v1/organizations`
 * entirely. Those routes are the normal way to onboard, but
 * `POST /v1/auth/register` refuses to run at all once `APP_MODE=production`
 * (docs/PRODUCT_SPEC.md section 3: "Disable open registration by default
 * outside local/demo mode; provide a documented admin bootstrap command")
 * -- this is that command. Safe to run against a database that already has
 * data in it: it only ever inserts the one new user/org/membership/policy
 * it's asked to create, and refuses outright if the email already exists.
 *
 * Usage:
 *   APP_DATABASE_URL=postgres://trustrail_app:...@host:port/trustrail \
 *     pnpm bootstrap:admin -- --email owner@example.com --org "Example Inc" --password 'a strong password'
 *
 * If --password is omitted, a random one is generated and printed once --
 * it is never stored anywhere but the database's password hash.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../apps/api/src/auth/passwords.js";
import { getDb, closePool, withTenant } from "@trustrail/db";
import { users, organizations, memberships, policyBundles, policyVersions } from "@trustrail/db";
import { newId } from "@trustrail/db";
import { eq } from "drizzle-orm";
import { DEFAULT_POLICY_BUNDLE, canonicalHash } from "@trustrail/contracts";

function parseArgs(): { email: string; org: string; password?: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const email = get("--email");
  const org = get("--org");
  const password = get("--password");
  if (!email || !org) {
    console.error("Usage: pnpm bootstrap:admin -- --email <email> --org <organization name> [--password <password>]");
    process.exit(1);
  }
  return { email, org, password };
}

async function main() {
  if (!process.env.APP_DATABASE_URL) {
    console.error("APP_DATABASE_URL is not set -- point this at the target database (see this file's header comment).");
    process.exit(1);
  }

  const { email, org, password: providedPassword } = parseArgs();
  const normalizedEmail = email.toLowerCase();
  const password = providedPassword ?? randomBytes(18).toString("base64url");

  const db = getDb();
  try {
    const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      console.error(`a user with email ${normalizedEmail} already exists -- refusing to create a duplicate`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    const userId = newId("user");
    const orgId = newId("organization");
    const membershipId = newId("membership");
    const bundleId = newId("policyBundle");
    const versionId = newId("policyVersion");
    const bundleHash = canonicalHash(DEFAULT_POLICY_BUNDLE);

    await db.insert(users).values({ id: userId, email: normalizedEmail, passwordHash });
    await db.insert(organizations).values({ id: orgId, name: org, appMode: "production" });
    await db.insert(memberships).values({ id: membershipId, organizationId: orgId, userId, role: "owner" });
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
        createdByUserId: userId,
        changeReason: "initial default policy from admin bootstrap",
        publishedAt: new Date(),
      });
    });

    console.log(`\nCreated organization "${org}" (${orgId}) with owner ${normalizedEmail} (${userId}).`);
    if (!providedPassword) {
      console.log(`Generated password (shown once, never stored anywhere but its hash): ${password}`);
    }
    console.log("Sign in at /onboarding?mode=login with these credentials.\n");
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
