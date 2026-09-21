import { eq } from "drizzle-orm";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import {
  actions,
  receipts,
  approvals,
  idempotencyRecords,
  budgetWindows,
  budgetReservations,
  executionJobs,
  usageEvents,
  auditEvents,
  demoRuns,
} from "@trustrail/db";

/**
 * Clears only this organization's activity/transactional data -- never
 * identity, grants, or policy configuration, and never another
 * organization's data. Matches spec section 14: "A reset clears only an
 * explicitly isolated local demo workspace and never non-demo data."
 * Guarded at the route layer (src/routes/demo.ts) by APP_MODE.
 */
export async function resetDemoActivity(db: Db, organizationId: string): Promise<void> {
  await withTenant(db, organizationId, async (tx) => {
    await tx.delete(receipts).where(eq(receipts.organizationId, organizationId));
    await tx.delete(approvals).where(eq(approvals.organizationId, organizationId));
    await tx.delete(budgetReservations).where(eq(budgetReservations.organizationId, organizationId));
    await tx.delete(budgetWindows).where(eq(budgetWindows.organizationId, organizationId));
    await tx.delete(executionJobs).where(eq(executionJobs.organizationId, organizationId));
    await tx.delete(idempotencyRecords).where(eq(idempotencyRecords.organizationId, organizationId));
    await tx.delete(usageEvents).where(eq(usageEvents.organizationId, organizationId));
    await tx.delete(demoRuns).where(eq(demoRuns.organizationId, organizationId));
    await tx.delete(actions).where(eq(actions.organizationId, organizationId));
    await tx.delete(auditEvents).where(eq(auditEvents.organizationId, organizationId));
  });
}
