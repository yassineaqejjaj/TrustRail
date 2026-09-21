"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import { initials } from "@/lib/format";
import { Sidebar } from "./Sidebar";

export function Topbar() {
  const { me, orgId, orgName, logout } = useAuth();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          className="rounded-md p-2 text-muted hover:bg-bg md:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>

        {me && me.memberships.length > 0 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-bg">
                <span className="max-w-[160px] truncate">{orgName ?? "Select organization"}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted" />
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

        <span className="inline-flex items-center rounded-full border border-pending/30 bg-pending/10 px-2.5 py-1 text-xs font-medium text-pending">
          Sandbox
        </span>
      </div>

      <div className="flex items-center gap-3">
        {me && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-2 rounded-full px-1.5 py-1 hover:bg-bg" aria-label="Account menu">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                  {initials(me.email)}
                </span>
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
            className="flex-1 bg-ink/40"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}
    </header>
  );
}
