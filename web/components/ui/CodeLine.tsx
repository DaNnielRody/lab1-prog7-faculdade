import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * {component.code-line} — docs/DESIGN.md §7 Thread.
 * Renders raw API values only (ids, enums, error strings), so it is always {type.mono}.
 * The border inherits the parent bubble's border color via `border-inherit`.
 */
export interface CodeLineProps {
  className?: string;
  children: ReactNode;
}

export function CodeLine({ className, children }: CodeLineProps) {
  return (
    <code
      className={cn(
        "block overflow-x-auto rounded-sm border border-inherit bg-canvas px-3 py-2 font-mono text-mono text-text-secondary",
        className,
      )}
    >
      {children}
    </code>
  );
}
