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
  /**
   * Audios the server already holds, oldest first. They are rendered as ordinary messages above
   * the current session — this screen is a conversation, so an audio the server processed is a
   * message in it, not a second list with its own heading and borders.
   */
  processed: AudioFileDto[];
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
  processed,
  onRetry,
  onSendAnother,
  className,
}: ThreadProps) {
  const facts = summaryFacts(summary, audio);

  /**
   * One processed audio = one message in the conversation. Mirrors the Figma "Chat body"
   * (node 5:47), which contains only messages — there is no list, no section heading and no
   * bordered card anywhere in the design.
   */
  function renderProcessed(item: AudioFileDto) {
    const at = formatTimestamp(new Date(item.createdAtUtc).getTime());
    const name = item.originalFileName;

    if (item.processingStatus === "Pending" || item.processingStatus === "Processing") {
      return (
        <MessageRow key={item.id} timestamp={at} tone="system" author="Sistema" glyph="○">
          <Bubble>
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-body text-text">
                {name} — {item.processingStatus === "Processing" ? "comprimindo" : "na fila para compressão"}
              </span>
              <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">
                {item.processingStatus}
              </span>
            </div>
          </Bubble>
        </MessageRow>
      );
    }

    if (item.processingStatus === "Failed") {
      return (
        <MessageRow key={item.id} timestamp={at} tone="error" author="Sistema" glyph="✕">
          <Bubble variant="error" accent="danger">
            <span className="text-body font-semibold text-danger">
              Não foi possível comprimir {name}
            </span>
            <CodeLine>{item.processingError ?? "O servidor não informou o motivo."}</CodeLine>
          </Bubble>
        </MessageRow>
      );
    }

    if (item.summaryStatus === "Completed") {
      const past = summaryFacts(null, item);
      return (
        <MessageRow key={item.id} timestamp={at} tone="summary" author="Resumo" glyph="✓">
          <Bubble variant="summary" accent="brand">
            <span className="min-w-0 truncate text-label font-semibold text-text">{name}</span>
            <p className="text-body-lg text-text">{past.text}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge>{past.language}</Badge>
              <span className="font-mono text-mono text-text-secondary">
                {past.length} / {past.maxLength} caracteres
              </span>
            </div>
          </Bubble>
        </MessageRow>
      );
    }

    if (item.summaryStatus === "Failed") {
      return (
        <MessageRow key={item.id} timestamp={at} tone="error" author="Sistema" glyph="✕">
          <Bubble variant="error" accent="danger">
            <span className="text-body font-semibold text-danger">
              Não foi possível resumir {name}
            </span>
            <CodeLine>{item.summaryError ?? "O servidor não informou o motivo."}</CodeLine>
          </Bubble>
        </MessageRow>
      );
    }

    // Disabled, or still queued for the summary worker — neutral either way.
    return (
      <MessageRow key={item.id} timestamp={at} tone="system" author="Sistema" glyph="○">
        <Bubble>
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-body text-text">
              {name} —{" "}
              {item.summaryStatus === "Disabled"
                ? "armazenado, resumo desativado no servidor"
                : "aguardando o resumo"}
            </span>
            <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">
              {item.summaryStatus}
            </span>
          </div>
        </Bubble>
      </MessageRow>
    );
  }

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
              {/* Figma "actions" (5:527): both controls are 35px — button-primary-sm next to
                  button-ghost-sm. A default-size primary here is taller than its neighbour. */}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={onRetry}>
                  Tentar novamente
                </Button>
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
      {/* The empty state is only true when the conversation is genuinely empty — no session AND
          no history. Rendering it above a list of audios is how the screen ended up contradicting
          itself. */}
      {phase === "idle" && processed.length === 0 ? (
        <EmptyState
          headline="Nenhum áudio ainda"
          subline="Envie um arquivo no painel à direita. A transcrição aparece aqui, nesta conversa."
        />
      ) : (
        <>
          {processed.map(renderProcessed)}
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
