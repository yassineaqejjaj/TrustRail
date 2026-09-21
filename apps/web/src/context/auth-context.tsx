"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Role } from "@trustrail/contracts";
import { authApi, meApi, organizationsApi } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import type { Me } from "@/lib/types";

const ORG_STORAGE_KEY = "trustrail.orgId";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  me: Me | null;
  orgId: string | null;
  role: Role | null;
  orgName: string | null;
  refresh: () => Promise<Me | null>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectOrg: (orgId: string) => void;
  createOrganization: (name: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrgId(window.localStorage.getItem(ORG_STORAGE_KEY));
    }
  }, []);

  const refresh = useCallback(async (): Promise<Me | null> => {
    try {
      const result = await meApi.get();
      setMe(result);
      setStatus("authenticated");
      setOrgId((prev) => {
        const stillValid = prev && result.memberships.some((m) => m.organization_id === prev);
        const next = stillValid ? prev : (result.memberships[0]?.organization_id ?? null);
        if (typeof window !== "undefined") {
          if (next) window.localStorage.setItem(ORG_STORAGE_KEY, next);
          else window.localStorage.removeItem(ORG_STORAGE_KEY);
        }
        return next;
      });
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setStatus("anonymous");
        return null;
      }
      // Network or server error: don't claim "anonymous" (that would bounce
      // the user to a login screen when the real problem is the API being
      // down) — surface loading=false but keep whatever we last knew.
      setStatus((prevStatus) => (prevStatus === "loading" ? "anonymous" : prevStatus));
      throw err;
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {
      /* surfaced via status; page-level error boundaries show a retry */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      await authApi.login(email, password);
      await refresh();
    },
    [refresh]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      await authApi.register(email, password);
      await refresh();
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setMe(null);
    setStatus("anonymous");
    setOrgId(null);
    if (typeof window !== "undefined") window.localStorage.removeItem(ORG_STORAGE_KEY);
  }, []);

  const selectOrg = useCallback((next: string) => {
    setOrgId(next);
    if (typeof window !== "undefined") window.localStorage.setItem(ORG_STORAGE_KEY, next);
  }, []);

  const createOrganization = useCallback(
    async (name: string) => {
      const result = await organizationsApi.create(name);
      await refresh();
      selectOrg(result.organization_id);
      return result.organization_id;
    },
    [refresh, selectOrg]
  );

  const role = useMemo<Role | null>(() => {
    if (!me || !orgId) return null;
    return me.memberships.find((m) => m.organization_id === orgId)?.role ?? null;
  }, [me, orgId]);

  const orgName = useMemo<string | null>(() => {
    if (!me || !orgId) return null;
    return me.memberships.find((m) => m.organization_id === orgId)?.organization_name ?? null;
  }, [me, orgId]);

  const value: AuthContextValue = {
    status,
    me,
    orgId,
    role,
    orgName,
    refresh,
    login,
    register,
    logout,
    selectOrg,
    createOrganization,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, approver: 1, operator: 2, admin: 3, owner: 4 };

export function roleAtLeast(role: Role | null, minimum: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
