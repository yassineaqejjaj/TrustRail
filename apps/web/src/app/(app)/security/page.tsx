"use client";

import { ShieldAlert } from "lucide-react";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useApi } from "@/hooks/useApi";
import { securityApi } from "@/lib/api";
import { Card, EmptyState, ErrorBanner, LoadingBlock, Mono, PageHeader } from "@/components/ui";

export default function SecurityPage() {
  const { orgId, role } = useAuth();
  const canView = roleAtLeast(role, "admin");

  const query = useApi(() => securityApi.anomalies(orgId!), [orgId], { skip: !orgId || !canView, pollMs: 10_000 });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Security" />
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="Admin role required"
          description="Anomaly detection is admin-only. Ask an Owner to grant the Admin role in Settings."
        />
      </div>
    );
  }

  const windowLabel = query.data?.anomalies[0] ? `${Math.round(query.data.anomalies[0].window_seconds / 60)} min` : "5 min";

  return (
    <div>
      <PageHeader
        title="Security"
        description="A simple, fixed-threshold check for a sudden burst of requests from one agent credential — the residual risk if a credential is stolen but not yet revoked. Not machine-learned, not request-blocking: this only surfaces volume for a human to review."
      />

      {query.loading && !query.data && <LoadingBlock />}
      {query.error && <ErrorBanner message={query.error} requestId={query.requestId} onRetry={query.refetch} />}
      {query.data && query.data.anomalies.length === 0 && (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No anomalies" description={`No agent has crossed the request-volume threshold in the last ${windowLabel}.`} />
      )}
      {query.data && query.data.anomalies.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Requests</th>
                <th className="px-4 py-2.5 font-medium">Window</th>
                <th className="px-4 py-2.5 font-medium">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {query.data.anomalies.map((a) => (
                <tr key={a.agent_id} className="border-b border-border last:border-0 hover:bg-bg">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{a.agent_name}</p>
                    <Mono className="text-xs text-muted">{a.agent_id}</Mono>
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-danger">{a.request_count}</td>
                  <td className="px-4 py-2.5 text-muted">{Math.round(a.window_seconds / 60)} min</td>
                  <td className="px-4 py-2.5 text-muted">{a.threshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
