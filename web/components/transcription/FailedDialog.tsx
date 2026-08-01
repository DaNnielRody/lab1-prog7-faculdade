import { Button } from "@/components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/Dialog";

/**
 * Outcome dialog (520px) — docs/DESIGN.md §7 {component.dialog-body-centered} +
 * {component.error-detail-card}, Figma frame M3.
 */
export interface FailedDialogProps {
  open: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function FailedDialog({ open, error, onClose, onRetry }: FailedDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title="Falha na transcrição"
      subtitle="O áudio continua armazenado no servidor; apenas o resumo não foi gerado."
    >
      <DialogBody className="items-center text-center">
        {/* 56px outcome circle — docs/DESIGN.md §4 {size.glyph-circle-lg}. */}
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center self-center rounded-full bg-danger-soft text-heading text-danger"
        >
          ⚠
        </span>
        {/* {component.error-detail-card} */}
        <div className="flex w-full flex-col gap-2 rounded-md border border-danger-border bg-danger-soft p-4 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 text-body font-semibold text-danger">
              Não foi possível transcrever este áudio
            </span>
            <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">Failed</span>
          </div>
          <span className="text-caption text-text-secondary">{error}</span>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        <Button onClick={onRetry}>Tentar novamente</Button>
      </DialogFooter>
    </Dialog>
  );
}
