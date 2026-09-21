import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@trustrail/db";
import { withTenant, actions, agents } from "@trustrail/db";

/**
 * Detects a sudden burst of requests from one agent credential -- the
 * residual risk docs/THREAT_MODEL.md calls out explicitly: "a stolen
 * *active* credential can do everything the legitimate agent could do
 * until someone revokes it. Detection of anomalous usage (e.g. sudden
 * burst of refund requests) is not implemented in V1."
 *
 * This is deliberately a simple, honest fixed-threshold velocity check
 * over a rolling window, computed on read -- not a persisted alert log,
 * not ML-based, and not wired into the request path at all (so it can
 * never change whether a legitimate action is allowed, denied, or held
 * for approval; see ROADMAP.md for why that separation matters -- the
 * `concurrent_budget_limit` demo scenario alone submits 8 requests in a
 * few seconds from one agent, which a request-time throttle would have to
 * carefully avoid flagging). A follow-up could persist flags and notify a
 * human instead of requiring someone to check this report.
 */
export interface AgentActivityAnomaly {
  agent_id: string;
  agent_name: string;
  window_seconds: number;
  request_count: number;
  threshold: number;
}

export interface AnomalyDetectionOptions {
  windowSeconds?: number;
  threshold?: number;
}

const DEFAULT_WINDOW_SECONDS = 300; // 5 minutes
const DEFAULT_THRESHOLD = 30; // requests within the window

export async function detectAgentActivityAnomalies(
  db: Db,
  organizationId: string,
  opts: AnomalyDetectionOptions = {}
): Promise<AgentActivityAnomaly[]> {
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const since = new Date(Date.now() - windowSeconds * 1000);

  return withTenant(db, organizationId, async (tx) => {
    const rows = await tx
      .select({ agentId: actions.actorAgentId, count: sql<number>`count(*)`.mapWith(Number) })
      .from(actions)
      .where(and(eq(actions.organizationId, organizationId), gte(actions.createdAt, since)))
      .groupBy(actions.actorAgentId)
      .having(sql`count(*) >= ${threshold}`);

    if (rows.length === 0) return [];

    const agentRows = await tx.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.organizationId, organizationId));
    const nameById = new Map(agentRows.map((a) => [a.id, a.name]));

    return rows.map((r) => ({
      agent_id: r.agentId,
      agent_name: nameById.get(r.agentId) ?? r.agentId,
      window_seconds: windowSeconds,
      request_count: r.count,
      threshold,
    }));
  });
}
