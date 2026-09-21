"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bot, Plus, Search } from "lucide-react";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { agentsApi } from "@/lib/api";
import { errorMessage } from "@/lib/api-client";
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingBlock, PageHeader, Tag, inputClass } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import * as Dialog from "@radix-ui/react-dialog";

export default function AgentsPage() {
  const { orgId, role } = useAuth();
  const toast = useToast();
  const agentsQuery = useApi(() => agentsApi.list(orgId!), [orgId], { skip: !orgId, pollMs: 6000 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled" | "revoked">("all");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const agents = agentsQuery.data?.agents ?? [];
    return agents.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.agent_id.includes(search)) return false;
      return true;
    });
  }, [agentsQuery.data, search, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Registered credentials that can request protected actions on this organization's behalf."
        actions={
          roleAtLeast(role, "operator") && (
            <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
              <Dialog.Trigger asChild>
                <Button>
                  <Plus className="h-4 w-4" /> Register agent
                </Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg">
                  <Dialog.Title className="text-base font-semibold text-ink">Register a new agent</Dialog.Title>
                  <CreateAgentForm
                    orgId={orgId!}
                    onDone={() => {
                      setCreateOpen(false);
                      agentsQuery.refetch();
                      toast.success("Agent registered");
                    }}
                  />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID"
            className={inputClass + " w-64 pl-9"}
            aria-label="Search agents"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={inputClass + " w-auto"}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>

      {agentsQuery.loading && !agentsQuery.data && <LoadingBlock />}
      {agentsQuery.error && <ErrorBanner message={agentsQuery.error} requestId={agentsQuery.requestId} onRetry={agentsQuery.refetch} />}
      {agentsQuery.data && filtered.length === 0 && (
        <EmptyState icon={<Bot className="h-6 w-6" />} title="No agents match" description="Try clearing filters, or register your first agent." />
      )}
      {agentsQuery.data && filtered.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Environment</th>
                <th className="px-4 py-2.5 font-medium">Last activity</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.agent_id} className="border-b border-border last:border-0 hover:bg-bg">
                  <td className="px-4 py-3">
                    <Link href={`/agents/${a.agent_id}`} className="font-medium text-ink hover:text-accent">
                      {a.name}
                    </Link>
                    <p className="mono text-xs text-muted">{a.agent_id}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Tag tone={a.status === "active" ? "accent" : "muted"}>{a.status}</Tag>
                  </td>
                  <td className="px-4 py-3 text-ink">{a.environment}</td>
                  <td className="px-4 py-3 text-muted">{formatRelative(a.last_activity_at)}</td>
                  <td className="px-4 py-3 text-muted">{formatRelative(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function CreateAgentForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await agentsApi.create(orgId, { name, description, environment: "sandbox" });
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Name" htmlFor="new-agent-name">
        <input id="new-agent-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Description" htmlFor="new-agent-desc">
        <input id="new-agent-desc" value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Registering…" : "Register agent"}
      </Button>
    </form>
  );
}
