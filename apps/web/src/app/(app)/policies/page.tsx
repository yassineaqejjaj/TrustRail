"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useMemo, useState } from "react";
import { FlaskConical, ShieldCheck } from "lucide-react";
import type { PolicyBundle } from "@trustrail/contracts";
import { DEFAULT_POLICY_BUNDLE } from "@/lib/constants";
import { useAuth, roleAtLeast } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { useApi } from "@/hooks/useApi";
import { grantsApi, policiesApi, simulationsApi } from "@/lib/api";
import { errorMessage } from "@/lib/api-client";
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingBlock, Mono, PageHeader, Tag, inputClass } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { PolicyBundleWithVersions, SimulationResult } from "@/lib/types";

export default function PoliciesPage() {
  const { orgId, role } = useAuth();
  const toast = useToast();
  const policiesQuery = useApi(() => policiesApi.list(orgId!), [orgId], { skip: !orgId, pollMs: 8000 });
  const canEdit = roleAtLeast(role, "admin");

  const bundle = policiesQuery.data?.policies[0] ?? null;

  return (
    <div>
      <PageHeader
        title="Policies"
        description="Typed, versioned policy for refund.create in the sandbox environment. Never executable code — a form editor and JSON view describe the same bundle."
      />

      {policiesQuery.loading && !policiesQuery.data && <LoadingBlock />}
      {policiesQuery.error && <ErrorBanner message={policiesQuery.error} requestId={policiesQuery.requestId} onRetry={policiesQuery.refetch} />}

      {policiesQuery.data && !bundle && (
        <CreateDraftCard orgId={orgId!} canEdit={canEdit} onCreated={() => policiesQuery.refetch()} />
      )}

      {bundle && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <PolicyEditor bundle={bundle} orgId={orgId!} canEdit={canEdit} onChanged={policiesQuery.refetch} />
            <VersionHistory bundle={bundle} />
          </div>
          <div>
            <SimulatePanel orgId={orgId!} bundleAction={bundle.action} />
          </div>
        </div>
      )}
    </div>
  );
}

