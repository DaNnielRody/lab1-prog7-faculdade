import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/Dialog";
import type { AudioFileDto, AudioSummaryDto } from "@/lib/types";
import { summaryFacts } from "./format";

export interface CompletedDialogProps {
  open: boolean;
  summary: AudioSummaryDto | null;

  audio: AudioFileDto | null;
  onClose: () => void;
}

export function CompletedDialog({ open, summary, audio, onClose }: CompletedDialogProps) {
  const { text, length, maxLength, language } = summaryFacts(summary, audio);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      title="Transcrição concluída"
      subtitle="O resumo já está na conversa. Esta é a mesma resposta de GET /api/audios/{id}/summary."
    >
      <DialogBody className="items-center text-center">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center self-center rounded-full bg-success-soft text-heading text-success"
        >
          ✓
        </span>
        <div className="flex w-full flex-col gap-2 rounded-md border border-hairline bg-surface-muted p-4 text-left">
          <p className="text-body text-text">{text}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{language}</Badge>
            <span className="font-mono text-mono text-text-secondary">
              {length} / {maxLength} caracteres
            </span>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
