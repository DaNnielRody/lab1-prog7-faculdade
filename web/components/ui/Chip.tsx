import { cn } from "./cn";

/**
 * {component.status-chip} — docs/DESIGN.md §7 Status & Badges.
 * `disabled` is the API's `Summarization:Enabled = false`: neutral, never red (§7).
 */
export type ChipVariant =
  | "idle"
  | "uploading"
  | "processing"
  | "completed"
  | "failed"
  | "disabled";

interface ChipStyle {
  /** Portuguese copy, verbatim from the §7 table. */
  label: string;
  surface: string;
  ink: string;
  dot: string;
}

const CHIP: Record<ChipVariant, ChipStyle> = {
  idle: {
    label: "Aguardando arquivo",
    surface: "bg-surface-muted",
    ink: "text-text-secondary",
    dot: "bg-text-secondary",
  },
  uploading: {
    label: "Enviando…",
    surface: "bg-brand-soft",
    ink: "text-brand-text",
    dot: "bg-brand-text",
  },
  processing: {
    label: "Processando",
    surface: "bg-info-soft",
    ink: "text-info",
    dot: "bg-info",
  },
  completed: {
    label: "Concluído",
    surface: "bg-success-soft",
    ink: "text-success",
    dot: "bg-success",
  },
  failed: {
    label: "Falhou",
    surface: "bg-danger-soft",
    ink: "text-danger",
    dot: "bg-danger",
  },
  disabled: {
    label: "Resumo desativado",
    surface: "bg-surface-muted",
    ink: "text-text-secondary",
    dot: "bg-text-secondary",
  },
};

export interface ChipProps {
  variant: ChipVariant;
  /** Overrides the canonical copy only when the screen has a more specific literal. */
  label?: string;
  className?: string;
}

export function Chip({ variant, label, className }: ChipProps) {
  const style = CHIP[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-label font-medium",
        style.surface,
        style.ink,
        className,
      )}
    >
      {/* 6px dot — docs/DESIGN.md §7; 1.5 on the 4px scale. */}
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {label ?? style.label}
    </span>
  );
}
