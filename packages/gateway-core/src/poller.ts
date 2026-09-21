import { eq, and, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { organizations, executionJobs } from "@trustrail/db";
import { dispatchAction, type DispatchDeps } from "./dispatch.js";

/**
 * The worker has no elevated database role -- it uses the exact same
 * RLS-restricted `trustrail_app` connection as the API. `organizations` is
 * the one global (non-tenant-scoped) table, so the worker lists org IDs
 * from it and then opens one tenant-scoped transaction per organization to
 * find that organization's own due jobs. This keeps "the runtime role
 * never bypasses RLS" true even for background work, at the cost of an
 * O(orgs) scan per tick -- acceptable at demo/V1 scale, called out as a
 * scaling limitation in docs/BUILD_STATUS.md.
 */
export async function pollOnce(db: Db, deps: DispatchDeps, leaseOwner = randomUUID()): Promise<{ claimed: number; results: string[] }> {
  const orgRows = await db.select({ id: organizations.id }).from(organizations);
  let claimed = 0;
  const results: string[] = [];

  for (const org of orgRows) {
    const dueActionIds = await withTenant(db, org.id, async (tx) => {
      const now = new Date();
      const due = await tx
        .select()
        .from(executionJobs)
        .where(and(eq(executionJobs.status, "pending"), lte(executionJobs.nextAttemptAt, now)));

      const ids: string[] = [];
      for (const job of due) {
        const leaseExpiresAt = new Date(Date.now() + 30_000);
        const claimed = await tx
          .update(executionJobs)
          .set({ status: "leased", leaseOwner, leaseExpiresAt, updatedAt: new Date() })
          .where(and(eq(executionJobs.id, job.id), eq(executionJobs.status, "pending")))
          .returning({ id: executionJobs.id });
        if (claimed.length > 0) {
          ids.push(job.actionId);
        }
      }
      return ids;
    });

    for (const actionId of dueActionIds) {
      claimed++;
      const state = await dispatchAction(db, deps, org.id, actionId);
      results.push(`${actionId}:${state}`);
    }
  }

  return { claimed, results };
}

export function runWorkerForever(db: Db, deps: DispatchDeps, intervalMs = 2000): { stop: () => void } {
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        await pollOnce(db, deps);
      } catch (err) {
        console.error("worker poll error", err);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  return { stop: () => { stopped = true; } };
}
