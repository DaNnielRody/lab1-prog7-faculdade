import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/Dialog";
import type { AudioFileDto, AudioSummaryDto } from "@/lib/types";
import { summaryFacts } from "./format";

/**
 * Outcome dialog (520px) — docs/DESIGN.md §7 {component.dialog-body-centered} +
 * {component.summary-preview-card}, Figma frame M2.
 */
export interface CompletedDialogProps {
  open: boolean;
  summary: AudioSummaryDto | null;
  /** Fallback source: an upload can answer `Completed` inline, in which case nothing ever polls. */
  audio: AudioFileDto | null;
  onClose: () => void;
}

export function CompletedDialog({ open, summary, audio, onClose }: CompletedDialogProps) {
  // Same two sources, same order as the thread bubble — the two surfaces cannot disagree.
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
        {/* 56px outcome circle — docs/DESIGN.md §4 {size.glyph-circle-lg}. */}
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center self-center rounded-full bg-success-soft text-heading text-success"
        >
          ✓
        </span>
        {/* {component.summary-preview-card} */}
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
