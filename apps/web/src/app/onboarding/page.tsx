"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Circle, Loader2, ShieldHalf } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useToast } from "@/context/toast-context";
import { agentsApi, actionsApi, grantsApi } from "@/lib/api";
import { errorMessage } from "@/lib/api-client";
import { useApi } from "@/hooks/useApi";
import { Button, Card, CopyButton, DecisionBadge, ExecutionBadge, Field, LoadingBlock, Mono, inputClass } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import type { AgentDetail } from "@/lib/types";

export default function OnboardingPage() {
  const { status, me } = useAuth();

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-2 px-6">
          <Link href="/" className="flex items-center gap-2">
            <ShieldHalf className="h-6 w-6 text-accent" />
            <span className="text-[15px] font-semibold tracking-tight text-ink">TrustRail</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        {status === "loading" && <LoadingBlock label="Checking your session…" />}
        {status === "anonymous" && <AuthStep />}
        {status === "authenticated" && me && <OrganizationAndChecklist />}
      </main>
    </div>
  );
}

function AuthStep() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="p-8">
      <h1 className="text-xl font-semibold text-ink">Welcome to TrustRail</h1>
      <p className="mt-1 text-sm text-muted">
        {mode === "register" ? "Create an account to set up your organization." : "Sign in to continue onboarding."}
      </p>

      <div className="mt-6 flex rounded-lg border border-border p-0.5 text-sm">
        <button
          className={`flex-1 rounded-md py-1.5 font-medium ${mode === "register" ? "bg-accent text-white" : "text-muted"}`}
          onClick={() => setMode("register")}
        >
          Create account
        </button>
        <button
          className={`flex-1 rounded-md py-1.5 font-medium ${mode === "login" ? "bg-accent text-white" : "text-muted"}`}
          onClick={() => setMode("login")}
        >
          Sign in
        </button>
      </div>

      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (mode === "register") await register(email, password);
            else await login(email, password);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" hint={mode === "register" ? "At least 10 characters." : undefined} htmlFor="password">
          <input
            id="password"
            type="password"
            required
            minLength={mode === "register" ? 10 : undefined}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={busy} className="justify-center">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "register" ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted">
        Local/demo mode only: open registration is disabled once TrustRail runs in production mode.
      </p>
    </Card>
  );
}

