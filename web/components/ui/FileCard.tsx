import { cn } from "./cn";

/**
 * {component.file-card} — docs/DESIGN.md §7 Inputs & Forms.
 * The name column carries min-width: 0 and truncates: it must never push the dismiss control
 * out of the card (§8 Do 8).
 */
export interface FileCardProps {
  name: string;
  /** e.g. "3,4 MB · WAV · 2:40" — {type.caption} metadata line. */
  meta: string;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

export function FileCard({
  name,
  meta,
  onDismiss,
  dismissLabel = "Remover arquivo",
  className,
}: FileCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-sm border border-hairline bg-canvas p-3",
        className,
      )}
    >
      {/* 34px icon tile — docs/DESIGN.md §7; off the 4px scale. */}
      <span
        aria-hidden="true"
        style={{ width: "34px", height: "34px" }}
        className="flex shrink-0 items-center justify-center rounded-sm bg-brand-soft text-brand-text text-label"
      >
        ♪
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate text-label font-semibold text-text">{name}</span>
        <span className="truncate text-caption text-text-secondary">{meta}</span>
      </span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="ml-auto shrink-0 rounded-full p-2 text-label text-text-secondary hover:bg-surface-muted"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
