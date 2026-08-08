import { cn } from "./cn";

export type ChipVariant =
  | "idle"
  | "uploading"
  | "processing"
  | "compressing"
  | "summarizing"
  | "completed"
  | "failed"
  | "disabled";

interface ChipStyle {
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
  compressing: {
    label: "Comprimindo",
    surface: "bg-info-soft",
    ink: "text-info",
    dot: "bg-info",
  },
  summarizing: {
    label: "Resumindo",
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
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {label ?? style.label}
    </span>
  );
}
