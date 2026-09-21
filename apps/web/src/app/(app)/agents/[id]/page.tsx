"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { KeyRound, ShieldOff } from "lucide-react";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { agentsApi, actionsApi, grantsApi } from "@/lib/api";
import { errorMessage } from "@/lib/api-client";
import { Button, Card, CopyButton, DecisionBadge, EmptyState, ErrorBanner, ExecutionBadge, LoadingBlock, Mono, PageHeader, Tag } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDateTime, formatMoney } from "@/lib/format";

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const { orgId, role } = useAuth();
  const toast = useToast();
  const [revealed, setRevealed] = useState<{ secret: string; prefix: string } | null>(null);

  const agentQuery = useApi(() => agentsApi.get(orgId!, params.id), [orgId, params.id], { skip: !orgId, pollMs: 6000 });
  const grantsQuery = useApi(() => grantsApi.list(orgId!), [orgId], { skip: !orgId });
  const actionsQuery = useApi(() => actionsApi.list(orgId!, { agent_id: params.id, limit: 10 }), [orgId, params.id], { skip: !orgId });

  if (agentQuery.loading && !agentQuery.data) return <LoadingBlock label="Loading agent…" />;
  if (agentQuery.error) return <ErrorBanner message={agentQuery.error} requestId={agentQuery.requestId} onRetry={agentQuery.refetch} />;
  if (!agentQuery.data) return null;

  const agent = agentQuery.data;
  const grants = (grantsQuery.data?.grants ?? []).filter((g) => g.subject_agent_id === agent.agent_id);
  const canManage = roleAtLeast(role, "operator");

  return (
    <div>
      <PageHeader
        title={agent.name}
        description={agent.description || "No description provided."}
        actions={
          canManage && agent.status === "active" && (
            <ConfirmDialog
              trigger={<Button variant="danger">Disable agent</Button>}
              title="Disable this agent?"
              description="The agent's credentials remain valid unless separately revoked, but it will no longer be treated as active for new grants."
              confirmLabel="Disable agent"
              onConfirm={async () => {
                await agentsApi.update(orgId!, agent.agent_id, { status: "disabled" });
                agentQuery.refetch();
                toast.success("Agent disabled");
              }}
            />
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <InfoTile label="Status" value={<Tag tone={agent.status === "active" ? "accent" : "muted"}>{agent.status}</Tag>} />
        <InfoTile label="Environment" value={agent.environment} />
        <InfoTile label="Last activity" value={formatDateTime(agent.last_activity_at)} />
        <InfoTile label="Created" value={formatDateTime(agent.created_at)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Credential history</h2>
            {canManage && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    const result = await agentsApi.createCredential(orgId!, agent.agent_id);
                    setRevealed({ secret: result.secret, prefix: result.prefix });
                    agentQuery.refetch();
                  } catch (err) {
                    toast.error("Could not create credential", errorMessage(err));
                  }
                }}
              >
                <KeyRound className="h-3.5 w-3.5" /> New credential
              </Button>
            )}
          </div>

          {revealed && (
            <div className="mb-3 rounded-lg border border-pending/30 bg-pending/5 p-3">
              <p className="text-xs font-medium text-pending">Shown once — copy it now. It cannot be retrieved again.</p>
              <div className="mt-2 flex items-center gap-2">
                <Mono className="break-all rounded border border-border bg-surface px-2 py-1">{revealed.secret}</Mono>
                <CopyButton value={revealed.secret} />
              </div>
            </div>
          )}

          {agent.credentials.length === 0 ? (
            <EmptyState icon={<KeyRound className="h-6 w-6" />} title="No credentials yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {agent.credentials.map((c) => (
                <li key={c.credential_id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <div>
                    <Mono>{c.prefix}••••••••</Mono>
                    <p className="mt-0.5 text-xs text-muted">
                      Created {formatDateTime(c.created_at)}
                      {c.revoked_at ? ` · revoked ${formatDateTime(c.revoked_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tag tone={c.status === "active" ? "accent" : "muted"}>{c.status}</Tag>
                    {canManage && c.status === "active" && (
                      <ConfirmDialog
                        trigger={
                          <button className="rounded-md p-1.5 text-danger hover:bg-danger/10" aria-label="Revoke credential">
                            <ShieldOff className="h-4 w-4" />
                          </button>
                        }
                        title="Revoke this credential?"
                        description="Any request authenticated with this secret will be rejected immediately."
                        confirmLabel="Revoke credential"
                        onConfirm={async () => {
                          await agentsApi.revokeCredential(orgId!, c.credential_id);
                          agentQuery.refetch();
                          toast.success("Credential revoked");
                        }}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Grants for this agent</h2>
          {grants.length === 0 ? (
            <EmptyState title="No grants issued to this agent yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {grants.map((g) => (
                <li key={g.grant_id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <Mono>{g.grant_id}</Mono>
                    <Tag tone={g.status === "active" ? "accent" : "muted"}>{g.status}</Tag>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Up to {formatMoney(g.max_amount_minor, g.currency)} per action
                    {g.root_budget_limit_minor ? ` · ${formatMoney(g.root_budget_limit_minor, g.currency)} root daily budget` : ""}
                    {g.parent_grant_id ? " · child grant" : " · root grant"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link href="/delegations" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
            View in delegations tree →
          </Link>
        </Card>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-ink">Recent actions</h2>
        {actionsQuery.loading && !actionsQuery.data && <LoadingBlock />}
        {actionsQuery.data && actionsQuery.data.actions.length === 0 && <EmptyState title="No actions from this agent yet" />}
        {actionsQuery.data && actionsQuery.data.actions.length > 0 && (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Resource</th>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Decision</th>
                  <th className="px-4 py-2.5 font-medium">Execution</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {actionsQuery.data.actions.map((a) => (
                  <tr key={a.action_id} className="border-b border-border last:border-0 hover:bg-bg">
                    <td className="px-4 py-2.5">
                      <Link href={`/actions/${a.action_id}`} className="font-medium text-ink hover:text-accent">
                        <Mono>{a.resource_id}</Mono>
                      </Link>
                    </td>
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
        )}
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1.5 text-sm font-medium text-ink">{value}</div>
    </Card>
  );
}
