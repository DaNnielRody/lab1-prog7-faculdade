import type { ReactNode } from "react";
import { cn } from "./cn";

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
