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
} from "lucide-react";

type NavEntry = { href: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { label?: string; items: NavEntry[] };

const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "Overview", icon: LayoutDashboard }] },
  {
    label: "Control",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/delegations", label: "Delegations", icon: GitBranch },
      { href: "/policies", label: "Policies", icon: ShieldCheck },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/activity", label: "Activity", icon: Activity },
      { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
      { href: "/receipts", label: "Receipts", icon: FileCheck2 },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/developers", label: "Developers", icon: Code2 },
      { href: "/demo", label: "Demo lab", icon: FlaskConical },
    ],
  },
];

function NavLink({ item, active }: { item: NavEntry; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={clsx("navitem", active && "active")}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    // No responsive "hidden md:flex" here: Topbar's mobile drawer also
    // renders this component and needs it always visible there. The
    // persistent desktop placement (apps/web/src/app/(app)/layout.tsx)
    // is the one that hides it below md.
    <aside className="flex w-[240px] shrink-0 flex-col gap-0.5 bg-sidebar p-3">
      {NAV_GROUPS.map((group, i) => (
        <div key={group.label ?? `group-${i}`} className="flex flex-col gap-0.5">
          {group.label && <div className="navlabel">{group.label}</div>}
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} active={!!isActive(item.href)} />
          ))}
        </div>
      ))}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-white/10 pt-3">
        <NavLink item={{ href: "/settings", label: "Settings", icon: Settings }} active={!!isActive("/settings")} />
      </div>
    </aside>
  );
}
