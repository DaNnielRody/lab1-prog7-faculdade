import { Button } from "@/components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/Dialog";

/**
 * {component.dialog-confirm} (480px) — docs/DESIGN.md §7 Overlays, Figma frame M4.
 *
 * Not dismissable: a destructive action requires an explicit choice, so neither the scrim nor
 * Escape closes it. The consequence copy states what is *not* destroyed, because "Recomeçar" is
 * local-only — it clears the screen, never the server.
 */
export interface ConfirmRestartDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmRestartDialog({ open, onCancel, onConfirm }: ConfirmRestartDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      width={480}
      dismissable={false}
      title="Recomeçar a transcrição?"
    >
      <DialogBody>
        <div className="flex items-start gap-4">
          {/* 40px warning circle — docs/DESIGN.md §7 {component.dialog-confirm}. */}
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-body text-warning"
          >
            !
          </span>
          <p className="text-body text-text-secondary">
            A tela volta ao estado inicial e o áudio selecionado sai do player. O arquivo e o resumo
            já salvos no servidor não são apagados.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Recomeçar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
