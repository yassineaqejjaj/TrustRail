"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { ChevronRight, GitBranch, ShieldOff } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { agentsApi, grantsApi } from "@/lib/api";
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, Mono, PageHeader, Tag } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatMoney, formatDateTime } from "@/lib/format";
import type { Grant } from "@/lib/types";

export default function DelegationsPage() {
  const { orgId, role } = useAuth();
  const toast = useToast();
  const grantsQuery = useApi(() => grantsApi.list(orgId!), [orgId], { skip: !orgId, pollMs: 6000 });
  const agentsQuery = useApi(() => agentsApi.list(orgId!), [orgId], { skip: !orgId });
  const [selected, setSelected] = useState<Grant | null>(null);

  const grants = useMemo(() => grantsQuery.data?.grants ?? [], [grantsQuery.data]);
  const agentName = useMemo(() => {
    const map = new Map((agentsQuery.data?.agents ?? []).map((a) => [a.agent_id, a.name] as const));
    return (id: string) => map.get(id) ?? id;
  }, [agentsQuery.data]);

  const byParent = useMemo(() => {
    const m = new Map<string | null, Grant[]>();
    for (const g of grants) {
      const key = g.parent_grant_id;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(g);
    }
    return m;
  }, [grants]);

  const roots = byParent.get(null) ?? [];

  return (
    <div>
      <PageHeader
        title="Delegations"
        description="Principal → agent grant tree with effective limits. Selecting a grant shows its raw record and inherited limits. A plain table view is available below the tree — permissions are never conveyed by the graph alone."
      />

      {grantsQuery.loading && !grantsQuery.data && <LoadingBlock />}
      {grantsQuery.error && <ErrorBanner message={grantsQuery.error} requestId={grantsQuery.requestId} onRetry={grantsQuery.refetch} />}

      {grantsQuery.data && grants.length === 0 && (
        <EmptyState icon={<GitBranch className="h-6 w-6" />} title="No grants issued yet" description="Issue a root grant from Onboarding to see the delegation tree here." />
      )}

      {grantsQuery.data && grants.length > 0 && (
        <Tabs.Root defaultValue="tree">
          <Tabs.List className="mb-4 inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
            <Tabs.Trigger value="tree" className="rounded-md px-3 py-1.5 font-medium text-muted data-[state=active]:bg-accent data-[state=active]:text-white">
              Tree
            </Tabs.Trigger>
            <Tabs.Trigger value="table" className="rounded-md px-3 py-1.5 font-medium text-muted data-[state=active]:bg-accent data-[state=active]:text-white">
              Table
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="tree">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <Card className="p-4">
                  <ul>
                    {roots.map((g) => (
                      <TreeNode key={g.grant_id} grant={g} byParent={byParent} agentName={agentName} depth={0} onSelect={setSelected} selectedId={selected?.grant_id} />
                    ))}
                  </ul>
                </Card>
              </div>
              <div>
                {selected ? (
                  <GrantDetailPanel grant={selected} agentName={agentName} canRevoke={roleAtLeast(role, "admin")} onRevoked={() => { grantsQuery.refetch(); setSelected(null); toast.success("Grant revoked"); }} orgId={orgId!} />
                ) : (
                  <Card className="p-5 text-sm text-muted">Select a grant to inspect its raw record and inherited limits.</Card>
                )}
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="table">
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Grant</th>
                    <th className="px-4 py-2.5 font-medium">Subject agent</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Max per action</th>
                    <th className="px-4 py-2.5 font-medium">Root daily budget</th>
                    <th className="px-4 py-2.5 font-medium">Delegation</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((g) => (
                    <tr key={g.grant_id} className="cursor-pointer border-b border-border last:border-0 hover:bg-bg" onClick={() => setSelected(g)}>
                      <td className="px-4 py-2.5">
                        <Mono>{g.grant_id}</Mono>
                      </td>
                      <td className="px-4 py-2.5">{agentName(g.subject_agent_id)}</td>
                      <td className="px-4 py-2.5">{g.parent_grant_id ? "Child" : "Root"}</td>
                      <td className="px-4 py-2.5">{formatMoney(g.max_amount_minor, g.currency)}</td>
                      <td className="px-4 py-2.5">{g.root_budget_limit_minor ? formatMoney(g.root_budget_limit_minor, g.currency) : "—"}</td>
                      <td className="px-4 py-2.5">{g.delegation_allowed ? `allowed, depth ${g.max_remaining_depth}` : "not allowed"}</td>
                      <td className="px-4 py-2.5">
                        <Tag tone={g.status === "active" ? "accent" : "muted"}>{g.status}</Tag>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{formatDateTime(g.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </Tabs.Content>
        </Tabs.Root>
      )}
    </div>
  );
}

function TreeNode({
  grant,
  byParent,
  agentName,
  depth,
  onSelect,
  selectedId,
}: {
  grant: Grant;
  byParent: Map<string | null, Grant[]>;
  agentName: (id: string) => string;
  depth: number;
  onSelect: (g: Grant) => void;
  selectedId?: string;
}) {
  const children = byParent.get(grant.grant_id) ?? [];
  return (
    <li>
      <button
        onClick={() => onSelect(grant)}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-bg ${selectedId === grant.grant_id ? "bg-accent/10" : ""}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {children.length > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted" />}
        <span className={`h-1.5 w-1.5 rounded-full ${grant.status === "active" ? "bg-success" : "bg-muted"}`} />
        <span className="font-medium text-ink">{agentName(grant.subject_agent_id)}</span>
        <span className="text-xs text-muted">up to {formatMoney(grant.max_amount_minor, grant.currency)}</span>
        {grant.parent_grant_id === null && <Tag>root</Tag>}
      </button>
      {children.length > 0 && (
        <ul>
          {children.map((c) => (
            <TreeNode key={c.grant_id} grant={c} byParent={byParent} agentName={agentName} depth={depth + 1} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </li>
  );
}

function GrantDetailPanel({
  grant,
  agentName,
  canRevoke,
  onRevoked,
  orgId,
}: {
  grant: Grant;
  agentName: (id: string) => string;
  canRevoke: boolean;
  onRevoked: () => void;
  orgId: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Grant detail</h3>
        <Tag tone={grant.status === "active" ? "accent" : "muted"}>{grant.status}</Tag>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <Row label="Subject agent" value={agentName(grant.subject_agent_id)} />
        <Row label="Effective per-action limit" value={formatMoney(grant.max_amount_minor, grant.currency)} />
        <Row label="Root daily budget" value={grant.root_budget_limit_minor ? formatMoney(grant.root_budget_limit_minor, grant.currency) : "inherited / none set here"} />
        <Row label="Child budget cap" value={grant.child_budget_limit_minor ? formatMoney(grant.child_budget_limit_minor, grant.currency) : "—"} />
        <Row label="Delegation" value={grant.delegation_allowed ? `allowed, up to ${grant.max_remaining_depth} more hop(s)` : "not allowed"} />
        <Row label="Resources" value={grant.unrestricted_resources ? "unrestricted (admin-set)" : grant.allowed_resource_ids.join(", ") || "none"} />
        <Row label="Expires" value={formatDateTime(grant.expires_at)} />
        <Row label="Issuer" value={`${grant.issuer_type} · ${grant.issuer_id}`} />
      </dl>

      {canRevoke && grant.status === "active" && (
        <ConfirmDialog
          trigger={
            <Button variant="danger" className="mt-4">
              <ShieldOff className="h-4 w-4" /> Revoke grant
            </Button>
          }
          title="Revoke this grant?"
          description="This immediately invalidates the grant and every descendant that relies on it at next dispatch. Already-dispatched external actions cannot be undone."
          requireReason
          confirmLabel="Revoke grant"
          onConfirm={async (reason) => {
            await grantsApi.revoke(orgId, grant.grant_id, reason);
            onRevoked();
          }}
        />
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-muted">Raw grant JSON</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-sidebar p-3 text-[11px] text-slate-100 mono">
          {JSON.stringify(grant, null, 2)}
        </pre>
      </details>
    </Card>
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
