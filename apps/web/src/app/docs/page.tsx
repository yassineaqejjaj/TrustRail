import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

const SETUP_SNIPPET = `pnpm install --frozen-lockfile
pnpm setup:local     # local Postgres, roles, migrations, signing key, .env
pnpm dev             # api :4000, merchant sandbox :4100, web :3000
pnpm demo:seed       # seeds a demo org, agents, and grants`;

const TS_SNIPPET = `import { TrustRail } from "@trustrail/sdk";

const client = new TrustRail({
  baseUrl: "http://localhost:4000",
  apiKey: process.env.TRUSTRAIL_API_KEY!, // scoped to one agent + environment
});

const action = await client.actions.execute({
  grantId: process.env.TRUSTRAIL_GRANT_ID!,
  connectorId: "merchant_sandbox",
  action: "refund.create",
  resourceId: "order_demo_101",
  arguments: { amount_minor: 8000, currency: "EUR", reason: "Return" },
  idempotencyKey: "demo-refund-001",
});

switch (action.decision) {
  case "DENY":
    console.log("denied:", action.reason_codes);
    break;
  case "REQUIRE_APPROVAL": {
    const result = await client.actions.wait(action.action_id, { timeoutMs: 60_000 });
    console.log("resolved to:", result.decision, result.execution_state);
    break;
  }
  case "ALLOW": {
    const result = await client.actions.wait(action.action_id, { timeoutMs: 30_000 });
    console.log(result.execution_state === "succeeded" ? "refunded" : result.execution_state);
  }
}`;

const RESOURCES = [
  { title: "API reference", body: "Every route, request, and response shape.", path: "docs/API.md" },
  { title: "SDK quickstart", body: "TypeScript and Python, side by side.", path: "docs/SDK_QUICKSTART.md" },
  { title: "MCP setup", body: "Wire the MCP adapter into a real MCP client.", path: "docs/MCP_SETUP.md" },
  { title: "Architecture", body: "How the gateway, policy engine, and connectors fit together.", path: "docs/ARCHITECTURE.md" },
  { title: "Threat model", body: "What this does — and does not — protect against.", path: "docs/THREAT_MODEL.md" },
  { title: "Operations", body: "Runbook: backups, key rotation, restore.", path: "docs/OPERATIONS.md" },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingHeader active="/docs" />

      <section className="bg-glow mx-auto max-w-4xl px-6 pb-10 pt-20">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink">Docs</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          TrustRail is self-hosted — there is no shared public API to call yet. Run the stack locally with the
          commands below, then integrate against your own running instance.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-12">
        <div className="glass p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">1. Run it locally</h2>
          <pre className="mono mt-4 overflow-x-auto rounded-xl bg-sidebar p-5 text-[13px] leading-relaxed text-slate-100">
            {SETUP_SNIPPET}
          </pre>
          <p className="mt-3 text-sm text-muted">
            No Docker required for local dev — a real Postgres instance is provisioned automatically. A Docker
            Compose deployment path is also available and verified end to end.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className="glass p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">2. Call it from an agent</h2>
          <pre className="mono mt-4 overflow-x-auto rounded-xl bg-sidebar p-5 text-[13px] leading-relaxed text-slate-100">
            {TS_SNIPPET}
          </pre>
          <p className="mt-3 text-sm text-muted">
            A Python SDK and an MCP stdio adapter expose the same <code className="mono">actions.execute</code> /{" "}
            <code className="mono">actions.wait</code> / <code className="mono">receipts.verify</code> surface.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <h2 className="text-lg font-semibold text-ink">Reference docs</h2>
        <p className="mt-2 text-sm text-muted">
          These live as Markdown files in the repository under <code className="mono">docs/</code> — open them
          directly from a checkout.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {RESOURCES.map((r) => (
            <div key={r.path} className="glass p-5">
              <h3 className="text-sm font-semibold text-ink">{r.title}</h3>
              <p className="mt-1 text-sm text-muted">{r.body}</p>
              <p className="mono mt-3 text-xs text-accent">{r.path}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-muted">
          Already have it running and signed in?{" "}
          <Link href="/developers" className="font-medium text-accent hover:underline">
            Open the in-app Developers page
          </Link>{" "}
          for copyable samples using your own sandbox credentials.
        </p>
      </section>

      <MarketingFooter />
    </div>
  );
}
