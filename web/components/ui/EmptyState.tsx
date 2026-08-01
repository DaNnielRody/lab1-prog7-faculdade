import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * {component.empty-state} — docs/DESIGN.md §7.
 * Centered on both axes of {layout.center}; never left-aligned in a wide container (§4).
 */
export interface EmptyStateProps {
  headline: string;
  subline: string;
  glyph?: ReactNode;
  className?: string;
}

export function EmptyState({ headline, subline, glyph = "♪", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-3 text-center",
        className,
      )}
    >
      {/* 56px glyph circle — docs/DESIGN.md §7. */}
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-heading text-brand-text"
      >
        {glyph}
      </span>
      <h2 className="text-heading font-semibold text-text">{headline}</h2>
      {/* Subline capped at 360px and centered — docs/DESIGN.md §7. */}
      <p style={{ maxWidth: "360px" }} className="text-body text-text-secondary">
        {subline}
      </p>
    </div>
  );
}
