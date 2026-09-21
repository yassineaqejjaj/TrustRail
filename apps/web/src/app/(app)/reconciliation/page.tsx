"use client";

import Link from "next/link";
import { AlertOctagon } from "lucide-react";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { reconciliationApi } from "@/lib/api";
import { Button, Card, EmptyState, ErrorBanner, LoadingBlock, Mono, PageHeader } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ReconciliationItem } from "@/lib/types";

export default function ReconciliationPage() {
  const { orgId, role } = useAuth();
  const canReview = roleAtLeast(role, "approver");

  const query = useApi(() => reconciliationApi.list(orgId!), [orgId], { skip: !orgId || !canReview, pollMs: 5000 });

  if (!canReview) {
    return (
      <div>
        <PageHeader title="Reconciliation" />
        <EmptyState
          icon={<AlertOctagon className="h-6 w-6" />}
          title="Approver role required"
          description="Your current role doesn't include reconciliation rights. Ask an Owner or Admin to grant the Approver role in Settings."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        description="Actions the connector never gave a definitive answer for. The worker retries automatically with backoff; once it gives up, resolve the real outcome here after checking with the merchant directly."
      />

      {query.loading && !query.data && <LoadingBlock />}
      {query.error && <ErrorBanner message={query.error} requestId={query.requestId} onRetry={query.refetch} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          icon={<AlertOctagon className="h-6 w-6" />}
          title="Nothing to reconcile"
          description="Every action has a definitive outcome. This page only fills up when the connector times out and stays ambiguous."
        />
      )}
      <div className="flex flex-col gap-3">
        {query.data?.items.map((item) => (
          <ReconciliationCard key={item.action_id} item={item} orgId={orgId!} onResolved={() => query.refetch()} />
        ))}
      </div>
    </div>
  );
}

function ReconciliationCard({ item, orgId, onResolved }: { item: ReconciliationItem; orgId: string; onResolved: () => void }) {
  const toast = useToast();

  async function resolve(outcome: "succeeded" | "failed", note: string) {
    try {
      await reconciliationApi.resolve(orgId, item.action_id, outcome, note);
      onResolved();
      toast.success(outcome === "succeeded" ? "Marked succeeded" : "Marked failed", "The budget and receipt trail have been updated to match.");
    } catch (err) {
      toast.error("Could not resolve", err instanceof Error ? err.message : "");
      throw err;
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">
            {item.action} on <Mono>{item.resource_id}</Mono>
          </p>
          <p className="mt-1 text-2xl font-semibold text-ink">{formatMoney(item.amount_minor, item.currency)}</p>
        </div>
        {item.needs_manual_review ? (
          <span className="inline-flex items-center rounded-full bg-danger/10 px-2.5 py-[3px] text-[11.5px] font-semibold text-danger">
            Needs manual review
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-pending/10 px-2.5 py-[3px] text-[11.5px] font-semibold text-pending">
            Still auto-retrying ({item.attempt_count})
          </span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <MiniRow label="Actor agent" value={item.actor_agent_id} />
        <MiniRow label="Attempts" value={String(item.attempt_count)} />
        <MiniRow label="Last update" value={formatDateTime(item.updated_at)} />
        <MiniRow label="First seen" value={formatDateTime(item.created_at)} />
      </dl>
      {item.last_error && <p className="mt-2 text-xs text-muted">{item.last_error}</p>}
      <p className="mt-3 text-xs text-muted">
        <Link href={`/actions/${item.action_id}`} className="text-accent hover:underline">
          View action detail →
        </Link>
      </p>

      <div className="mt-4 flex gap-2">
        <ConfirmDialog
          trigger={<Button variant="primary">Mark succeeded</Button>}
          title="Mark this refund as succeeded?"
          description="Only do this after confirming directly with the merchant that the refund actually landed. This commits the reserved budget and issues a signed execution receipt."
          confirmLabel="Mark succeeded"
          danger={false}
          requireReason
          onConfirm={(note) => resolve("succeeded", note)}
        />
        <ConfirmDialog
          trigger={<Button variant="secondary">Mark failed</Button>}
          title="Mark this refund as failed?"
          description="Only do this after confirming directly with the merchant that the refund never happened. This releases the reserved budget back to the grant."
          confirmLabel="Mark failed"
          requireReason
          onConfirm={(note) => resolve("failed", note)}
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
