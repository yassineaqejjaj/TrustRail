"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import clsx from "clsx";
import { TrustRailMark } from "./TrustRailMark";

const NAV_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
];

export function MarketingHeader({ active }: { active?: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-ink">
          <TrustRailMark className="h-5 w-5" />
          TrustRail
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "text-sm font-medium transition-colors",
                active === link.href ? "text-ink" : "text-muted hover:text-ink"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 md:gap-5">
          <Link href="/onboarding?mode=login" className="hidden text-sm font-medium text-ink hover:text-accent md:inline">
            Log in
          </Link>
          <Link
            href="/onboarding"
            className="rounded-full bg-sidebar px-5 py-2.5 text-sm font-semibold text-white hover:bg-sidebar-hover"
          >
            Get started
          </Link>
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-1.5 text-ink hover:bg-surface md:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav className="flex flex-col gap-1 border-t border-border bg-bg px-6 py-4 md:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={clsx(
                "rounded-lg px-3 py-2.5 text-sm font-medium",
                active === link.href ? "bg-surface text-ink" : "text-muted hover:bg-surface hover:text-ink"
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/onboarding?mode=login"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface hover:text-ink"
          >
            Log in
          </Link>
        </nav>
      )}
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-surface py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 text-center text-xs text-muted sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-2 text-ink">
          <TrustRailMark className="h-4 w-4" />
          <span className="font-semibold">TrustRail</span>
        </div>
        <p>TrustRail is an in-development product. No customers, revenue, or independent audit are claimed. All demo amounts are synthetic sandbox money.</p>
      </div>
    </footer>
  );
}

type TimelineTone = "start" | "success" | "pending";

const TIMELINE_STEPS: { label: string; tone: TimelineTone }[] = [
  { label: "Refund Agent", tone: "start" },
  { label: "Authenticated", tone: "success" },
  { label: "€350 refund requested", tone: "success" },
  { label: "Policy checked", tone: "success" },
  { label: "Human approval", tone: "pending" },
  { label: "Executed", tone: "success" },
  { label: "Signed receipt ✓", tone: "success" },
];

export function TrustTimelineCard({ className }: { className?: string }) {
  return (
    <div className={clsx("glass w-full max-w-sm p-8", className)}>
      <p className="mono text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-muted">Trust Rail</p>
      <ol className="relative mt-6 flex flex-col gap-[18px] border-l border-border pl-6">
        {TIMELINE_STEPS.map((step, i) => (
          <li key={i} className="relative">
            <span
              className={clsx(
                "absolute -left-[29px] top-[3px] h-2.5 w-2.5 rounded-full",
                step.tone === "start" && "bg-ink",
                step.tone === "success" && "bg-success",
                step.tone === "pending" && "border-2 border-pending bg-bg"
              )}
              aria-hidden
            />
            <span
              className={clsx(
                step.tone === "start" ? "text-sm font-semibold text-ink" : "mono text-[13px] font-medium",
                step.tone === "success" && "text-success",
                step.tone === "pending" && "text-pending"
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
