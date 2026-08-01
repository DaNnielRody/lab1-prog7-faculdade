import { cn } from "./cn";

export type StepState = "done" | "active" | "pending" | "failed";

interface StepStyle {
  glyph: string;
  circle: string;
  label: string;
}

const STEP: Record<StepState, StepStyle> = {
  done: {
    glyph: "✓",
    circle: "bg-success-soft text-success",
    label: "text-text-secondary font-normal",
  },
  active: {
    glyph: "◐",
    circle: "bg-info-soft text-info",
    label: "text-text font-medium",
  },
  pending: {
    glyph: "○",
    circle: "bg-surface-muted text-text-secondary",
    label: "text-text-secondary font-normal",
  },
  failed: {
    glyph: "✕",
    circle: "bg-danger-soft text-danger",
    label: "text-danger font-medium",
  },
};

export interface Step {
  id: string;
  label: string;
  state: StepState;
}

export interface StepperProps {
  steps: Step[];
  className?: string;
}

export function Stepper({ steps, className }: StepperProps) {
  return (
    <ol
      className={cn(
        "flex flex-col gap-2 rounded-sm border border-hairline bg-canvas p-3",
        className,
      )}
    >
      {steps.map((step) => {
        const style = STEP[step.state];
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full text-mono",
                style.circle,
              )}
            >
              {style.glyph}
            </span>
            <span className={cn("min-w-0 truncate text-label", style.label)}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
