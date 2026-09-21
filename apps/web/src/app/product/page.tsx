import { GitBranch, ShieldCheck, FileCheck2, Wallet, Eye, Blocks } from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

const PILLARS = [
  {
    icon: GitBranch,
    title: "Bounded delegation",
    body: "Owners and admins issue root grants; agents can delegate narrower child grants to other agents. Every child grant is a strict subset of its parent's actions, amounts, and expiry — attenuation is enforced server-side, never just advised.",
  },
  {
    icon: ShieldCheck,
    title: "Deterministic policy enforcement",
    body: "Versioned, typed policy bundles decide ALLOW, DENY, or REQUIRE_APPROVAL — never an LLM's judgment call. The gateway holds the only downstream connector credential, so an agent has no path around it.",
  },
  {
    icon: Wallet,
    title: "Shared budgets, real concurrency",
    body: "Root grants, child grants, and policy-level daily budgets are reserved atomically with deterministic lock ordering, tested under genuine concurrent load — not just documented as a limit.",
  },
  {
    icon: FileCheck2,
    title: "Signed, verifiable receipts",
    body: "Every decision and execution is recorded as an Ed25519-signed JWS receipt. Anyone holding a receipt — not just TrustRail's own dashboard — can verify signature validity, issuer trust, and recorded outcome independently.",
  },
  {
    icon: Eye,
    title: "Human approval, bound to one request",
    body: "An approval is bound to one exact action, principal, grant chain, and policy version. A stale policy invalidates it. Self-approval is rejected. Nothing about the flow is advisory.",
  },
  {
    icon: Blocks,
    title: "One API, every surface",
    body: "The dashboard, the TypeScript and Python SDKs, and the MCP adapter all call the same REST API — nothing the UI can do that an integration can't.",
  },
];

export default function ProductPage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingHeader active="/product" />

      <section className="bg-glow mx-auto max-w-4xl px-6 pb-14 pt-20 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Control what agents do. Prove what happened.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
          TrustRail sits between an AI agent and the systems it acts on — enforcing delegated limits before a request
          ever reaches a downstream connector, and recording a signed receipt of every decision and execution.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <div key={p.title} className="glass p-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-ink">{p.title}</h3>
              <p className="mt-2 text-sm text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="glass p-8">
          <h2 className="text-lg font-semibold text-ink">First use case: agent-issued refunds</h2>
          <p className="mt-3 text-sm text-muted">
            A customer-support agent that can issue refunds through a synthetic merchant sandbox, constrained by a
            delegated grant (amount cap, daily budget, approval threshold), producing signed receipts of every
            decision and execution. Money is not real in this version — this validates the control and evidence
            model before touching a live payment processor.
          </p>
          <h2 className="mt-6 text-lg font-semibold text-ink">What&rsquo;s actually verified</h2>
          <p className="mt-3 text-sm text-muted">
            Every capability above is covered by automated tests run against a real, non-mocked PostgreSQL instance
            and a real HTTP merchant sandbox, plus a live Docker Compose deployment and a passing CI run — not just
            described. This site makes no claims about customers, revenue, or third-party endorsement.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
