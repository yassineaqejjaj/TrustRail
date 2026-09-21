import type { ApprovalStatus, Decision, ExecutionState } from "@trustrail/contracts";

export function formatMoney(minor: number, currency: string = "EUR"): string {
  const major = minor / 100;
  return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(major);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - d;
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return diffSec >= 0 ? `${abs}s ago` : `in ${abs}s`;
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return diffMin >= 0 ? `${Math.abs(diffMin)}m ago` : `in ${Math.abs(diffMin)}m`;
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return diffHour >= 0 ? `${Math.abs(diffHour)}h ago` : `in ${Math.abs(diffHour)}h`;
  const diffDay = Math.round(diffHour / 24);
  return diffDay >= 0 ? `${Math.abs(diffDay)}d ago` : `in ${Math.abs(diffDay)}d`;
}

export const DECISION_LABEL: Record<Decision, string> = {
  ALLOW: "Allowed",
  DENY: "Denied",
  REQUIRE_APPROVAL: "Requires approval",
};

export const DECISION_COLOR: Record<Decision, { bg: string; text: string; dot: string }> = {
  ALLOW: { bg: "bg-success/10", text: "text-success", dot: "bg-success" },
  DENY: { bg: "bg-danger/10", text: "text-danger", dot: "bg-danger" },
  REQUIRE_APPROVAL: { bg: "bg-pending/10", text: "text-pending", dot: "bg-pending" },
};

export const EXECUTION_LABEL: Record<ExecutionState, string> = {
  received: "Received",
  awaiting_approval: "Awaiting approval",
  ready: "Ready",
  reserved: "Budget reserved",
  dispatching: "Dispatching",
  succeeded: "Succeeded",
  failed: "Failed",
  unknown: "Unknown (reconciling)",
  denied: "Denied",
  cancelled: "Cancelled",
  expired: "Expired",
};

const successStates = new Set<ExecutionState>(["succeeded"]);
const pendingStates = new Set<ExecutionState>(["received", "awaiting_approval", "ready", "reserved", "dispatching", "unknown"]);
const dangerStates = new Set<ExecutionState>(["failed", "denied", "cancelled", "expired"]);

export function executionColor(state: ExecutionState): { bg: string; text: string; dot: string } {
  if (successStates.has(state)) return { bg: "bg-success/10", text: "text-success", dot: "bg-success" };
  if (dangerStates.has(state)) return { bg: "bg-danger/10", text: "text-danger", dot: "bg-danger" };
  return { bg: "bg-pending/10", text: "text-pending", dot: "bg-pending" };
}

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

export function initials(nameOrEmail: string): string {
  const cleaned = nameOrEmail.split("@")[0] ?? nameOrEmail;
  const parts = cleaned.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function truncateId(id: string, headTail = 6): string {
  if (id.length <= headTail * 2 + 3) return id;
  return `${id.slice(0, headTail)}…${id.slice(-headTail)}`;
}
