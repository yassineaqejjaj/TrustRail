import Link from "next/link";
import { Check } from "lucide-react";
import clsx from "clsx";
import { TrustRailMark } from "./TrustRailMark";

export function SetupHeader({ exitHref }: { exitHref?: string }) {
  return (
    <header className="flex h-14 items-center justify-between bg-sidebar px-6">
      <Link href="/" className="flex items-center gap-2">
        <TrustRailMark className="h-5 w-5" />
        <span className="text-[15px] font-bold tracking-tight text-white">TrustRail</span>
      </Link>
      {exitHref && (
        <Link href={exitHref} className="text-[13px] text-white/65 hover:text-white">
          Exit setup
        </Link>
      )}
    </header>
  );
}

export function SetupHero({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 pt-12 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-sm text-muted">{description}</p>
    </div>
  );
}

export type SetupStep = { label: string; status: "done" | "active" | "todo" };

export function SetupProgress({ steps }: { steps: SetupStep[] }) {
  return (
    <div className="mx-auto mt-8 flex max-w-2xl items-start px-6">
      {steps.map((step, i) => (
        <div key={step.label} className="flex flex-1 flex-col items-center last:flex-none">
          <div className="flex w-full items-center">
            {/* Always render this spacer, even for the first step: it pushes every
                circle to the trailing edge of its own column so it lines up flush
                against the next column's connector, with no gap. Only its color
                is conditional -- for i === 0 there is no previous step to connect
                to, so it stays invisible while still occupying the same space. */}
            <div
              className={clsx(
                "h-px flex-1",
                i === 0 ? "bg-transparent" : steps[i - 1]?.status === "done" ? "bg-success" : "bg-border"
              )}
              aria-hidden
            />
            <div
              className={clsx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                step.status === "done" && "bg-success text-white",
                step.status === "active" && "border-2 border-accent bg-surface text-accent",
                step.status === "todo" && "border border-border bg-surface text-muted"
              )}
            >
              {step.status === "done" ? <Check className="h-3.5 w-3.5" /> : step.status === "active" ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
            </div>
          </div>
          <span
            className={clsx(
              "mt-2 text-center text-[12px] font-medium",
              step.status === "todo" ? "text-muted" : step.status === "active" ? "text-accent" : "text-success"
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export type PreviewRow = { label: string; tone: "start" | "success" | "pending" };

export function LivePreviewPanel({ title = "Live preview", rows, example = true }: { title?: string; rows: PreviewRow[]; example?: boolean }) {
  return (
    <div className="glass-dark sticky top-24 p-6">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/45">{title}</p>
        {example && (
          <span className="rounded-full border border-white/16 bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
            Example
          </span>
        )}
      </div>
      <ol className="relative mt-5 flex flex-col gap-3 border-l border-white/10 pl-5">
        {rows.map((row, i) => (
          <li key={i} className="relative">
            <span
              className={clsx(
                "absolute -left-[25px] top-[3px] h-2 w-2 rounded-full",
                row.tone === "start" && "bg-white",
                row.tone === "success" && "bg-success",
                row.tone === "pending" && "border-2 border-pending bg-transparent"
              )}
              aria-hidden
            />
            <span
              className={clsx(
                row.tone === "start" ? "text-sm font-semibold text-white" : "mono text-[12.5px] font-medium",
                row.tone === "success" && "text-success",
                row.tone === "pending" && "text-pending"
              )}
            >
              {row.label}
            </span>
          </li>
        ))}
      </ol>
      {example && (
        <p className="mt-5 text-xs text-white/45">This is what a verified action looks like once your agent is connected.</p>
      )}
    </div>
  );
}
