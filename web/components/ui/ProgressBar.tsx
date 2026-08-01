import { cn } from "./cn";

/**
 * {component.progress-bar} — docs/DESIGN.md §7.
 * Determinate for upload (real bytes). For `Processing` the API reports no percentage, so the
 * bar runs an indeterminate 30%-width sweep and exposes no `aria-valuenow` (§8 Don't 3).
 */
export type ProgressTone = "brand" | "info";

const FILL: Record<ProgressTone, string> = {
  brand: "bg-brand",
  info: "bg-info",
};

export interface ProgressBarProps {
  /** 0..100. Omit for work the API does not measure. */
  value?: number;
  tone?: ProgressTone;
  label: string;
  className?: string;
}

export function ProgressBar({ value, tone = "brand", label, className }: ProgressBarProps) {
  const determinate = typeof value === "number";
  const clamped = determinate ? Math.min(100, Math.max(0, value)) : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? clamped : undefined}
      // 6px track — docs/DESIGN.md §7; 1.5 on the 4px scale.
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hairline", className)}
    >
      {/*
        Width is data, not a token: the determinate value comes from real bytes, the indeterminate
        sweep is the literal 30% of docs/DESIGN.md §7. Motion (duration/easing) is an open gap in
        §11 "Motion is undocumented", so no animation is invented here.
      */}
      <div
        className={cn("h-full rounded-full", FILL[tone])}
        style={{ width: determinate ? `${clamped}%` : "30%" }}
      />
    </div>
  );
}
