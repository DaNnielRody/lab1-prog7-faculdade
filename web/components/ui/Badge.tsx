import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "success" | "brand";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-text-secondary",
  success: "bg-success-soft text-success",
  brand: "bg-brand-soft text-brand-text",
};

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-1 font-mono text-mono font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
