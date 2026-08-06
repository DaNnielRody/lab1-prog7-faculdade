import type { ReactNode } from "react";
import { cn } from "./cn";

export type BubbleVariant = "neutral" | "upload" | "loading" | "summary" | "error";

const SURFACE: Record<BubbleVariant, string> = {
  neutral: "bg-surface-muted border-hairline",
  upload: "bg-canvas border-hairline",
  loading: "bg-surface-muted border-hairline",
  summary: "bg-canvas border-hairline",
  error: "bg-danger-soft border-danger-border",
};

export type BubbleAccent = "brand" | "info" | "danger";

const ACCENT: Record<BubbleAccent, string> = {
  brand: "border-l-brand",
  info: "border-l-info",
  danger: "border-l-danger",
};

export interface BubbleProps {
  variant?: BubbleVariant;

  accent?: BubbleAccent;
  className?: string;
  children: ReactNode;
}

export function Bubble({ variant = "neutral", accent, className, children }: BubbleProps) {
  return (
    <div

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
