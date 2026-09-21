import { and, eq, sql } from "drizzle-orm";
import type { GrantChainLink } from "@trustrail/policy-engine";
import type { PolicyBundle } from "@trustrail/contracts";
import type { Db } from "../db/client.js";
import { budgetReservations, budgetWindows } from "../db/schema.js";
import { newId } from "../db/ids.js";

export interface BudgetTarget {
  key: string;
  limitMinor: number;
  label: string;
}

export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function policyDailyBudgetKey(environment: string, action: string): string {
  return `policy_daily:${environment}:${action}`;
}

/**
 * "All descendants consume the root's shared budget and every applicable
 * ancestor sub-budget" (docs/PRODUCT_SPEC.md section 5) plus the policy's
 * own org-wide daily ceiling for the action (section 6). Each of these is
 * tracked as an independent budget_windows row so a reservation is atomic
 * across all of them.
 */
export function getBudgetTargets(chain: GrantChainLink[], policy: PolicyBundle, environment: string): BudgetTarget[] {
  const targets: BudgetTarget[] = [];
  const root = chain[0]!;
  if (root.rootBudgetLimitMinor != null) {
    targets.push({ key: root.id, limitMinor: root.rootBudgetLimitMinor, label: "root grant daily budget" });
  }
  for (const link of chain.slice(1)) {
    if (link.childBudgetLimitMinor != null) {
      targets.push({ key: link.id, limitMinor: link.childBudgetLimitMinor, label: `child grant budget (${link.id})` });
    }
  }
  targets.push({ key: policyDailyBudgetKey(environment, policy.action), limitMinor: policy.root_daily_limit_minor, label: "policy daily budget" });
  return targets;
}

export class BudgetExceededError extends Error {
  constructor(public readonly exceededKey: string) {
    super(`budget exceeded for ${exceededKey}`);
  }
}

/**
 * Atomically reserves `amountMinor` against every target budget window in
 * the same transaction as the action's dispatch claim (spec section 6,
 * step 7 and section 7 "Budgets"). Locks windows in a deterministic
 * (sorted) key order to avoid deadlocks under concurrency, reads all of
 * them first, and only writes once every target has room -- so a request
 * that would blow one budget never partially reserves the others.
 *
 * Returns the reservation row IDs so the caller can commit/release them
 * later without re-deriving the target list.
 */
export async function reserveBudgets(
  tx: Db,
  organizationId: string,
  windowDate: string,
  targets: BudgetTarget[],
  amountMinor: number,
  actionId: string
): Promise<string[]> {
  const sorted = [...targets].sort((a, b) => a.key.localeCompare(b.key));
  const windowIds: string[] = [];

  for (const target of sorted) {
    await tx
      .insert(budgetWindows)
      .values({
        id: newId("budgetWindow"),
        organizationId,
        grantId: target.key,
        windowDate,
        currency: "EUR",
        limitMinor: target.limitMinor,
      })
      .onConflictDoNothing({ target: [budgetWindows.organizationId, budgetWindows.grantId, budgetWindows.windowDate] });

    const rows = await tx.execute(sql`
      select id, limit_minor, reserved_minor, committed_minor
      from budget_windows
      where organization_id = ${organizationId} and grant_id = ${target.key} and window_date = ${windowDate}
      for update
    `);
    const row = (rows as unknown as { rows: Array<{ id: string; limit_minor: number; reserved_minor: number; committed_minor: number }> }).rows[0];
    if (!row) throw new Error(`budget window disappeared for ${target.key}`);

    const available = row.limit_minor - row.reserved_minor - row.committed_minor;
    if (amountMinor > available) {
      throw new BudgetExceededError(target.key);
    }
    windowIds.push(row.id);
  }

  for (const windowId of windowIds) {
    await tx.execute(sql`update budget_windows set reserved_minor = reserved_minor + ${amountMinor} where id = ${windowId}`);
    await tx.insert(budgetReservations).values({
      id: newId("budgetReservation"),
      organizationId,
      budgetWindowId: windowId,
      actionId,
      amountMinor,
      status: "reserved",
    });
  }

  return windowIds;
}

export async function commitReservations(tx: Db, organizationId: string, actionId: string): Promise<void> {
  const reservations = await tx
    .select()
    .from(budgetReservations)
    .where(and(eq(budgetReservations.organizationId, organizationId), eq(budgetReservations.actionId, actionId), eq(budgetReservations.status, "reserved")));
  for (const r of reservations) {
    await tx.execute(sql`
      update budget_windows
      set reserved_minor = reserved_minor - ${r.amountMinor}, committed_minor = committed_minor + ${r.amountMinor}
      where id = ${r.budgetWindowId}
    `);
    await tx
      .update(budgetReservations)
      .set({ status: "committed", resolvedAt: new Date() })
      .where(eq(budgetReservations.id, r.id));
  }
}

export async function releaseReservations(tx: Db, organizationId: string, actionId: string): Promise<void> {
  const reservations = await tx
    .select()
    .from(budgetReservations)
    .where(and(eq(budgetReservations.organizationId, organizationId), eq(budgetReservations.actionId, actionId), eq(budgetReservations.status, "reserved")));
  for (const r of reservations) {
    await tx.execute(sql`update budget_windows set reserved_minor = reserved_minor - ${r.amountMinor} where id = ${r.budgetWindowId}`);
    await tx
      .update(budgetReservations)
      .set({ status: "released", resolvedAt: new Date() })
      .where(eq(budgetReservations.id, r.id));
  }
}
