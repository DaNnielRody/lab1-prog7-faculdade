import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dropzone } from "@/components/ui/Dropzone";
import { FileCard } from "@/components/ui/FileCard";
import { Select } from "@/components/ui/Select";
import { Stepper, type Step, type StepState } from "@/components/ui/Stepper";
import { cn } from "@/components/ui/cn";
import type { Phase, SelectedFile } from "@/lib/types";
import { fileMeta } from "./format";

/**
 * {component.settings-panel} — docs/DESIGN.md §7 Panel & Player.
 * 320px muted surface with a left hairline. The field order is fixed by §7:
 * header → Áudio → Idioma → Resumo → Estado → spacer → CTA → helper line.
 */

/**
 * Presentational only. `POST /api/audios` takes a single `file` part and no language parameter
 * (src/AudioApi/Endpoints/AudioEndpoints.cs); the worker detects the language itself and returns
 * it in `summaryLanguage`. The control is here because docs/DESIGN.md §7 specifies the field, and
 * it is deliberately not wired to the request.
 */
const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Detectar automaticamente" },
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
];

/** Labels quote the API vocabulary verbatim — docs/DESIGN.md §7 {component.stepper}. */
const STEP_LABELS = [
  "Enviado",
  "Na fila (Pending)",
  "Transcrevendo (Processing)",
  "Concluído (Completed)",
] as const;

/**
 * One column per phase. `disabled` is spelled out in §7: "Enviado" done and the remaining steps
 * pending, with no active step — because the server stored the file and simply does not summarize.
 */
const STEP_STATES: Record<Phase, readonly StepState[]> = {
  idle: ["pending", "pending", "pending", "pending"],
  uploading: ["active", "pending", "pending", "pending"],
  pending: ["done", "active", "pending", "pending"],
  processing: ["done", "done", "active", "pending"],
  completed: ["done", "done", "done", "done"],
  failed: ["done", "done", "failed", "pending"],
  disabled: ["done", "pending", "pending", "pending"],
};

interface CtaSpec {
  label: string;
  loading: boolean;
  disabled: boolean;
}

function ctaFor(phase: Phase, hasFile: boolean): CtaSpec {
  switch (phase) {
    case "idle":
      return { label: "Transcrever", loading: false, disabled: !hasFile };
    case "uploading":
      return { label: "Enviando…", loading: true, disabled: false };
    // Waiting on the server, not sending bytes: docs/DESIGN.md §7 drops the fill to
    // {colors.surface.disabled} here — the button is no longer the thing making progress.
    case "pending":
    case "processing":
      return { label: "Transcrevendo…", loading: true, disabled: true };
    case "completed":
    case "disabled":
      return { label: "Enviar outro áudio", loading: false, disabled: false };
    case "failed":
      return { label: "Tentar novamente", loading: false, disabled: false };
  }
}

/** {type.caption} helper under the CTA — docs/DESIGN.md §7, centered and secondary. */
function helperFor(phase: Phase, hasFile: boolean): string {
  switch (phase) {
    case "idle":
      return hasFile
        ? "O arquivo é enviado para POST /api/audios e transcrito fora da requisição."
        : "Escolha um áudio de até 50 MB para começar.";
    case "uploading":
      return "Não feche a aba enquanto o envio estiver em andamento.";
    case "pending":
    case "processing":
      return "A transcrição roda no servidor; o resumo aparece na conversa assim que ficar pronto.";
    case "completed":
      return "O resumo tem no máximo 500 caracteres.";
    case "failed":
      return "O áudio continua armazenado no servidor.";
    case "disabled":
      return "O servidor está com a sumarização desativada.";
  }
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-overline font-semibold text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

export interface SettingsPanelProps {
  phase: Phase;
  file: SelectedFile | null;
  onSelectFile: (file: File) => void;
  onClearFile: () => void;
  onSubmit: () => void;
  className?: string;
}

export function SettingsPanel({
  phase,
  file,
  onSelectFile,
  onClearFile,
  onSubmit,
  className,
}: SettingsPanelProps) {
  const cta = ctaFor(phase, file !== null);
  const steps: Step[] = STEP_STATES[phase].map((state, index) => ({
    id: STEP_LABELS[index],
    label: STEP_LABELS[index],
    state,
  }));

  return (
    <aside
      aria-label="Configurações"
      className={cn(
        "flex w-panel shrink-0 flex-col gap-5 border-l border-hairline bg-surface-muted p-5",
        className,
      )}
    >
      <h2 className="text-heading font-semibold text-text">Configurações</h2>

      <FieldGroup label="ÁUDIO">
        {file ? (
          <FileCard
            name={file.name}
            meta={fileMeta(file.name, file.sizeBytes)}
            onDismiss={phase === "idle" ? onClearFile : undefined}
          />
        ) : (
          <Dropzone onFile={onSelectFile} disabled={phase === "uploading"} />
        )}
      </FieldGroup>

      <Select label="IDIOMA" options={LANGUAGE_OPTIONS} defaultValue="auto" />

      <FieldGroup label="RESUMO">
        <div className="flex flex-col gap-2 rounded-sm border border-hairline bg-canvas p-3">
          <div className="flex items-center gap-2">
            <span className="text-label font-medium text-text">Extrativo · Whisper tiny</span>
            <Badge tone="brand" className="ml-auto">
              máx. 500
            </Badge>
          </div>
          <span className="text-caption text-text-secondary">
            O servidor transcreve o áudio e devolve um resumo extrativo de até 500 caracteres.
          </span>
        </div>
      </FieldGroup>

      {/* "Estado" appears only once an upload exists — docs/DESIGN.md §7 field order. */}
      {phase === "idle" ? null : (
        <FieldGroup label="ESTADO">
          <Stepper steps={steps} />
        </FieldGroup>
      )}

      <div className="flex-1" />

      <div className="flex flex-col gap-3">
        <Button
          fullWidth
          loading={cta.loading}
          disabled={cta.disabled}
          onClick={onSubmit}
        >
          {cta.label}
        </Button>
        <span className="text-center text-caption text-text-secondary">
          {helperFor(phase, file !== null)}
        </span>
      </div>
    </aside>
  );
}
