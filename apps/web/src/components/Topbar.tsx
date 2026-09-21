"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import { initials } from "@/lib/format";
import { Sidebar } from "./Sidebar";
import { TrustRailMark } from "./TrustRailMark";
import { ThemeToggle } from "./ThemeToggle";

function displayName(email: string) {
  const local = email.split("@")[0] ?? email;
  const first = local.split(/[._-]/)[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function Topbar() {
  const { me, orgId, orgName, logout } = useAuth();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-sidebar px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          className="rounded-md p-2 text-white/70 hover:bg-white/10 md:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>

        <TrustRailMark className="h-5 w-5" />
        <span className="text-[15px] font-bold tracking-tight text-white">TrustRail</span>

        <span className="inline-flex items-center rounded-full border border-white/[0.16] bg-white/[0.08] px-2.5 py-[3px] text-[11px] font-semibold uppercase tracking-wide text-white/75">
          Sandbox
        </span>

        {me && me.memberships.length > 1 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="ml-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white">
                <span className="max-w-[160px] truncate">{orgName ?? "Select organization"}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="z-50 min-w-[220px] rounded-lg border border-border bg-surface p-1 shadow-lg"
              >
                {me.memberships.map((m) => (
                  <DropdownMenu.Item
                    key={m.organization_id}
                    onSelect={() => {
                      window.localStorage.setItem("trustrail.orgId", m.organization_id);
                      window.location.reload();
                    }}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-ink outline-none hover:bg-bg data-[highlighted]:bg-bg"
                  >
                    <span className="truncate">{m.organization_name}</span>
                    {m.organization_id === orgId && <span className="text-xs text-accent">current</span>}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  onSelect={() => router.push("/onboarding")}
                  className="cursor-pointer rounded-md px-3 py-2 text-sm text-accent outline-none hover:bg-bg data-[highlighted]:bg-bg"
                >
                  Create new organization
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle className="text-white/70 hover:bg-white/10 hover:text-white" />
        <a href="/developers" className="hidden text-[13px] text-white/65 hover:text-white sm:inline">
          Help
        </a>
        {me && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-white/10" aria-label="Account menu">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                  {initials(me.email)}
                </span>
                <span className="hidden text-[13px] text-white sm:inline">{displayName(me.email)}</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-[220px] rounded-lg border border-border bg-surface p-1 shadow-lg"
              >
                <div className="px-3 py-2 text-sm text-muted truncate">{me.email}</div>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  onSelect={async () => {
                    await logout();
                    router.push("/");
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-danger/5 data-[highlighted]:bg-danger/5"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="w-60 bg-sidebar">
            <Sidebar />
          </div>
          <button
            className="flex-1 bg-sidebar/40"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}
    </header>
  );
}
