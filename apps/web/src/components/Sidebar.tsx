"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  LayoutDashboard,
  Bot,
  GitBranch,
  ShieldCheck,
  Activity,
  ClipboardCheck,
  FileCheck2,
  FlaskConical,
  Code2,
  Settings,
  ShieldHalf,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/delegations", label: "Delegations", icon: GitBranch },
  { href: "/policies", label: "Policies", icon: ShieldCheck },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/receipts", label: "Receipts", icon: FileCheck2 },
  { href: "/demo", label: "Demo lab", icon: FlaskConical },
  { href: "/developers", label: "Developers", icon: Code2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-white md:flex">
      <div className="flex h-16 items-center gap-2 px-5">
        <ShieldHalf className="h-6 w-6 text-accent" />
        <span className="text-[15px] font-semibold tracking-tight">TrustRail</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Primary">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-accent text-white" : "text-slate-300 hover:bg-sidebar-hover hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-4 py-3 text-xs text-slate-400">
        <p>TrustRail V1 · sandbox environment</p>
      </div>
    </aside>
  );
}
