import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dropzone } from "@/components/ui/Dropzone";
import { FileCard } from "@/components/ui/FileCard";
import { Select } from "@/components/ui/Select";
import { Stepper, type Step, type StepState } from "@/components/ui/Stepper";
import { cn } from "@/components/ui/cn";
import type { AudioValidationState } from "@/lib/audioValidation";
import type { Phase, SelectedFile } from "@/lib/types";
import { fileMeta } from "./format";

const LANGUAGE_OPTIONS = [{ value: "auto", label: "Detectar automaticamente" }];

const STEP_LABELS = [
  "Enviado",
  "Na fila (Pending)",
  "Transcrevendo (Processing)",
  "Concluído (Completed)",
] as const;

const STEP_STATES: Record<Phase, readonly StepState[]> = {
  idle: ["pending", "pending", "pending", "pending"],
  uploading: ["active", "pending", "pending", "pending"],
  pending: ["done", "active", "pending", "pending"],
  processing: ["done", "done", "active", "pending"],
  completed: ["done", "done", "done", "done"],

  failed: ["done", "failed", "pending", "pending"],
  disabled: ["done", "pending", "pending", "pending"],
};

interface CtaSpec {
  label: string;
  loading: boolean;
  disabled: boolean;
}

/**
 * Returns null when the panel has no action of its own. On `failed` the only actions that make
 * sense are "Tentar novamente" and "Enviar outro áudio", and the thread's error bubble already
 * offers both, side by side, next to the message that explains the failure. A third copy down
 * here duplicated the accessible name of a control the user was already looking at.
 * (The Figma does draw a panel CTA on frame 05 — node 5:503 — so this is a deliberate departure.)
 */
function ctaFor(
  phase: Phase,
  hasFile: boolean,
  validation: AudioValidationState,
): CtaSpec | null {
  switch (phase) {
    case "idle": {
      if (validation.status === "validating") {
        return { label: "Validando áudio…", loading: true, disabled: true };
      }
      if (validation.status === "invalid" || validation.status === "error") {
        return { label: "Arquivo inválido", loading: false, disabled: true };
      }
      return {
        label: "Transcrever",
        loading: false,
        disabled: !hasFile || validation.status !== "valid",
      };
    }
    case "uploading":
      return { label: "Enviando…", loading: true, disabled: false };

    case "pending":
    case "processing":
      return { label: "Transcrevendo…", loading: true, disabled: true };
    case "completed":
    case "disabled":
      return { label: "Enviar outro áudio", loading: false, disabled: false };
    case "failed":
      return null;
  }
}

function helperFor(
  phase: Phase,
  hasFile: boolean,
  validation: AudioValidationState,
): string {
  switch (phase) {
    case "idle":
      if (validation.status === "validating") {
        return "A extensão, o tipo, o tamanho e a assinatura estão sendo verificados fora da interface.";
      }
      if (validation.status === "invalid" || validation.status === "error") {
        return "Remova o arquivo e selecione outro áudio para continuar.";
      }
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
  validation: AudioValidationState;
  onSelectFile: (file: File) => void;
  onClearFile: () => void;
  onSubmit: () => void;
  className?: string;
}

export function SettingsPanel({
  phase,
  file,
  validation,
  onSelectFile,
  onClearFile,
  onSubmit,
  className,
}: SettingsPanelProps) {
  const cta = ctaFor(phase, file !== null, validation);
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
          <>
            <FileCard
              name={file.name}
              meta={fileMeta(file.name, file.sizeBytes)}
              onDismiss={phase === "idle" ? onClearFile : undefined}
            />
            {validation.status === "validating" ? (
              <p className="text-caption text-text-secondary">
                Validando arquivo de áudio…
              </p>
            ) : null}
            {validation.status === "valid" ? (
              <p className="text-caption text-text-secondary">
                Arquivo validado e pronto para envio.
              </p>
            ) : null}
            {validation.status === "invalid" || validation.status === "error" ? (
              <p className="text-caption text-text-secondary">
                {validation.message}
              </p>
            ) : null}
          </>
        ) : (
          <Dropzone onFile={onSelectFile} disabled={phase === "uploading"} />
        )}
      </FieldGroup>
      <Select label="IDIOMA" options={LANGUAGE_OPTIONS} defaultValue="auto" disabled />
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
      {phase === "idle" ? null : (
        <FieldGroup label="ESTADO">
          <Stepper steps={steps} />
        </FieldGroup>
      )}

      <div className="flex-1" />
      <div className="flex flex-col gap-3">
        {cta ? (
          <Button
            fullWidth
            loading={cta.loading}
            disabled={cta.disabled}
            onClick={onSubmit}
          >
            {cta.label}
          </Button>
        ) : null}
        <span className="text-center text-caption text-text-secondary">
          {helperFor(phase, file !== null, validation)}
        </span>
      </div>
    </aside>
  );
}
