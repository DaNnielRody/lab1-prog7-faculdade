import type { ReactNode } from "react";
import { cn } from "./cn";

export type MessageTone = "user" | "system" | "summary" | "error";

const CIRCLE: Record<MessageTone, string> = {
  user: "bg-surface-muted text-text-secondary",
  system: "bg-surface-muted text-text-secondary",
  summary: "bg-brand-soft text-brand-text",
  error: "bg-danger-soft text-danger",
};

export interface MessageRowProps {
  tone: MessageTone;
  author: string;
  timestamp: string;

  glyph?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function MessageRow({
  tone,
  author,
  timestamp,
  glyph,
  className,
  children,
}: MessageRowProps) {
  return (
    <div className={cn("flex w-full max-w-bubble flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          style={{ width: "22px", height: "22px" }}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full text-mono",
            CIRCLE[tone],
          )}
        >
          {glyph}
        </span>
        <span className="text-label font-semibold text-text">{author}</span>
        <span className="text-caption text-text-secondary">{timestamp}</span>
      </div>
      {children}
    </div>
  );
}
