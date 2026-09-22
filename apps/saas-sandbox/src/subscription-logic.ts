import { eq } from "drizzle-orm";
import { SAAS_PLAN_SLUGS, type SaasPlanSlug } from "@trustrail/contracts";
import type { Db } from "./db/client.js";
import { accounts, accountActions } from "./db/schema.js";
import { newActionId } from "./db/ids.js";

export type ActionName =
  | "subscription.grant_credit"
  | "subscription.change_plan"
  | "subscription.activate_feature"
  | "subscription.invite_user";

export interface GrantCreditArguments {
  amount_minor: number;
  currency: string;
  reason: string;
}

export interface ChangePlanArguments {
  target_plan: string;
  reason: string;
}

export interface ActivateFeatureArguments {
  feature_key: string;
  reason: string;
}

export interface InviteUserArguments {
  email: string;
  role: string;
  reason: string;
}

export type ActionInput =
  | { action: "subscription.grant_credit"; arguments: GrantCreditArguments }
  | { action: "subscription.change_plan"; arguments: ChangePlanArguments }
  | { action: "subscription.activate_feature"; arguments: ActivateFeatureArguments }
  | { action: "subscription.invite_user"; arguments: InviteUserArguments };

export type ApplyActionInput = ActionInput & {
  organizationId: string;
  accountId: string;
  idempotencyKey: string;
};

export type ApplyActionResult =
  | { outcome: "succeeded"; replay: boolean; referenceId: string; detail: string }
  | { outcome: "account_not_found" }
  | { outcome: "account_suspended" }
  | { outcome: "invalid_plan" };

function isKnownPlan(value: string): value is SaasPlanSlug {
  return (SAAS_PLAN_SLUGS as readonly string[]).includes(value);
}

/**
 * The sandbox's own enforcement, mirroring apps/merchant-sandbox's
 * `createRefund`: `SELECT ... FOR UPDATE` on the account row serializes
 * concurrent actions against the same account, and a unique index on
 * `idempotency_key` means a retried request after a timeout can never
 * double-apply a mutation -- it always returns the original result.
 *
 * Ordering of defensive checks against an existing account: suspension is
 * account-wide state and is checked before any action-specific validation
 * (e.g. an invalid target plan), matching the "any of the four: if the
 * account is suspended, respond 409 instead of applying the mutation"
 * requirement.
 */
export async function applyAccountAction(db: Db, input: ApplyActionInput): Promise<ApplyActionResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(accountActions)
      .where(eq(accountActions.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing[0]) {
      const a = existing[0];
      return { outcome: "succeeded", replay: true, referenceId: a.id, detail: a.detail ?? "" } as const;
    }

    const accountRows = await tx.select().from(accounts).where(eq(accounts.id, input.accountId)).for("update");
    const account = accountRows[0];
    if (!account || account.organizationId !== input.organizationId) {
      return { outcome: "account_not_found" } as const;
    }

    if (account.suspended) {
      return { outcome: "account_suspended" } as const;
    }

    if (input.action === "subscription.change_plan" && !isKnownPlan(input.arguments.target_plan)) {
      return { outcome: "invalid_plan" } as const;
    }

    let detail: string;
    switch (input.action) {
      case "subscription.grant_credit": {
        const { amount_minor, currency } = input.arguments;
        detail = `granted ${amount_minor} ${currency} credit`;
        break;
      }
      case "subscription.change_plan": {
        await tx.update(accounts).set({ planId: input.arguments.target_plan }).where(eq(accounts.id, account.id));
        detail = `plan changed to ${input.arguments.target_plan}`;
        break;
      }
      case "subscription.activate_feature": {
        const alreadyActive = account.featureKeys.includes(input.arguments.feature_key);
        if (!alreadyActive) {
          await tx
            .update(accounts)
            .set({ featureKeys: [...account.featureKeys, input.arguments.feature_key] })
            .where(eq(accounts.id, account.id));
        }
        detail = alreadyActive ? "already active" : `feature ${input.arguments.feature_key} activated`;
        break;
      }
      case "subscription.invite_user": {
        const isAdmin = input.arguments.role === "admin";
        await tx
          .update(accounts)
          .set({
            userCount: account.userCount + 1,
            adminUserCount: isAdmin ? account.adminUserCount + 1 : account.adminUserCount,
          })
          .where(eq(accounts.id, account.id));
        detail = `invited ${input.arguments.email} as ${input.arguments.role}`;
        break;
      }
    }

    const referenceId = newActionId();
    try {
      await tx.insert(accountActions).values({
        id: referenceId,
        organizationId: input.organizationId,
        accountId: account.id,
        action: input.action,
        idempotencyKey: input.idempotencyKey,
        arguments: input.arguments,
        status: "succeeded",
        detail,
      });
    } catch (err) {
      // Unique violation on idempotencyKey: a concurrent request with the
      // exact same key won the race. Return its result instead of erroring.
      const again = await tx
        .select()
        .from(accountActions)
        .where(eq(accountActions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (again[0]) {
        return { outcome: "succeeded", replay: true, referenceId: again[0].id, detail: again[0].detail ?? "" } as const;
      }
      throw err;
    }

    return { outcome: "succeeded", replay: false, referenceId, detail } as const;
  });
}
