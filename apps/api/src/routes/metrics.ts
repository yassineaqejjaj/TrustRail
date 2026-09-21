import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Db } from "@trustrail/db";
import { withTenant } from "@trustrail/db";
import { userRoute } from "../http/handlers.js";

/**
 * Real aggregates computed from the actions/usage_events tables -- never a
 * hardcoded number (spec section 15: "Measure latency instead of inserting
 * a hardcoded number"). An organization with no activity yet reports all
 * zeros, not fabricated traction (section 13: "Empty means zero, not
 * generated traction").
 */
export function registerMetricsRoutes(app: FastifyInstance, db: Db) {
  app.get(
    "/v1/metrics/summary",
    userRoute(db, async (ctx) => {
      return withTenant(db, ctx.organizationId, async (tx) => {
        const counts = await tx.execute(sql`
          select
            count(*) as total,
            count(*) filter (where decision = 'ALLOW') as allowed,
            count(*) filter (where decision = 'DENY') as denied,
            count(*) filter (where execution_state = 'awaiting_approval') as awaiting_approval,
            count(*) filter (where execution_state = 'succeeded') as succeeded,
            count(*) filter (where execution_state = 'failed') as failed,
            count(*) filter (where execution_state = 'unknown') as unknown
          from actions
        `);
        const latency = await tx.execute(sql`
          select
            percentile_cont(0.5) within group (order by latency_ms) as p50,
            percentile_cont(0.95) within group (order by latency_ms) as p95,
            percentile_cont(0.99) within group (order by latency_ms) as p99
          from usage_events where event_type = 'authorization'
        `);

        const row = (counts as unknown as { rows: Array<Record<string, string>> }).rows[0] ?? {};
        const lat = (latency as unknown as { rows: Array<Record<string, string | null>> }).rows[0] ?? {};

        return {
          total_actions: Number(row.total ?? 0),
          allowed: Number(row.allowed ?? 0),
          denied: Number(row.denied ?? 0),
          awaiting_approval: Number(row.awaiting_approval ?? 0),
          succeeded: Number(row.succeeded ?? 0),
          failed: Number(row.failed ?? 0),
          unknown: Number(row.unknown ?? 0),
          execution_success_rate: Number(row.total ?? 0) > 0 ? Number(row.succeeded ?? 0) / Number(row.total ?? 1) : null,
          authorization_latency_ms: { p50: lat.p50 ? Number(lat.p50) : null, p95: lat.p95 ? Number(lat.p95) : null, p99: lat.p99 ? Number(lat.p99) : null },
          note: "Aggregates are over all recorded actions for this organization; no time-range filter has been applied yet.",
        };
      });
    })
  );
}
