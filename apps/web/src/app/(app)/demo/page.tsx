"use client";

import { FlaskConical, PlayCircle } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { actionsApi, demoApi } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button, Card, DecisionBadge, EmptyState, ErrorBanner, ExecutionBadge, LoadingBlock, Mono, PageHeader } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";

const SCENARIOS = [
  { id: "eur80_auto_refund", title: "EUR 80 eligible refund", body: "Below the automatic limit. Expected: ALLOW, executed immediately, signed execution receipt." },
  { id: "eur350_approval", title: "EUR 350 refund via approval", body: "Above automatic, within approval limit. Expected: REQUIRE_APPROVAL, no dispatch until an independent reviewer approves." },
  { id: "eur700_denied", title: "EUR 700 refund", body: "Above the hard cap. Expected: DENY with AMOUNT_LIMIT, merchant never contacted." },
  { id: "prompt_injection_deny", title: "“Ignore the rules” prompt injection", body: "Free-text reason claims override authority. Expected: DENY — free text never changes policy evaluation." },
  { id: "child_cap_rejected", title: "Child grant requests EUR 900 cap", body: "Wider than its parent's EUR 500 ceiling. Expected: grant creation rejected with 422, no wider rights created." },
  { id: "root_revoked_denied", title: "Root revoked before child dispatch", body: "Ancestor revocation must block descendants at next dispatch, even though the child grant itself looks unchanged." },
  { id: "idempotent_replay", title: "Repeated request, same idempotency key", body: "Expected: exactly one sandbox refund; the second call returns the same action, not a new one." },
  { id: "idempotency_conflict", title: "Same key, changed amount", body: "Expected: HTTP 409 conflict — no second operation is created." },
  { id: "receipt_tamper_detected", title: "Receipt amount/hash edited after signing", body: "Expected: local verification fails signature_valid, distinct from issuer trust and recorded outcome." },
  { id: "concurrent_budget_limit", title: "Concurrent refunds against EUR 100 remaining", body: "Expected: at most EUR 100 commits across every concurrent attempt — the shared reservation ledger is authoritative." },
  { id: "connector_timeout_reconciled", title: "Merchant succeeds but the connection times out", body: "Expected: action state 'unknown', reconciled later to 'succeeded' with no duplicate refund and budget held throughout." },
  { id: "direct_merchant_write_rejected", title: "Agent attempts a direct merchant write", body: "Expected: network/auth rejection — the gateway holds the only downstream credential." },
];

export default function DemoLabPage() {
  const { orgId } = useAuth();
  const toast = useToast();
  const recent = useApi(() => actionsApi.list(orgId!, { limit: 10 }), [orgId], { skip: !orgId, pollMs: 6000 });
  const [runningId, setRunningId] = useState<string | null>(null);

  async function runScenario(id: string) {
    setRunningId(id);
    try {
      const result = await demoApi.run(orgId!, id);
      if (result.status === "succeeded") {
        toast.success("Scenario completed as expected");
      } else {
        toast.error("Scenario did not complete as expected", "See the run history below for the failing step.");
      }
      recent.refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        toast.info("Wrong organization", "The demo lab only runs inside the seeded Northstar Commerce organization — run `pnpm demo:seed` and sign in as owner@northstar.demo.");
      } else if (err instanceof ApiError && err.status === 403) {
        toast.info("Demo disabled", "Demo endpoints are disabled in production mode.");
      } else {
        toast.error("Could not start scenario", err instanceof Error ? err.message : "");
      }
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Demo lab"
        description="Deterministic, named scenarios from the product spec. All amounts and orders here are synthetic sandbox fixtures — no real money or customers are involved."
      />

      <div className="mb-6 rounded-xl border border-pending/30 bg-pending/5 p-4 text-sm text-pending">
        <strong>Note:</strong> these scenarios only run inside the seeded Northstar Commerce
        organization. Run <Mono>pnpm demo:seed</Mono> and sign in as{" "}
        <Mono>owner@northstar.demo</Mono> first, or use <Mono>pnpm demo:run &lt;scenario&gt;</Mono> from the CLI.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SCENARIOS.map((s) => (
          <Card key={s.id} className="flex flex-col p-5">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">{s.title}</h3>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{s.body}</p>
            <Button variant="secondary" className="mt-4 self-start" disabled={runningId === s.id} onClick={() => runScenario(s.id)}>
              <PlayCircle className="h-4 w-4" /> {runningId === s.id ? "Starting…" : "Run scenario"}
            </Button>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Real recorded activity (this organization)</h2>
        {recent.loading && !recent.data && <LoadingBlock />}
        {recent.error && <ErrorBanner message={recent.error} onRetry={recent.refetch} />}
        {recent.data && recent.data.actions.length === 0 && (
          <EmptyState title="No actions recorded yet" description="Run an action from Onboarding, or via curl using an agent credential, to see it appear here." />
        )}
        {recent.data && recent.data.actions.length > 0 && (
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
                {recent.data.actions.map((a) => (
                  <tr key={a.action_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">
                      <Mono>{a.resource_id}</Mono>
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
