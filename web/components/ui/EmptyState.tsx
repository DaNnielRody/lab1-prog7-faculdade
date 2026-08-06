import type { ReactNode } from "react";
import { cn } from "./cn";

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
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-heading text-brand-text"
      >
        {glyph}
      </span>
      <h2 className="text-heading font-semibold text-text">{headline}</h2>
      <p style={{ maxWidth: "360px" }} className="text-body text-text-secondary">
        {subline}
      </p>
    </div>
  );
}
