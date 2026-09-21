"use client";

import { AlertTriangle, Check, Copy, Inbox, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import clsx from "clsx";
import type { Decision, ExecutionState, ApprovalStatus } from "@trustrail/contracts";
import { APPROVAL_LABEL, DECISION_COLOR, DECISION_LABEL, EXECUTION_LABEL, executionColor } from "@/lib/format";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-xl border border-border bg-surface shadow-card", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  const c = DECISION_COLOR[decision];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", c.bg, c.text)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden />
      {DECISION_LABEL[decision]}
    </span>
  );
}

export function ExecutionBadge({ state }: { state: ExecutionState }) {
  const c = executionColor(state);
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", c.bg, c.text)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden />
      {EXECUTION_LABEL[state]}
    </span>
  );
}

export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, { bg: string; text: string; dot: string }> = {
    pending: { bg: "bg-pending/10", text: "text-pending", dot: "bg-pending" },
    approved: { bg: "bg-success/10", text: "text-success", dot: "bg-success" },
    rejected: { bg: "bg-danger/10", text: "text-danger", dot: "bg-danger" },
    expired: { bg: "bg-muted/10", text: "text-muted", dot: "bg-muted" },
  };
  const c = map[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", c.bg, c.text)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden />
      {APPROVAL_LABEL[status]}
    </span>
  );
}

export function StatusDot({ tone }: { tone: "success" | "pending" | "danger" | "muted" }) {
  const map = { success: "bg-success", pending: "bg-pending", danger: "bg-danger", muted: "bg-muted" };
  return <span className={clsx("inline-block h-2 w-2 rounded-full", map[tone])} aria-hidden />;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("mono text-[13px]", className)}>{children}</span>;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard API unavailable — silently no-op, not worth a toast
        }
      }}
      aria-label={copied ? "Copied" : label}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg text-muted">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, requestId, onRetry }: { message: string; requestId?: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-danger">{message}</p>
        {requestId && <p className="mt-0.5 text-xs text-muted">Request ID: {requestId}</p>}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-danger/30 bg-surface px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-md bg-border/60", className)} />;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-12 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm" };
  const variants = {
    primary: "bg-accent text-white hover:bg-accent-hover",
    secondary: "border border-border bg-surface text-ink hover:bg-bg",
    danger: "bg-danger text-white hover:bg-danger/90",
    ghost: "text-muted hover:bg-bg hover:text-ink",
  };
  return (
    <button className={clsx(base, sizes[size], variants[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent";

export function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium mono",
        tone === "accent" ? "bg-accent/10 text-accent" : "bg-bg text-muted border border-border"
      )}
    >
      {children}
    </span>
  );
}
