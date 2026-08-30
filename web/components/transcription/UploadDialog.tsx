import { Button } from "@/components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/Dialog";
import { FileCard } from "@/components/ui/FileCard";
import type { SelectedFile } from "@/lib/types";
import { fileMeta } from "./format";

export interface UploadDialogProps {
  open: boolean;
  file: SelectedFile | null;
  onClose: () => void;
  onConfirm: () => void;
  canConfirm: boolean;
}

export function UploadDialog({ open, file, onClose, onConfirm, canConfirm }: UploadDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={540}
      title="Enviar áudio para transcrição"
      subtitle="O arquivo vai para POST /api/audios e a transcrição acontece fora da requisição."
    >
      <DialogBody>
        {file ? <FileCard name={file.name} meta={fileMeta(file.name, file.sizeBytes)} /> : null}
        <p className="text-body text-text-secondary">
          O resumo é extrativo, gerado pelo Whisper tiny, e tem no máximo 500 caracteres.
        </p>
      </DialogBody>
      <DialogFooter note="Nada é enviado até você confirmar.">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={file === null || !canConfirm}>
          Enviar e transcrever
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
