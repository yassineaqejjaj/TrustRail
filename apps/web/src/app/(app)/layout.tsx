"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { LoadingBlock } from "@/components/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { status, me, orgId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/onboarding");
    if (status === "authenticated" && me && me.memberships.length === 0) router.replace("/onboarding");
  }, [status, me, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (status === "anonymous" || !me || me.memberships.length === 0 || !orgId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <LoadingBlock label="Redirecting to onboarding…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="bg-glow relative flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