function CreateDraftCard({ orgId, canEdit, onCreated }: { orgId: string; canEdit: boolean; onCreated: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <EmptyState
      icon={<ShieldCheck className="h-6 w-6" />}
      title="No policy bundle yet"
      description="This shouldn't normally happen — organization creation seeds a default policy automatically. Create one manually if needed."
      action={
        canEdit && (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await policiesApi.createDraft(orgId, "sandbox", DEFAULT_POLICY_BUNDLE);
                onCreated();
                toast.success("Policy draft created");
              } catch (err) {
                toast.error("Could not create policy", errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create default policy draft
          </Button>
        )
      }
    />
  );
}

function bundleField<K extends keyof PolicyBundle>(bundle: PolicyBundle, key: K): PolicyBundle[K] {
  return bundle[key];
}

function PolicyEditor({
  bundle,
  orgId,
  canEdit,
  onChanged,
}: {
  bundle: PolicyBundleWithVersions;
  orgId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const activeVersion = bundle.versions.find((v) => v.version_id === bundle.active_version_id) ?? null;
  const latestDraft = [...bundle.versions].sort((a, b) => b.version_number - a.version_number)[0] ?? null;
  const [draft, setDraft] = useState<PolicyBundle>(activeVersion?.bundle ?? latestDraft?.bundle ?? DEFAULT_POLICY_BUNDLE);
  const [jsonText, setJsonText] = useState(JSON.stringify(draft, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);

  const syncFromForm = (next: PolicyBundle) => {
    setDraft(next);
    setJsonText(JSON.stringify(next, null, 2));
  };

  const diffFromActive = useMemo(() => {
    if (!activeVersion) return null;
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    for (const key of Object.keys(draft) as (keyof PolicyBundle)[]) {
      if (JSON.stringify(activeVersion.bundle[key]) !== JSON.stringify(draft[key])) {
        changes.push({ field: key, from: activeVersion.bundle[key], to: draft[key] });
      }
    }
    return changes;
  }, [activeVersion, draft]);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Refund policy · sandbox</h2>
          <p className="text-xs text-muted">
            Revision {bundle.revision} · active version{" "}
            <Mono>{bundle.active_version_id ?? "none"}</Mono>
          </p>
        </div>
        <Tag tone="accent">{activeVersion ? "published" : "no active version"}</Tag>
      </div>

      <Tabs.Root defaultValue="form">
        <Tabs.List className="mb-4 inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          <Tabs.Trigger value="form" className="rounded-md px-3 py-1.5 font-medium text-muted data-[state=active]:bg-accent data-[state=active]:text-white">
            Form
          </Tabs.Trigger>
          <Tabs.Trigger value="json" className="rounded-md px-3 py-1.5 font-medium text-muted data-[state=active]:bg-accent data-[state=active]:text-white">
            JSON
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="form">
          <fieldset disabled={!canEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Automatic limit (EUR)" hint="Up to and including this amount: automatic ALLOW.">
              <input
                type="number"
                className={inputClass}
                value={draft.automatic_limit_minor / 100}
                onChange={(e) => syncFromForm({ ...draft, automatic_limit_minor: Math.round(Number(e.target.value) * 100) })}
              />
            </Field>
            <Field label="Approval limit (EUR)" hint="Above automatic, up to this amount: requires approval.">
              <input
                type="number"
                className={inputClass}
                value={draft.approval_limit_minor / 100}
                onChange={(e) => syncFromForm({ ...draft, approval_limit_minor: Math.round(Number(e.target.value) * 100) })}
              />
            </Field>
            <Field label="Root daily limit (EUR)" hint="Shared budget across the whole delegation tree, per UTC day.">
              <input
                type="number"
                className={inputClass}
                value={draft.root_daily_limit_minor / 100}
                onChange={(e) => syncFromForm({ ...draft, root_daily_limit_minor: Math.round(Number(e.target.value) * 100) })}
              />
            </Field>
            <Field label="Approval TTL (seconds)">
              <input
                type="number"
                className={inputClass}
                value={draft.approval_ttl_seconds}
                onChange={(e) => syncFromForm({ ...draft, approval_ttl_seconds: Number(e.target.value) })}
              />
            </Field>
            <Field label="Max order age (days)">
              <input
                type="number"
                className={inputClass}
                value={draft.max_order_age_days}
                onChange={(e) => syncFromForm({ ...draft, max_order_age_days: Number(e.target.value) })}
              />
            </Field>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={draft.require_original_payment_destination}
                  onChange={(e) => syncFromForm({ ...draft, require_original_payment_destination: e.target.checked })}
                />
                Require original payment destination
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={draft.require_order_ownership}
                  onChange={(e) => syncFromForm({ ...draft, require_order_ownership: e.target.checked })}
                />
                Require order ownership
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={draft.deny_if_payment_disputed}
                  onChange={(e) => syncFromForm({ ...draft, deny_if_payment_disputed: e.target.checked })}
                />
                Deny if payment disputed
              </label>
            </div>
          </fieldset>
        </Tabs.Content>

        <Tabs.Content value="json">
          <textarea
            disabled={!canEdit}
            className={inputClass + " h-72 mono"}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              try {
                const parsed = JSON.parse(e.target.value);
                setDraft(parsed);
                setJsonError(null);
              } catch {
                setJsonError("Invalid JSON — not applied until this parses.");
              }
            }}
          />
          {jsonError && <p className="mt-1 text-xs text-danger">{jsonError}</p>}
        </Tabs.Content>
      </Tabs.Root>

      {canEdit && (
        <div className="mt-4 border-t border-border pt-4">
          {diffFromActive && diffFromActive.length > 0 && (
            <div className="mb-3 rounded-lg border border-pending/30 bg-pending/5 p-3 text-xs">
              <p className="mb-1 font-medium text-pending">Changes vs. currently published version (affects: sandbox)</p>
              <ul className="space-y-0.5">
                {diffFromActive.map((c) => (
                  <li key={c.field} className="mono">
                    {c.field}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label="Change reason" hint="Required to save a new version.">
            <input className={inputClass} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="e.g. Raise automatic limit after 30 days of clean data" />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              disabled={busy || !changeReason.trim() || Boolean(jsonError)}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await policiesApi.addVersion(orgId, bundle.policy_bundle_id, draft, changeReason.trim());
                  setPendingVersionId(result.version_id);
                  onChanged();
                  toast.success("Draft version saved", "Publish it below to make it active.");
                } catch (err) {
                  toast.error("Could not save version", errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save as new draft version
            </Button>
            {pendingVersionId && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await policiesApi.publish(orgId, bundle.policy_bundle_id, pendingVersionId, bundle.revision, changeReason.trim());
                    setPendingVersionId(null);
                    onChanged();
                    toast.success("Policy published", "Live for the sandbox environment.");
                  } catch (err) {
                    toast.error("Could not publish", errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Publish version to sandbox
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function VersionHistory({ bundle }: { bundle: PolicyBundleWithVersions }) {
  const sorted = [...bundle.versions].sort((a, b) => b.version_number - a.version_number);
  return (
    <Card className="mt-4 p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">Version history</h2>
      <ul className="flex flex-col gap-2">
        {sorted.map((v) => (
          <li key={v.version_id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
            <div>
              <p className="font-medium text-ink">
                v{v.version_number} · {v.change_reason || "no reason given"}
              </p>
              <p className="text-xs text-muted">
                Created {formatDateTime(v.created_at)} {v.published_at ? `· published ${formatDateTime(v.published_at)}` : ""}
              </p>
            </div>
            <Tag tone={v.status === "published" ? "accent" : "muted"}>{v.status}</Tag>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SimulatePanel({ orgId, bundleAction }: { orgId: string; bundleAction: string }) {
  const grantsQuery = useApi(() => grantsApi.list(orgId), [orgId]);
  const [grantId, setGrantId] = useState("");
  const [resourceId, setResourceId] = useState("order_demo_101");
  const [amountEuro, setAmountEuro] = useState("80");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grants = (grantsQuery.data?.grants ?? []).filter((g) => g.allowed_actions.includes(bundleAction as never) && g.status === "active");

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-ink">Simulate</h2>
      </div>
      <p className="mb-3 text-xs text-muted">Predicts the outcome only. No reservation or write occurs, and this is not a transferable authorization.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const sim = await simulationsApi.run(orgId, {
              grant_id: grantId,
              connector_id: "merchant_sandbox",
              action: "refund.create",
              resource_id: resourceId,
              arguments: { amount_minor: Math.round(Number(amountEuro) * 100), currency: "EUR", reason: "simulation" },
            });
            setResult(sim);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Grant" htmlFor="sim-grant">
          <select id="sim-grant" required className={inputClass} value={grantId} onChange={(e) => setGrantId(e.target.value)}>
            <option value="" disabled>
              Select a grant
            </option>
            {grants.map((g) => (
              <option key={g.grant_id} value={g.grant_id}>
                {g.grant_id} (up to {formatMoney(g.max_amount_minor, g.currency)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Resource ID" htmlFor="sim-resource">
          <input id="sim-resource" className={inputClass} value={resourceId} onChange={(e) => setResourceId(e.target.value)} />
        </Field>
        <Field label="Amount (EUR)" htmlFor="sim-amount">
          <input id="sim-amount" type="number" className={inputClass} value={amountEuro} onChange={(e) => setAmountEuro(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy || !grantId}>
          {busy ? "Simulating…" : "Run simulation"}
        </Button>
      </form>

      {result && (
        <div className="mt-4 rounded-lg border border-border p-3 text-sm">
          <p className="font-semibold text-ink">{result.decision}</p>
          <p className="mt-1 text-xs text-muted">{result.explanation}</p>
          {result.reason_codes.length > 0 && <p className="mt-1 text-xs text-muted">Reasons: {result.reason_codes.join(", ")}</p>}
          {result.matched_checks.length > 0 && <p className="mt-1 text-xs text-muted">Matched checks: {result.matched_checks.join(", ")}</p>}
          <p className="mt-2 text-xs italic text-pending">{result.note}</p>
        </div>
      )}
    </Card>
  );
}
