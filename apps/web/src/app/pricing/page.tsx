import Link from "next/link";
import { Check } from "lucide-react";
import clsx from "clsx";
import { MarketingHeader, MarketingFooter } from "@/components/marketing";

type Plan = {
  name: string;
  price: string;
  period?: string;
  quota: string;
  features: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Developer",
    price: "€0",
    quota: "1,000 protected actions / month",
    features: ["Sandbox environment", "TypeScript & Python SDKs, MCP adapter", "Signed receipts", "Baseline policies"],
    cta: { label: "Get started", href: "/onboarding" },
  },
  {
    name: "Team",
    price: "€199",
    period: "/month",
    quota: "10,000 protected actions / month",
    features: ["Real (non-sandbox) environments", "Custom policies & delegation", "Human approvals", "Action history"],
    cta: { label: "Get started", href: "/onboarding" },
    highlight: true,
  },
  {
    name: "Scale",
    price: "€799",
    period: "/month",
    quota: "100,000 protected actions / month",
    features: ["Higher volume, same controls", "Advanced policy controls", "Data exports", "Priority support"],
    cta: { label: "Get started", href: "/onboarding" },
  },
  {
    name: "Enterprise",
    price: "Custom",
    quota: "Negotiated volume",
    features: ["SSO (once available)", "SLA", "Dedicated deployment", "Specific security requirements"],
    cta: { label: "Talk to us", href: "/onboarding" },
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-bg">
      <MarketingHeader active="/pricing" />

      <section className="bg-glow mx-auto max-w-3xl px-6 pb-12 pt-20 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Simple, usage-based pricing.</h1>
        <p className="mt-5 text-lg text-muted">
          A platform subscription covers the controls, policies, and receipts. Beyond your plan&rsquo;s included
          volume, you pay only for the protected actions your agents actually run.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={clsx("glass flex flex-col p-6", plan.highlight && "ring-2 ring-accent")}
            >
              {plan.highlight && (
                <span className="mb-3 inline-flex w-fit items-center rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Most popular
                </span>
              )}
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{plan.name}</h2>
              <p className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-ink">{plan.price}</span>
                {plan.period && <span className="text-sm text-muted">{plan.period}</span>}
              </p>
              <p className="mt-1 text-sm text-muted">{plan.quota}</p>
              <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-ink">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.cta.href}
                className={clsx(
                  "mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold",
                  plan.highlight ? "bg-accent text-white hover:bg-accent-hover" : "border border-border text-ink hover:bg-surface"
                )}
              >
                {plan.cta.label}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Indicative pricing for an in-development product — refined as we work with early customers, not yet
          tested against a real buyer at these exact numbers.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-16">
        <div className="glass p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Beyond your included quota</h2>
          <p className="mt-3 text-2xl font-bold text-ink">
            Monthly price = plan subscription + protected actions beyond quota
          </p>
          <p className="mt-3 text-sm text-muted">
            Overage is billed per protected action, at a rate that decreases with volume — for example €0.01 per
            action, dropping to €0.005 at high volume. The exact breakpoints are set per plan and negotiated
            directly for Enterprise.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="text-lg font-semibold text-ink">What counts as a protected action</h2>
        <p className="mt-3 text-sm text-muted">
          The billable unit is one distinct business request submitted through TrustRail&rsquo;s gateway — a call
          like <code className="mono">refund.create</code>. It does not include internal calls, status reads (
          <code className="mono">GET</code> requests), or technical retries.
        </p>
        <p className="mt-3 text-sm text-muted">
          An action submitted with the same <code className="mono">Idempotency-Key</code> always resolves to the
          same underlying record rather than a new one — the gateway already enforces this today, so a replay is
          never billed twice.
        </p>
      </section>

      <MarketingFooter />
    </div>
  );
}
