import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip, type ChipVariant } from "@/components/ui/Chip";
import { CodeLine } from "@/components/ui/CodeLine";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/components/ui/cn";
import type { AudioFileDto, Phase } from "@/lib/types";
import { isNonTerminalAudio } from "@/lib/useProcessedAudios";
import { fileExtension, formatBytes, summaryFacts } from "./format";

const SECTION_CLASS =
  "mt-12 flex w-full max-w-bubble flex-col gap-4 border-t border-hairline pt-4 md:pt-8";
const HEADING_ID = "processed-heading";
const SECTION_TITLE = "Áudios processados";
const MISSING_REASON = "O servidor não informou o motivo.";

type ProcessedVariant =
  | "compressing"
  | "summarizing"
  | "summary"
  | "failed-processing"
  | "failed-summary"
  | "disabled";

/** Precedence is normative: compression is strictly upstream of summarization. */
function processedVariant(audio: AudioFileDto): ProcessedVariant {
  const processing = audio.processingStatus;
  if (processing === "Pending" || processing === "Processing") return "compressing";
  if (processing === "Failed") return "failed-processing";

  switch (audio.summaryStatus) {
    case "Disabled":
      return "disabled";
    case "Pending":
    case "Processing":
      return "summarizing";
    case "Completed":
      return "summary";
    case "Failed":
      return "failed-summary";
    default:
      return "summarizing";
  }
}

const SURFACE: Record<ProcessedVariant, string> = {
  compressing: "bg-surface-muted border-hairline",
  summarizing: "bg-surface-muted border-hairline",
  summary: "bg-canvas border-hairline",
  "failed-processing": "bg-danger-soft border-danger-border",
  "failed-summary": "bg-danger-soft border-danger-border",
  disabled: "bg-surface-muted border-hairline",
};

const RAIL: Record<ProcessedVariant, string> = {
  compressing: "border-l-info",
  summarizing: "border-l-info",
  summary: "border-l-brand",
  "failed-processing": "border-l-danger",
  "failed-summary": "border-l-danger",
  disabled: "border-l-transparent",
};

const CHIP: Record<ProcessedVariant, ChipVariant> = {
  compressing: "compressing",
  summarizing: "summarizing",
  summary: "completed",
  "failed-processing": "failed",
  "failed-summary": "failed",
  disabled: "disabled",
};

const COMPRESSING_LINE = {
  Pending: "Na fila para compressão",
  Processing: "Comprimindo o áudio no servidor…",
} as const;

const SUMMARIZING_LINE = {
  Pending: "Na fila para transcrição",
  Processing: "Transcrevendo com Whisper tiny…",
} as const;

