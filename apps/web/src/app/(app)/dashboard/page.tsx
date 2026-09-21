"use client";

import Link from "next/link";
import { Activity, CheckCircle2, Clock, ShieldOff, Timer } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useApi } from "@/hooks/useApi";
import { metricsApi, actionsApi } from "@/lib/api";
import { Card, DecisionBadge, EmptyState, ErrorBanner, ExecutionBadge, LoadingBlock, Mono, PageHeader, Skeleton } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <p className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</p>
    </Card>
  );
}

export default function DashboardPage() {
  const { orgId } = useAuth();
  const metrics = useApi(() => metricsApi.summary(orgId!), [orgId], { skip: !orgId, pollMs: 8000 });
  const recent = useApi(() => actionsApi.list(orgId!, { limit: 8 }), [orgId], { skip: !orgId, pollMs: 8000 });

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Real counts from your organization's recorded actions. A new organization reports zero, never generated traction."
      />

      {metrics.error && <ErrorBanner message={metrics.error} requestId={metrics.requestId} onRetry={metrics.refetch} />}

      {!metrics.error && (
        <>
          {metrics.loading && !metrics.data ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            metrics.data && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Total actions" value={String(metrics.data.total_actions)} icon={Activity} tone="text-ink" />
                <StatCard label="Allowed" value={String(metrics.data.allowed)} icon={CheckCircle2} tone="text-success" />
                <StatCard label="Awaiting approval" value={String(metrics.data.awaiting_approval)} icon={Clock} tone="text-pending" />
                <StatCard label="Denied" value={String(metrics.data.denied)} icon={ShieldOff} tone="text-danger" />
              </div>
            )
          )}

          {metrics.data && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Execution success rate</p>
                <p className="mt-3 text-2xl font-semibold text-ink">
                  {metrics.data.execution_success_rate === null ? "—" : `${(metrics.data.execution_success_rate * 100).toFixed(1)}%`}
                </p>
                <p className="mt-1 text-xs text-muted">succeeded ÷ total actions, all-time</p>
              </Card>
              <Card className="p-5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Authorization latency (measured)</p>
                  <Timer className="h-4 w-4 text-muted" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-4">
                  {(["p50", "p95", "p99"] as const).map((p) => (
                    <div key={p}>
                      <p className="text-xs text-muted">{p}</p>
                      <p className="text-lg font-semibold text-ink">
                        {metrics.data!.authorization_latency_ms[p] === null ? "—" : `${Math.round(metrics.data!.authorization_latency_ms[p]!)} ms`}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
          {metrics.data && <p className="mt-3 text-xs text-muted">{metrics.data.note}</p>}
        </>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
          <Link href="/activity" className="text-sm font-medium text-accent hover:underline">
            View all
          </Link>
        </div>
        {recent.loading && !recent.data && <LoadingBlock />}
        {recent.error && <ErrorBanner message={recent.error} requestId={recent.requestId} onRetry={recent.refetch} />}
        {recent.data && recent.data.actions.length === 0 && (
          <EmptyState
            title="No actions recorded yet"
            description="Run your first action from Onboarding or the Demo lab to see it appear here."
            action={
              <Link href="/onboarding" className="text-sm font-medium text-accent hover:underline">
                Go to onboarding
              </Link>
            }
          />
        )}
        {recent.data && recent.data.actions.length > 0 && (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Decision</th>
                  <th className="px-4 py-2.5 font-medium">Execution</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.actions.map((a) => (
                  <tr key={a.action_id} className="border-b border-border last:border-0 hover:bg-bg">
                    <td className="px-4 py-2.5">
                      <Link href={`/actions/${a.action_id}`} className="font-medium text-ink hover:text-accent">
                        <Mono>{a.action}</Mono>
                      </Link>
                      <p className="text-xs text-muted">
                        <Mono>{a.resource_id}</Mono>
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{formatMoney(a.amount_minor, a.currency)}</td>
                    <td className="px-4 py-2.5">
                      <DecisionBadge decision={a.decision} />
                    </td>
                    <td className="px-4 py-2.5">
                      <ExecutionBadge state={a.execution_state} />
                    </td>
                    <td className="px-4 py-2.5 text-muted">{formatDateTime(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
