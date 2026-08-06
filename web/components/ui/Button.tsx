import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "ghost" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full transition-colors " +
  "disabled:cursor-not-allowed";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand hover:bg-brand-pressed text-text text-body-lg font-semibold px-5 py-3",
  ghost: "bg-canvas hover:bg-surface-muted border border-hairline text-text text-label px-4 py-2",
  danger: "bg-danger text-text-inverse text-body-lg font-semibold px-5 py-3",
};

const DISABLED: Record<ButtonVariant, string> = {
  primary: "bg-surface-disabled text-text-disabled text-body-lg font-semibold px-5 py-3",
  ghost: "bg-surface-disabled text-text-disabled border border-hairline text-label px-4 py-2",
  danger: "bg-surface-disabled text-text-disabled text-body-lg font-semibold px-5 py-3",
};

export function Button({
  variant = "primary",
  loading = false,
  fullWidth = false,
  disabled = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const inert = disabled || loading;
  const tone = disabled ? DISABLED[variant] : VARIANT[variant];

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
