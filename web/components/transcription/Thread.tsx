import { Badge } from "@/components/ui/Badge";
import { Bubble } from "@/components/ui/Bubble";
import { Button } from "@/components/ui/Button";
import { CodeLine } from "@/components/ui/CodeLine";
import { EmptyState } from "@/components/ui/EmptyState";
import { FileCard } from "@/components/ui/FileCard";
import { MessageRow } from "@/components/ui/MessageRow";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/components/ui/cn";
import type { AudioFileDto, AudioSummaryDto, Phase, SelectedFile, ThreadMessage } from "@/lib/types";
import { fileMeta, formatTimestamp, summaryFacts } from "./format";

export interface ThreadProps {
  phase: Phase;

  progress: number;
  file: SelectedFile | null;
  audio: AudioFileDto | null;
  summary: AudioSummaryDto | null;
  error: string | null;
  messages: ThreadMessage[];
  onRetry: () => void;
  onSendAnother: () => void;
  className?: string;
}

function LoadingGlyph({ tone }: { tone: "brand" | "info" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full text-mono",
        tone === "brand" ? "bg-brand-soft text-brand-text" : "bg-info-soft text-info",
      )}
    >
      ◐
    </span>
  );
}

export function Thread({
  phase,
  progress,
  file,
  audio,
  summary,
  error,
  messages,
  onRetry,
  onSendAnother,
  className,
}: ThreadProps) {
  const facts = summaryFacts(summary, audio);

  function renderMessage(message: ThreadMessage) {
    switch (message.phase) {
      case "uploading":
        return (
          <MessageRow
            key={message.id}
            tone="user"
            author="Você"
            timestamp={formatTimestamp(message.createdAt)}
            glyph="↑"
          >
            <Bubble variant="upload">
              <FileCard
                name={file?.name ?? audio?.originalFileName ?? "áudio"}
                meta={fileMeta(
                  file?.name ?? audio?.originalFileName ?? "",
                  file?.sizeBytes ?? audio?.sizeBytes ?? 0,
                )}
              />
              {audio ? (
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone="success">201 Created</Badge>
                  <span className="min-w-0 truncate font-mono text-mono text-text-secondary">
                    id {audio.id}
                  </span>
                </div>
              ) : null}
            </Bubble>
          </MessageRow>
        );

      case "pending":
        return (
          <MessageRow
            key={message.id}
            tone="system"
            author="Sistema"
            timestamp={formatTimestamp(message.createdAt)}
            glyph="○"
          >
            <Bubble>
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 text-body text-text">Na fila para transcrição</span>
                <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">
                  Pending
                </span>
              </div>
            </Bubble>
          </MessageRow>
        );

      case "processing":
        return (
          <MessageRow
            key={message.id}
            tone="system"
            author="Sistema"
            timestamp={formatTimestamp(message.createdAt)}
            glyph="◐"
          >
            <Bubble variant="loading" accent="info">
              <div className="flex min-w-0 items-center gap-2">
                <LoadingGlyph tone="info" />
                <span className="min-w-0 text-body font-medium text-text">
                  Transcrevendo com Whisper tiny…
                </span>
                <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">
                  Processing
                </span>
              </div>
              <ProgressBar tone="info" label="Transcrição em andamento" />
              <span className="text-caption text-text-secondary">
                O servidor transcreve fora da requisição; o resumo chega nesta conversa.
              </span>
            </Bubble>
          </MessageRow>
        );

      case "completed":
        return (
          <MessageRow
            key={message.id}
            tone="summary"
            author="Resumo"
            timestamp={formatTimestamp(message.createdAt)}
            glyph="✓"
          >
            <Bubble variant="summary" accent="brand">
              <p className="text-body-lg text-text">{facts.text}</p>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge>{facts.language}</Badge>
                <span className="font-mono text-mono text-text-secondary">
                  {facts.length} / {facts.maxLength} caracteres
                </span>
                <span className="ml-auto text-caption text-text-secondary">
                  Whisper tiny · resumo extrativo
                </span>
              </div>
            </Bubble>
          </MessageRow>
        );

      case "failed":
        return (
          <MessageRow
            key={message.id}
            tone="error"
            author="Sistema"
            timestamp={formatTimestamp(message.createdAt)}
            glyph="✕"
          >
            <Bubble variant="error" accent="danger">
              <span className="text-body-lg font-semibold text-danger">
                Não foi possível transcrever este áudio
              </span>
              <p className="text-body text-text">{error}</p>
              <CodeLine>
                summaryStatus: &quot;Failed&quot;
                {error ? ` · ${error}` : null}
              </CodeLine>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={onRetry}>Tentar novamente</Button>
                <Button variant="ghost" onClick={onSendAnother}>
                  Enviar outro áudio
                </Button>
              </div>
            </Bubble>
          </MessageRow>
        );

      case "disabled":
        return (
          <MessageRow
            key={message.id}
            tone="system"
            author="Sistema"
            timestamp={formatTimestamp(message.createdAt)}
            glyph="○"
          >
            <Bubble>
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 text-body text-text">
                  Resumo desativado no servidor. O áudio foi armazenado.
                </span>
                <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">
                  Disabled
                </span>
              </div>
            </Bubble>
          </MessageRow>
        );

      default:
        return null;
    }
  }

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Transcrição"
      className={cn("flex h-full w-full flex-col gap-6", className)}
    >
      {phase === "idle" ? (
        <EmptyState
          headline="Nenhum áudio ainda"
          subline="Envie um arquivo no painel à direita. A transcrição aparece aqui, nesta conversa."
        />
      ) : (
        <>
          {messages.map(renderMessage)}
          {phase === "uploading" ? (
            <MessageRow tone="system" author="Sistema" timestamp="" glyph="↑">
              <Bubble variant="loading" accent="brand">
                <div className="flex min-w-0 items-center gap-2">
                  <LoadingGlyph tone="brand" />
                  <span className="min-w-0 text-body font-medium text-text">
                    Enviando áudio para POST /api/audios…
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">
                    {progress}%
                  </span>
                </div>
                <ProgressBar value={progress} tone="brand" label="Progresso do envio" />
                <span className="text-caption text-text-secondary">
                  O arquivo é enviado como multipart/form-data no campo <code>file</code>.
                </span>
              </Bubble>
            </MessageRow>
          ) : null}
        </>
      )}
    </div>
  );
}
