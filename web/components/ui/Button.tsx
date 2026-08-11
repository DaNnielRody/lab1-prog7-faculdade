import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "ghost" | "danger";

/**
 * `sm` exists so a primary can stand next to a ghost at the same height — Figma
 * `button-primary-sm` (5:528) and `button-ghost-sm` (5:530) are both 35px, `px-16 py-8`, 12px.
 * The default ghost already carries those metrics, so `size` only changes the filled variants;
 * widening it to `ghost` would resize the topbar and panel controls, which are correct today.
 */
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full transition-colors " +
  "disabled:cursor-not-allowed";

const FILLED_METRICS: Record<ButtonSize, string> = {
  md: "text-body-lg font-semibold px-5 py-3",
  sm: "text-label font-semibold px-4 py-2",
};

const GHOST_METRICS = "text-label px-4 py-2";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const inert = disabled || loading;
  const metrics = variant === "ghost" ? GHOST_METRICS : FILLED_METRICS[size];

  let fill: string;
  if (disabled) {
    fill = "bg-surface-disabled text-text-disabled";
    if (variant === "ghost") fill += " border border-hairline";
  } else if (variant === "primary") {
    fill = "bg-brand hover:bg-brand-pressed text-text";
  } else if (variant === "danger") {
    fill = "bg-danger text-text-inverse";
  } else {
    fill = "bg-canvas hover:bg-surface-muted border border-hairline text-text";
  }

  const tone = `${fill} ${metrics}`;

  return (
    <button
      {...rest}
      type={type}
      disabled={inert}
      aria-busy={loading || undefined}
      className={cn(BASE, tone, fullWidth && "w-full", className)}
    >
      {loading ? (
        <span aria-hidden="true" className="inline-block size-4 shrink-0 animate-spin text-label">
          ↻
        </span>
      ) : null}

      <span className={cn(variant === "primary" && !disabled && "text-text")}>{children}</span>
    </button>
  );
}
