import Link from "next/link";
import { ShieldHalf, GitBranch, ShieldCheck, FileCheck2 } from "lucide-react";
import { MarketingHeader, MarketingFooter, TrustTimelineCard } from "@/components/marketing";

const CODE_SNIPPET = `import { TrustRail } from "@trustrail/sdk";

const client = new TrustRail({
  baseUrl: process.env.TRUSTRAIL_API_URL,
  apiKey: process.env.TRUSTRAIL_AGENT_KEY, // scoped to one agent + environment
});

// The agent asks for a refund. TrustRail resolves the grant chain,
// evaluates the published policy, reserves budget, and only then
// dispatches to the merchant connector.
const action = await client.actions.execute({
  grantId: "grant_refund_child",
  connectorId: "merchant_sandbox",
  action: "refund.create",
  resourceId: "order_demo_101",
  arguments: { amount_minor: 8000, currency: "EUR", reason: "Customer return" },
  idempotencyKey: "demo-refund-001",
});

if (action.decision === "DENY") {
  // Blocked before the merchant ever saw the request.
} else if (action.executionState === "awaiting_approval") {
  // A human reviewer must approve this exact request within its TTL.
  const result = await client.actions.wait(action.id, { timeoutMs: 30_000 });
}`;

const CAPABILITIES = [
  {
    icon: GitBranch,
    title: "Bounded delegation",
    body: "Owners and admins issue root grants; agents can delegate narrower child grants to other agents. Every child is a strict subset of its parent's actions, amounts, and expiry — never wider.",
  },
  {
    icon: ShieldCheck,
    title: "Deterministic policy enforcement",
    body: "Versioned, typed policy bundles — not LLM judgment — decide ALLOW, DENY, or REQUIRE_APPROVAL. The gateway holds the only downstream credential, so an agent cannot bypass it.",
  },
  {
    icon: FileCheck2,
    title: "Signed, verifiable receipts",
    body: "Every decision and execution is recorded as an Ed25519-signed JWS receipt. Anyone holding a receipt can verify signature validity, issuer trust, and recorded outcome independently.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingHeader active="/" />

      <section className="bg-glow relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl gap-16 px-6 pb-24 pt-20 lg:grid-cols-2 lg:items-center lg:pt-28">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-accent shadow-sm">
              <ShieldHalf className="h-3.5 w-3.5" /> Built for agentic infrastructure
            </span>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-ink">
              Let agents act.
              <br />
              Keep control.
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted">
              Set action limits, control delegation, require approval when needed, and verify what happened.
            </p>
            <div className="mt-8 flex items-center gap-3">
              <Link
                href="/onboarding"
                className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Get started
              </Link>
              <Link
                href="/docs"
                className="rounded-full border border-border bg-surface px-6 py-3 text-sm font-semibold text-ink hover:bg-bg"
              >
                View docs
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted">
              Every amount shown here is synthetic sandbox money. No real funds move in this product today.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <TrustTimelineCard />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-3">
          {CAPABILITIES.map((cap) => (
            <div key={cap.title} className="glass p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <cap.icon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-ink">{cap.title}</h3>
              <p className="mt-2 text-sm text-muted">{cap.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="product-preview" className="mx-auto max-w-6xl px-6 pb-20 scroll-mt-20">
        <h2 className="text-center text-2xl font-semibold text-ink">What the team sees</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted">
          A real, working preview of the Overview page layout. Numbers shown here are illustrative placeholders — the
          running product always renders live counts from your own organization, and reports zero for a new one.
        </p>
        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-danger/40" />
            <span className="h-3 w-3 rounded-full bg-pending/40" />
            <span className="h-3 w-3 rounded-full bg-success/40" />
            <span className="ml-3 text-xs text-muted">trustrail.app/dashboard</span>
          </div>
          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-4">
            {[
              { label: "Total actions", value: "—", tone: "text-ink" },
              { label: "Allowed", value: "—", tone: "text-success" },
              { label: "Awaiting approval", value: "—", tone: "text-pending" },
              { label: "Denied", value: "—", tone: "text-danger" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{stat.label}</p>
                <p className={`mt-2 text-2xl font-semibold ${stat.tone}`}>{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-6">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Recent activity</p>
            <div className="space-y-2">
              {["refund.create · order_demo_101", "subscription.invite_user · account_demo_lea", "subscription.grant_credit · account_demo_lea"].map(
                (row) => (
                  <div key={row} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="mono text-ink">{row}</span>
                    <span className="text-xs text-muted">sign in to see real records</span>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-center text-2xl font-semibold text-ink">Integrate once</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted">
          The TypeScript SDK is under active development; this is the intended usage against the same{" "}
          <code className="mono">POST /v1/actions</code> contract the dashboard itself calls.
        </p>
        <pre className="mt-8 overflow-x-auto rounded-xl border border-border bg-sidebar p-5 text-[13px] leading-relaxed text-slate-100">
          <code className="mono">{CODE_SNIPPET}</code>
        </pre>
      </section>

      <MarketingFooter />
    </div>
  );
}
