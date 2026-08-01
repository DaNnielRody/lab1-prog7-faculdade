import { cn } from "./cn";

export type ProgressTone = "brand" | "info";

const FILL: Record<ProgressTone, string> = {
  brand: "bg-brand",
  info: "bg-info",
};

export interface ProgressBarProps {
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

      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-hairline", className)}
    >
      <div
        className={cn("h-full rounded-full", FILL[tone])}
        style={{ width: determinate ? `${clamped}%` : "30%" }}
      />
    </div>
  );
}
