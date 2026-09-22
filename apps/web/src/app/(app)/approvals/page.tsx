"use client";

import * as Tabs from "@radix-ui/react-tabs";
import Link from "next/link";
import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { approvalsApi } from "@/lib/api";
import { ApprovalBadge, Button, Card, EmptyState, ErrorBanner, LoadingBlock, Mono, PageHeader } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ApprovalListItem } from "@/lib/types";

export default function ApprovalsPage() {
  const { orgId, role, me } = useAuth();
  const toast = useToast();
  const canReview = roleAtLeast(role, "approver");

  const pendingQuery = useApi(() => approvalsApi.list(orgId!, "pending"), [orgId], { skip: !orgId || !canReview, pollMs: 4000 });
  const historyQuery = useApi(() => approvalsApi.list(orgId!), [orgId], { skip: !orgId || !canReview, pollMs: 8000 });

  if (!canReview) {
    return (
      <div>
        <PageHeader title="Approvals" />
        <EmptyState
          icon={<ClipboardCheck className="h-6 w-6" />}
          title="Approver role required"
          description="Your current role doesn't include approval rights. Ask an Owner or Admin to grant the Approver role in Settings."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Approvals" description="Bound to one exact action, principal, grant chain, and policy version. An expired approval requires a fresh request." />

      <Tabs.Root defaultValue="pending">
        <Tabs.List className="mb-4 inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          <Tabs.Trigger value="pending" className="rounded-md px-3 py-1.5 font-medium text-muted data-[state=active]:bg-accent data-[state=active]:text-white">
            Pending {pendingQuery.data ? `(${pendingQuery.data.approvals.length})` : ""}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" className="rounded-md px-3 py-1.5 font-medium text-muted data-[state=active]:bg-accent data-[state=active]:text-white">
            History
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="pending">
          {pendingQuery.loading && !pendingQuery.data && <LoadingBlock />}
          {pendingQuery.error && <ErrorBanner message={pendingQuery.error} requestId={pendingQuery.requestId} onRetry={pendingQuery.refetch} />}
          {pendingQuery.data && pendingQuery.data.approvals.length === 0 && (
            <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="No approvals pending" description="Refund requests above the automatic limit will appear here." />
          )}
          <div className="flex flex-col gap-3">
            {pendingQuery.data?.approvals.map((ap) => (
              <ApprovalCard
                key={ap.approval_id}
                approval={ap}
                orgId={orgId!}
                selfPrincipal={me?.user_id}
                onDecided={() => {
                  pendingQuery.refetch();
                  historyQuery.refetch();
                }}
              />
            ))}
          </div>
        </Tabs.Content>

        <Tabs.Content value="history">
          {historyQuery.loading && !historyQuery.data && <LoadingBlock />}
          {historyQuery.data && (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                    <th className="px-4 py-2.5 font-medium">Amount</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Reviewer</th>
                    <th className="px-4 py-2.5 font-medium">Decided</th>
                  </tr>
                </thead>
                <tbody>
                  {historyQuery.data.approvals.map((ap) => (
                    <tr key={ap.approval_id} className="border-b border-border last:border-0 hover:bg-bg">
                      <td className="px-4 py-2.5">
                        <Link href={`/actions/${ap.action_id}`} className="font-medium text-ink hover:text-accent">
                          <Mono>{ap.action?.resource_id ?? ap.action_id}</Mono>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">{formatMoney(ap.amount_minor, ap.currency)}</td>
                      <td className="px-4 py-2.5">
                        <ApprovalBadge status={ap.status} />
                      </td>
                      <td className="px-4 py-2.5 text-muted">{ap.reviewer_user_id ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted">{formatDateTime(ap.decided_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function ApprovalCard({
  approval,
  orgId,
  selfPrincipal,
  onDecided,
}: {
  approval: ApprovalListItem;
  orgId: string;
  selfPrincipal?: string;
  onDecided: () => void;
}) {
  const toast = useToast();
  const isSelf = approval.principal_id === selfPrincipal;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">
            {approval.action?.action ?? "action"} on <Mono>{approval.action?.resource_id ?? "unknown"}</Mono>
          </p>
          <p className="mt-1 text-2xl font-semibold text-ink">{formatMoney(approval.amount_minor, approval.currency)}</p>
        </div>
        <ApprovalBadge status={approval.status} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <MiniRow label="Actor agent" value={approval.action?.actor_agent_id ?? "—"} />
        <MiniRow label="Principal" value={approval.principal_id} />
        <MiniRow label="Triggering rule" value={approval.triggering_rule} />
        <MiniRow label="Expires" value={formatDateTime(approval.expires_at)} />
      </dl>
      <p className="mt-2 text-xs text-muted">
        Grant chain: {approval.grant_chain_ids.map((id) => <Mono key={id} className="mr-1">{id}</Mono>)}
      </p>

      {isSelf && (
        <p className="mt-3 rounded-md bg-pending/10 px-3 py-2 text-xs font-medium text-pending">
          You initiated this request as its principal — self-approval is rejected by the server.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <ConfirmDialog
          trigger={<Button variant="primary">Approve</Button>}
          title={`Approve this ${approval.action?.action ?? "request"}?`}
          description="This authorizes exactly this request, with its exact resource and policy version. It cannot be reused for a different payload."
          confirmLabel="Approve"
          danger={false}
          requireReason={false}
          onConfirm={async () => {
            try {
              await approvalsApi.approve(orgId, approval.approval_id, "");
              onDecided();
              toast.success("Approved", "Dispatch to the connector has been triggered.");
            } catch (err) {
              toast.error("Could not approve", err instanceof Error ? err.message : "");
              throw err;
            }
          }}
        />
        <ConfirmDialog
          trigger={
            <Button variant="secondary">Reject</Button>
          }
          title="Reject this request?"
          description="This permanently prevents dispatch for this action."
          confirmLabel="Reject"
          requireReason
          onConfirm={async (reason) => {
            try {
              await approvalsApi.reject(orgId, approval.approval_id, reason);
              onDecided();
              toast.success("Rejected");
            } catch (err) {
              toast.error("Could not reject", err instanceof Error ? err.message : "");
              throw err;
            }
          }}
        />
      </div>
    </Card>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mono break-all text-sm text-ink">{value}</dd>
    </div>
  );
}
