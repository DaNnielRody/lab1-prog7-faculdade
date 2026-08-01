import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * {component.bubble} and its variants — docs/DESIGN.md §7 Thread.
 * Width is fixed at {layout.bubble} (624px) regardless of viewport (§8 Do 6).
 */
export type BubbleVariant = "neutral" | "upload" | "loading" | "summary" | "error";

const SURFACE: Record<BubbleVariant, string> = {
  neutral: "bg-surface-muted border-hairline",
  upload: "bg-canvas border-hairline",
  loading: "bg-surface-muted border-hairline",
  summary: "bg-canvas border-hairline",
  error: "bg-danger-soft border-danger-border",
};

/** Accent rail colors — {colors.brand.primary} for brand work, semantics for state. */
export type BubbleAccent = "brand" | "info" | "danger";

const ACCENT: Record<BubbleAccent, string> = {
  brand: "border-l-brand",
  info: "border-l-info",
  danger: "border-l-danger",
};

export interface BubbleProps {
  variant?: BubbleVariant;
  /** Renders the 3px left accent rail of {component.bubble-loading} / -summary / -error. */
  accent?: BubbleAccent;
  className?: string;
  children: ReactNode;
}

export function Bubble({ variant = "neutral", accent, className, children }: BubbleProps) {
  return (
    <div
      // 3px accent rail — docs/DESIGN.md §7; off the 4px scale, so it is a literal from the doc.
      style={accent ? { borderLeftWidth: "3px" } : undefined}
      className={cn(
        "flex w-bubble max-w-full flex-col gap-2 rounded-md border px-4 py-3",
        SURFACE[variant],
        accent && ACCENT[accent],
        className,
      )}
    >
      {children}
    </div>
  );
}
