import { Button } from "@/components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/Dialog";

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
