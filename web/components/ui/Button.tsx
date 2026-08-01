import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * {component.button-primary} / {component.button-ghost} / {component.button-danger}
 * plus the -disabled and -loading states — docs/DESIGN.md §7 Buttons.
 *
 * The primary label is {colors.text.primary} (ink), never white: white on
 * {colors.brand.primary} measures 3.12:1 and is forbidden by §8 Don't 1.
 */
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
  // label is text-text (ink) in both resting and pressed, so it never flickers on press.
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
  // A loading control is non-interactive but keeps its filled treatment: it is still working.
  // Passing `disabled` *with* `loading` is the "waiting on the server" case of §7
  // {component.button-primary-loading}: the button is no longer the thing making progress, so the
  // fill drops to {colors.surface.disabled} while `aria-busy` stays on.
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
        <span
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {/*
        The ink label is restated on the primary span so the §8 Don't 1 rule is legible on the
        element that actually carries the text, not only inherited from the button.
      */}
      <span className={cn(variant === "primary" && !disabled && "text-text")}>{children}</span>
    </button>
  );
}
