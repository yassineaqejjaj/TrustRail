"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { useAuth } from "@/context/auth-context";
import { useApi } from "@/hooks/useApi";
import { actionsApi, agentsApi, grantsApi } from "@/lib/api";
import { Card, DecisionBadge, ErrorBanner, ExecutionBadge, ApprovalBadge, LoadingBlock, Mono, PageHeader, Tag, CopyButton } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";

export default function ActionDetailPage() {
  const params = useParams<{ id: string }>();
  const { orgId } = useAuth();
  const actionQuery = useApi(() => actionsApi.get(orgId!, params.id), [orgId, params.id], { skip: !orgId, pollMs: 5000 });
  const grantsQuery = useApi(() => grantsApi.list(orgId!), [orgId], { skip: !orgId });
  const agentsQuery = useApi(() => agentsApi.list(orgId!), [orgId], { skip: !orgId });

  const chain = useMemo(() => {
    if (!actionQuery.data || !grantsQuery.data) return [];
    const byId = new Map(grantsQuery.data.grants.map((g) => [g.grant_id, g] as const));
    const result = [];
    let current = byId.get(actionQuery.data.grant_id);
    const seen = new Set<string>();
    while (current && !seen.has(current.grant_id)) {
      seen.add(current.grant_id);
      result.unshift(current);
      current = current.parent_grant_id ? byId.get(current.parent_grant_id) : undefined;
    }
    return result;
  }, [actionQuery.data, grantsQuery.data]);

  const agentName = new Map((agentsQuery.data?.agents ?? []).map((a) => [a.agent_id, a.name] as const));

  if (actionQuery.loading && !actionQuery.data) return <LoadingBlock label="Loading action…" />;
  if (actionQuery.error) return <ErrorBanner message={actionQuery.error} requestId={actionQuery.requestId} onRetry={actionQuery.refetch} />;
  if (!actionQuery.data) return null;

  const a = actionQuery.data;
  const permitted = a.decision === "ALLOW";
  const executed = a.execution_state === "succeeded";

  return (
    <div>
      <PageHeader
        title={`${a.action} on ${a.resource_id}`}
        description={
          <span className="mono text-xs">
            {a.action_id} · trace <Mono>{a.trace_id}</Mono>
          </span>
        }
        actions={<CopyButton value={a.action_id} label="Copy action ID" />}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Permitted (policy decision)</p>
          <div className="mt-2">
            <DecisionBadge decision={a.decision} />
          </div>
          {a.reason_codes.length > 0 && <p className="mt-2 text-xs text-muted">Reasons: {a.reason_codes.join(", ")}</p>}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Executed (downstream outcome)</p>
          <div className="mt-2">
            <ExecutionBadge state={a.execution_state} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {permitted && !executed && a.execution_state !== "denied" ? "Permitted, but not yet confirmed as executed." : permitted && executed ? "Confirmed executed by the merchant sandbox." : "Never reached the merchant."}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Amount</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{formatMoney(a.amount_minor, a.currency)}</p>
          <p className="mt-1 text-xs text-muted">{formatDateTime(a.created_at)}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Request summary</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Actor agent" value={agentName.get(a.actor_agent_id) ?? a.actor_agent_id} />
            <Row label="Principal" value={<Mono>{a.principal_id}</Mono>} />
            <Row label="Grant used" value={<Mono>{a.grant_id}</Mono>} />
            <Row label="Root grant" value={<Mono>{a.root_grant_id}</Mono>} />
            <Row label="Connector" value={a.connector_id} />
            <Row label="Environment" value={a.environment} />
            <Row label="Request hash" value={<Mono className="break-all">{a.request_hash}</Mono>} />
            <Row label="Policy version" value={a.policy_version_id ? <Mono>{a.policy_version_id}</Mono> : "—"} />
            <Row label="Policy hash" value={a.policy_hash ? <Mono className="break-all">{a.policy_hash}</Mono> : "—"} />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Delegation chain</h2>
          {chain.length === 0 ? (
            <p className="text-sm text-muted">Chain unavailable (grant may have been removed from this listing).</p>
          ) : (
            <ol className="space-y-2">
              {chain.map((g, i) => (
                <li key={g.grant_id} className="flex items-center gap-2 text-sm">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg text-xs text-muted">{i + 1}</span>
                  <span className="font-medium text-ink">{agentName.get(g.subject_agent_id) ?? g.subject_agent_id}</span>
                  <span className="text-xs text-muted">up to {formatMoney(g.max_amount_minor, g.currency)}</span>
                  <Tag tone={g.status === "active" ? "accent" : "muted"}>{g.status}</Tag>
                </li>
              ))}
            </ol>
          )}
          <Link href="/delegations" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
            Inspect in Delegations →
          </Link>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Approval timeline</h2>
          {a.approval ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <ApprovalBadge status={a.approval.status} />
                <Mono className="text-xs text-muted">{a.approval.approval_id}</Mono>
              </div>
              <Row label="Expires" value={formatDateTime(a.approval.expires_at)} />
              <Row label="Reviewer" value={a.approval.reviewer_user_id ? <Mono>{a.approval.reviewer_user_id}</Mono> : "not yet decided"} />
              <Row label="Decided at" value={formatDateTime(a.approval.decided_at)} />
              <Link href="/approvals" className="mt-1 inline-block text-sm font-medium text-accent hover:underline">
                Open in Approvals →
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted">This action never required human approval.</p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Connector outcome &amp; receipts</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Connector reference" value={a.connector_reference ? <Mono>{a.connector_reference}</Mono> : "none — action did not dispatch"} />
          </dl>
          <div className="mt-3 flex flex-col gap-2">
            {a.receipts.length === 0 && <p className="text-sm text-muted">No receipts recorded for this action.</p>}
            {a.receipts.map((r) => (
              <div key={r.receipt_id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
                <div>
                  <p className="font-medium text-ink capitalize">{r.receipt_type} receipt</p>
                  <p className="text-xs text-muted">{formatDateTime(r.created_at)}</p>
                </div>
                <Link href={`/receipts?open=${r.receipt_id}`} className="text-sm font-medium text-accent hover:underline">
                  View &amp; verify →
                </Link>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted">
        Note: budget-reservation ledger detail (root/ancestor reserved vs. committed amounts) is tracked server-side
        but not yet exposed by <Mono>GET /v1/actions/:id</Mono> — flagged as a follow-up rather than fabricated here.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
