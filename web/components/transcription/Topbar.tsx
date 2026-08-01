import { Button } from "@/components/ui/Button";
import { Chip, type ChipVariant } from "@/components/ui/Chip";
import { cn } from "@/components/ui/cn";
import type { Phase } from "@/lib/types";

const CHIP_BY_PHASE: Record<Phase, ChipVariant> = {
  idle: "idle",
  uploading: "uploading",
  pending: "processing",
  processing: "processing",
  completed: "completed",
  failed: "failed",
  disabled: "disabled",
};

export interface TopbarProps {
  phase: Phase;
  onRestart: () => void;
  className?: string;
}

export function Topbar({ phase, onRestart, className }: TopbarProps) {
  return (
    <header
      className={cn(
        "flex h-16 shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-6",
        className,
      )}
    >
      <h1 className="min-w-0 truncate text-heading font-semibold text-text">
        Transcrição de áudio
      </h1>
      <div className="ml-auto flex items-center gap-3">
        <Chip variant={CHIP_BY_PHASE[phase]} />
        <Button variant="ghost" onClick={onRestart}>
          Recomeçar
        </Button>
      </div>
    </header>
  );
}