function formatCreatedAt(createdAtUtc: string): string {
  return new Date(createdAtUtc).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "áudio" : "áudios"}`;
}

function WorkingRow({ glyph, line, status }: { glyph: string; line: string; status: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-info-soft text-mono text-info"
      >
        {glyph}
      </span>
      <span className="min-w-0 text-body font-medium text-text">{line}</span>
      <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">{status}</span>
    </div>
  );
}

function FailedBody({ title, reason }: { title: string; reason: string }) {
  return (
    <>
      <span className="text-body font-semibold text-danger">{title}</span>
      <CodeLine>{reason}</CodeLine>
    </>
  );
}

function SummaryBody({ audio }: { audio: AudioFileDto }) {
  const facts = summaryFacts(null, audio);
  if (!facts.text) {
    return (
      <span className="text-body text-text-secondary">O servidor concluiu o resumo sem texto.</span>
    );
  }
  return (
    <>
      <p className="text-body-lg text-text">{facts.text}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge>{facts.language}</Badge>
        <span className="font-mono text-mono text-text-secondary">
          {facts.length} / {facts.maxLength} caracteres
        </span>
      </div>
    </>
  );
}

function CardBody({ audio, variant }: { audio: AudioFileDto; variant: ProcessedVariant }) {
  switch (variant) {
    case "compressing": {
      const step = audio.processingStatus === "Processing" ? "Processing" : "Pending";
      return (
        <WorkingRow
          glyph={step === "Processing" ? "◐" : "○"}
          line={COMPRESSING_LINE[step]}
          status={step}
        />
      );
    }

    case "summarizing": {
      const step = audio.summaryStatus === "Processing" ? "Processing" : "Pending";
      return (
        <WorkingRow
          glyph={step === "Processing" ? "◐" : "○"}
          line={SUMMARIZING_LINE[step]}
          status={step}
        />
      );
    }

    case "summary":
      return <SummaryBody audio={audio} />;

    case "failed-processing":
      return (
        <FailedBody
          title="Não foi possível comprimir este áudio"
          reason={audio.processingError ?? MISSING_REASON}
        />
      );

    case "failed-summary":
      return (
        <FailedBody
          title="Não foi possível resumir este áudio"
          reason={audio.summaryError ?? MISSING_REASON}
        />
      );

    case "disabled":
      return (
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 text-body text-text">
            Resumo desativado no servidor. O áudio foi armazenado.
          </span>
          <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">Disabled</span>
        </div>
      );
  }
}

function ProcessedCard({ audio }: { audio: AudioFileDto }) {
  const variant = processedVariant(audio);
  const meta = `${formatBytes(audio.sizeBytes)} · ${fileExtension(audio.originalFileName)} · ${formatCreatedAt(audio.createdAtUtc)}`;

  return (
    <article
      style={{ borderLeftWidth: "3px" }}
      className={cn(
        "flex w-full flex-col gap-2 rounded-md border px-4 py-3",
        SURFACE[variant],
        RAIL[variant],
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          style={{ width: "34px", height: "34px" }}
          className="flex shrink-0 items-center justify-center rounded-sm bg-brand-soft text-label text-brand-text"
        >
          ♪
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate text-label font-semibold text-text">
            {audio.originalFileName}
          </span>
          <span className="truncate text-caption text-text-secondary">{meta}</span>
        </span>
        <Chip variant={CHIP[variant]} className="ml-auto shrink-0" />
      </div>
      <CardBody audio={audio} variant={variant} />
    </article>
  );
}

export interface ProcessedListProps {
  audios: AudioFileDto[];
  loading: boolean;
  error: string | null;
  phase: Phase;
  onReload: () => void;
  className?: string;
}

export function ProcessedList({
  audios,
  loading,
  error,
  phase,
  onReload,
  className,
}: ProcessedListProps) {
  if (audios.length === 0) {
    if (loading) {
      return (
        <section aria-label={SECTION_TITLE} className={cn(SECTION_CLASS, className)}>
          <span aria-busy="true" className="text-body text-text-secondary">
            Carregando áudios processados…
          </span>
        </section>
      );
    }

    if (error) {
      return (
        <section aria-label={SECTION_TITLE} className={cn(SECTION_CLASS, className)}>
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-danger-border bg-danger-soft px-4 py-3"
          >
            <span className="text-body text-text">
              Não foi possível carregar a lista de áudios.
            </span>
            <Button variant="ghost" onClick={onReload} className="self-start">
              Tentar novamente
            </Button>
          </div>
        </section>
      );
    }

    // The thread's own empty state already owns the screen; two stacked empty states is a bug.
    if (phase === "idle") return null;
  }

  return (
    <section aria-labelledby={HEADING_ID} className={cn(SECTION_CLASS, className)}>
      <div className="flex items-center gap-2">
        <h2 id={HEADING_ID} className="text-heading font-semibold text-text">
          {SECTION_TITLE}
        </h2>
        <Badge tone="neutral">{countLabel(audios.length)}</Badge>
      </div>
      {audios.length === 0 ? (
        <EmptyState
          headline="Nenhum áudio processado"
          subline="Os áudios enviados ao servidor aparecem aqui, cada um com o seu resumo."
        />
      ) : (
        <ul role="list" aria-live="polite" aria-atomic="false" className="flex flex-col gap-3">
          {audios.map((audio) => (
            <li key={audio.id} aria-busy={isNonTerminalAudio(audio)}>
              <ProcessedCard audio={audio} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