function OrganizationAndChecklist() {
  const { me, orgId, orgName, selectOrg, createOrganization } = useAuth();
  const toast = useToast();
  const [creatingOrg, setCreatingOrg] = useState((me?.memberships.length ?? 0) === 0);
  const [newOrgName, setNewOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  if (creatingOrg || !orgId) {
    return (
      <Card className="p-8">
        <h1 className="text-xl font-semibold text-ink">Create your organization</h1>
        <p className="mt-1 text-sm text-muted">
          Creating an organization makes you its Owner and automatically seeds a published default refund policy
          (EUR 100 automatic, up to EUR 500 requires approval) for the sandbox environment.
        </p>
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await createOrganization(newOrgName.trim());
              setCreatingOrg(false);
              toast.success("Organization created", "A default sandbox refund policy was published automatically.");
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Organization name" htmlFor="org-name">
            <input
              id="org-name"
              required
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              className={inputClass}
              placeholder="Northstar Commerce"
            />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create organization"}
            </Button>
            {me.memberships.length > 0 && (
              <Button type="button" variant="secondary" onClick={() => setCreatingOrg(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>

        {me.memberships.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Or continue with an existing organization</p>
            <div className="mt-2 flex flex-col gap-2">
              {me.memberships.map((m) => (
                <button
                  key={m.organization_id}
                  onClick={() => {
                    selectOrg(m.organization_id);
                    setCreatingOrg(false);
                  }}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-bg"
                >
                  <span>{m.organization_name}</span>
                  <span className="text-xs text-muted">{m.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Organization</p>
          <p className="text-lg font-semibold text-ink">{orgName}</p>
        </div>
        <div className="flex gap-2">
          {me.memberships.length > 1 && (
            <select
              className={inputClass + " w-auto"}
              value={orgId}
              onChange={(e) => selectOrg(e.target.value)}
            >
              {me.memberships.map((m) => (
                <option key={m.organization_id} value={m.organization_id}>
                  {m.organization_name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => setCreatingOrg(true)}>
            New organization
          </Button>
        </div>
      </div>
      <Checklist organizationId={orgId} userId={me.user_id} />
    </div>
  );
}

type StepStatus = "done" | "active" | "todo";

function StepShell({
  index,
  title,
  status,
  children,
}: {
  index: number;
  title: string;
  status: StepStatus;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            status === "done"
              ? "bg-success text-white"
              : status === "active"
                ? "bg-accent text-white"
                : "bg-bg text-muted border border-border"
          }`}
        >
          {status === "done" ? <Check className="h-4 w-4" /> : index}
        </div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {status === "done" && <span className="ml-auto text-xs font-medium text-success">Complete</span>}
      </div>
      {status !== "todo" && children && <div className="mt-4 pl-10">{children}</div>}
    </Card>
  );
}

function Checklist({ organizationId, userId }: { organizationId: string; userId: string }) {
  const toast = useToast();
  const agentsQuery = useApi(() => agentsApi.list(organizationId), [organizationId], { pollMs: 4000 });
  const grantsQuery = useApi(() => grantsApi.list(organizationId), [organizationId], { pollMs: 4000 });

  const [creatingAgent, setCreatingAgent] = useState(false);
  const [agentName, setAgentName] = useState("Support Agent");
  const [revealedSecret, setRevealedSecret] = useState<{ agentId: string; secret: string; prefix: string } | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const agents = agentsQuery.data?.agents ?? [];
  const grants = grantsQuery.data?.grants ?? [];
  const primaryAgent = agents.find((a) => a.agent_id === selectedAgentId) ?? agents[0] ?? null;

  const agentDetailQuery = useApi(
    () => (primaryAgent ? agentsApi.get(organizationId, primaryAgent.agent_id) : Promise.resolve(null as AgentDetail | null)),
    [organizationId, primaryAgent?.agent_id],
    { skip: !primaryAgent }
  );
  const hasActiveCredential = (agentDetailQuery.data?.credentials ?? []).some((c) => c.status === "active");

  const grantForAgent = primaryAgent ? grants.find((g) => g.subject_agent_id === primaryAgent.agent_id) : undefined;

  const step1Done = true; // organization exists by construction
  const step2Done = agents.length > 0;
  const step3Done = hasActiveCredential;
  const step4Done = Boolean(grantForAgent);

  const [actionResult, setActionResult] = useState<Awaited<ReturnType<typeof actionsApi.submit>> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resourceId, setResourceId] = useState("order_demo_101");
  const [amountEuro, setAmountEuro] = useState("80");
  const step5Done = actionResult !== null;

  return (
    <div className="flex flex-col gap-4">
      <StepShell index={1} title="Organization created" status="done">
        <p className="text-sm text-muted">
          A default sandbox policy for <Mono>refund.create</Mono> was published automatically: EUR 100 automatic,
          EUR 500 requires approval, EUR 1,000 daily budget.
        </p>
      </StepShell>

      <StepShell index={2} title="Register your first agent" status={step2Done ? "done" : "active"}>
        {step2Done ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {agents.map((a) => (
              <button
                key={a.agent_id}
                onClick={() => setSelectedAgentId(a.agent_id)}
                className={`rounded-full border px-3 py-1 ${primaryAgent?.agent_id === a.agent_id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}
              >
                {a.name}
              </button>
            ))}
          </div>
        ) : creatingAgent ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await agentsApi.create(organizationId, { name: agentName, description: "First-line customer support assistant", environment: "sandbox" });
                agentsQuery.refetch();
                toast.success("Agent registered");
              } catch (err) {
                toast.error("Could not register agent", errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Agent name" htmlFor="agent-name">
              <input id="agent-name" className={inputClass} value={agentName} onChange={(e) => setAgentName(e.target.value)} required />
            </Field>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Registering…" : "Register agent"}
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={() => setCreatingAgent(true)}>Register an agent</Button>
        )}
      </StepShell>

      <StepShell index={3} title="Reveal an API key" status={!step2Done ? "todo" : step3Done && !revealedSecret ? "done" : "active"}>
        {revealedSecret ? (
          <div className="rounded-lg border border-pending/30 bg-pending/5 p-3">
            <p className="text-xs font-medium text-pending">
              This secret is shown once and cannot be retrieved again. Copy it now.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Mono className="rounded bg-surface px-2 py-1 border border-border break-all">{revealedSecret.secret}</Mono>
              <CopyButton value={revealedSecret.secret} />
            </div>
          </div>
        ) : step3Done ? (
          <p className="text-sm text-muted">An active credential already exists for this agent. Rotate to reveal a new one if needed.</p>
        ) : (
          <p className="text-sm text-muted">Create a credential to authenticate this agent&rsquo;s requests.</p>
        )}
        {primaryAgent && (
          <Button
            className="mt-3"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await agentsApi.createCredential(organizationId, primaryAgent.agent_id);
                setRevealedSecret({ agentId: primaryAgent.agent_id, secret: result.secret, prefix: result.prefix });
                agentDetailQuery.refetch();
                toast.success("Credential created", "Shown once — copy it now.");
              } catch (err) {
                toast.error("Could not create credential", errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {step3Done ? "Rotate credential" : "Create credential"}
          </Button>
        )}
      </StepShell>

      <StepShell index={4} title="Issue an initial grant" status={!step3Done ? "todo" : step4Done ? "done" : "active"}>
        {step4Done ? (
          <p className="text-sm text-muted">
            Root grant issued: up to {formatMoney(grantForAgent!.max_amount_minor)} per action, EUR{" "}
            {(grantForAgent!.root_budget_limit_minor ?? 0) / 100} daily budget.
          </p>
        ) : (
          <Button
            disabled={busy || !primaryAgent}
            onClick={async () => {
              if (!primaryAgent) return;
              setBusy(true);
              try {
                await grantsApi.create(organizationId, {
                  environment: "sandbox",
                  principal_id: userId,
                  subject_agent_id: primaryAgent.agent_id,
                  parent_grant_id: null,
                  allowed_actions: ["refund.create"],
                  allowed_resource_ids: [],
                  unrestricted_resources: true,
                  allowed_connector_ids: ["merchant_sandbox"],
                  currency: "EUR",
                  max_amount_minor: 50_000,
                  root_budget_limit_minor: 100_000,
                  child_budget_limit_minor: null,
                  valid_from: null,
                  expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
                  delegation_allowed: true,
                  max_remaining_depth: 3,
                });
                grantsQuery.refetch();
                toast.success("Grant issued", "Up to EUR 500 per refund, EUR 1,000 daily budget.");
              } catch (err) {
                toast.error("Could not issue grant", errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Issue root grant (up to EUR 500, EUR 1,000/day)
          </Button>
        )}
      </StepShell>

      <StepShell index={5} title="Run your first action" status={!step4Done ? "todo" : step5Done ? "done" : "active"}>
        {!revealedSecret ? (
          <p className="text-sm text-muted">
            The agent&rsquo;s secret is only held in this browser tab&rsquo;s memory. Rotate a new credential above to run an
            action in this session.
          </p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setActionError(null);
              try {
                const result = await actionsApi.submit(revealedSecret.secret, `onboarding-${Date.now()}`, {
                  grant_id: grantForAgent!.grant_id,
                  connector_id: "merchant_sandbox",
                  action: "refund.create",
                  resource_id: resourceId,
                  arguments: { amount_minor: Math.round(Number(amountEuro) * 100), currency: "EUR", reason: "Onboarding test refund" },
                });
                setActionResult(result);
              } catch (err) {
                setActionError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Order / resource ID" htmlFor="resource-id">
                <input id="resource-id" className={inputClass} value={resourceId} onChange={(e) => setResourceId(e.target.value)} />
              </Field>
              <Field label="Amount (EUR)" htmlFor="amount">
                <input id="amount" type="number" min={1} step={1} className={inputClass} value={amountEuro} onChange={(e) => setAmountEuro(e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted">
              Note: freshly created organizations have no seeded merchant orders yet — run <Mono>pnpm demo:seed</Mono>{" "}
              for a ready-made org with sample orders, or seed your own via the merchant sandbox. Until then this may
              correctly deny with <Mono className="mx-1">STATE_UNAVAILABLE</Mono> if <Mono>{resourceId}</Mono> doesn&rsquo;t exist in the sandbox.
              That is fail-closed behavior working as intended, not a broken flow.
            </p>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Run action"}
              </Button>
            </div>
          </form>
        )}
        {actionError && <p className="mt-2 text-sm text-danger">{actionError}</p>}
        {actionResult && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <DecisionBadge decision={actionResult.decision} />
              <ExecutionBadge state={actionResult.execution_state} />
            </div>
            {actionResult.reason_codes.length > 0 && (
              <p className="text-xs text-muted">Reason codes: {actionResult.reason_codes.join(", ")}</p>
            )}
            <Link href={`/actions/${actionResult.action_id}`} className="text-sm font-medium text-accent hover:underline">
              View action detail →
            </Link>
          </div>
        )}
      </StepShell>

      {step5Done && (
        <Card className="border-success/30 bg-success/5 p-5">
          <p className="text-sm font-medium text-success">Onboarding complete.</p>
          <p className="mt-1 text-sm text-muted">You can continue to the full dashboard now.</p>
          <FinishButton />
        </Card>
      )}
    </div>
  );
}

function FinishButton() {
  const router = useRouter();
  return (
    <Button className="mt-3" onClick={() => router.push("/dashboard")}>
      Go to dashboard
    </Button>
  );
}
