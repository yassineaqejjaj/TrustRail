import { useId } from "react";
import clsx from "clsx";

/**
 * The TrustRail mark: a vertical rail reading top to bottom as authority
 * (ring), decision (dot), verified receipt (checkmark). Bare form for
 * inline use next to the wordmark -- see TrustRailAppIcon for the boxed
 * app-icon treatment. `tone` picks a fixed single-color rendering for
 * contexts that need one flat color (a colored surface, print, favicon
 * fallback); omit it for the normal ring/gradient-line/dot/check version.
 */
export function TrustRailMark({ className, tone }: { className?: string; tone?: "white" | "ink" }) {
  const gradientId = useId();
  const flat = tone === "white" ? "#FFFFFF" : tone === "ink" ? "#101828" : undefined;

  return (
    <svg viewBox="0 0 24 24" fill="none" className={clsx("shrink-0", className)} aria-hidden>
      {!flat && (
        <defs>
          <linearGradient id={gradientId} x1="12" y1="7" x2="12" y2="17" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#315CFD" />
            <stop offset="1" stopColor="#16845B" />
          </linearGradient>
        </defs>
      )}
      <line x1="12" y1="7.5" x2="12" y2="16.5" stroke={flat ?? `url(#${gradientId})`} strokeWidth="1.5" />
      <circle cx="12" cy="5" r="2.25" stroke={flat ?? "#315CFD"} strokeWidth="1.6" fill="none" />
      <circle cx="12" cy="12" r="1.7" fill={flat ?? "#315CFD"} />
      <circle cx="12" cy="19" r="3" fill={flat ?? "#16845B"} />
      <path
        d="M10.5 19L11.6 20.1L13.6 17.9"
        stroke={flat ? (tone === "white" ? "#101828" : "#FFFFFF") : "#FFFFFF"}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The boxed app-icon treatment: the mark on its dark rounded-square badge. */
export function TrustRailAppIcon({ className }: { className?: string }) {
  return (
    <div className={clsx("flex items-center justify-center rounded-[22%] bg-sidebar", className)}>
      <TrustRailMark className="h-[62%] w-[62%]" />
    </div>
  );
}
