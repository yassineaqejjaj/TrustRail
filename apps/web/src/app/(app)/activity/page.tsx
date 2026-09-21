"use client";

import Link from "next/link";
import { useState } from "react";
import type { Decision, ExecutionState } from "@trustrail/contracts";
import { DECISIONS, EXECUTION_STATES } from "@/lib/constants";
import { useAuth } from "@/context/auth-context";
import { useApi } from "@/hooks/useApi";
import { actionsApi, agentsApi } from "@/lib/api";
import { Button, Card, DecisionBadge, EmptyState, ErrorBanner, ExecutionBadge, LoadingBlock, Mono, PageHeader, inputClass } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";

export default function ActivityPage() {
  const { orgId } = useAuth();
  const [agentId, setAgentId] = useState("");
  const [decision, setDecision] = useState<Decision | "">("");
  const [executionState, setExecutionState] = useState<ExecutionState | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const agentsQuery = useApi(() => agentsApi.list(orgId!), [orgId], { skip: !orgId });
  const actionsQuery = useApi(
    () =>
      actionsApi.list(orgId!, {
        limit: 25,
        cursor,
        agent_id: agentId || undefined,
        decision: decision || undefined,
        execution_state: executionState || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      }),
    [orgId, agentId, decision, executionState, from, to, cursor],
    { skip: !orgId, pollMs: 8000 }
  );

  const agentName = new Map((agentsQuery.data?.agents ?? []).map((a) => [a.agent_id, a.name] as const));

  return (
    <div>
      <PageHeader title="Activity" description="Every recorded action for this organization. Rows link to the full action detail." />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <select className={inputClass} value={agentId} onChange={(e) => { setCursor(undefined); setAgentId(e.target.value); }}>
            <option value="">All agents</option>
            {(agentsQuery.data?.agents ?? []).map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.name}
              </option>
            ))}
          </select>
          <select className={inputClass} value={decision} onChange={(e) => { setCursor(undefined); setDecision(e.target.value as Decision | ""); }}>
            <option value="">All decisions</option>
            {DECISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select className={inputClass} value={executionState} onChange={(e) => { setCursor(undefined); setExecutionState(e.target.value as ExecutionState | ""); }}>
            <option value="">All execution states</option>
            {EXECUTION_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input type="date" className={inputClass} value={from} onChange={(e) => { setCursor(undefined); setFrom(e.target.value); }} aria-label="From date" />
          <input type="date" className={inputClass} value={to} onChange={(e) => { setCursor(undefined); setTo(e.target.value); }} aria-label="To date" />
          <Button
            variant="secondary"
            onClick={() => {
              setAgentId("");
              setDecision("");
              setExecutionState("");
              setFrom("");
              setTo("");
              setCursor(undefined);
            }}
          >
            Clear filters
          </Button>
        </div>
      </Card>

      {actionsQuery.loading && !actionsQuery.data && <LoadingBlock />}
      {actionsQuery.error && <ErrorBanner message={actionsQuery.error} requestId={actionsQuery.requestId} onRetry={actionsQuery.refetch} />}
      {actionsQuery.data && actionsQuery.data.actions.length === 0 && <EmptyState title="No actions match these filters" />}

      {actionsQuery.data && actionsQuery.data.actions.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Decision</th>
                  <th className="px-4 py-2.5 font-medium">Execution</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {actionsQuery.data.actions.map((a) => (
                  <tr key={a.action_id} className="border-b border-border last:border-0 hover:bg-bg">
                    <td className="px-4 py-2.5">
                      <Link href={`/actions/${a.action_id}`} className="font-medium text-ink hover:text-accent">
                        <Mono>{a.action}</Mono>
                      </Link>
                      <p className="text-xs text-muted">
                        <Mono>{a.resource_id}</Mono>
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{agentName.get(a.actor_agent_id) ?? a.actor_agent_id}</td>
                    <td className="px-4 py-2.5">{formatMoney(a.amount_minor, a.currency)}</td>
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
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" disabled={!actionsQuery.data.next_cursor} onClick={() => setCursor(actionsQuery.data!.next_cursor!)}>
              Next page
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
