"use client";

import { useRef, useState, type DragEvent } from "react";
import { Button } from "./Button";
import { cn } from "./cn";

/**
 * {component.dropzone} / {component.dropzone-dragover} — docs/DESIGN.md §7 Inputs & Forms.
 * The accepted extensions mirror the API's `Upload:AllowedExtensions`.
 */
export const ACCEPTED_EXTENSIONS = ".mp3,.wav,.ogg,.flac,.m4a,.aac,.webm";

export interface DropzoneProps {
  onFile: (file: File) => void;
  /** Helper line under the headline — extensions plus the size ceiling. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function Dropzone({
  onFile,
  hint = "MP3, WAV, OGG, FLAC, M4A, AAC ou WEBM · até 50 MB",
  disabled = false,
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function emit(file: File | undefined | null) {
    if (file) onFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    emit(event.dataTransfer.files?.[0]);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) setDragOver(true);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      data-dragover={dragOver || undefined}
      className={cn(
        "flex flex-col items-center gap-2 rounded-md border-dashed p-5 text-center",
        dragOver
          ? "border-2 border-brand bg-brand-soft"
          : "border border-hairline-strong bg-canvas",
        disabled && "opacity-55",
        className,
      )}
    >
      {/* 36px glyph circle — docs/DESIGN.md §7 dropzone. */}
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-body text-brand-text"
      >
        ↑
      </span>
      <span
        className={cn("text-body font-semibold", dragOver ? "text-brand-text" : "text-text")}
      >
        {dragOver ? "Solte o arquivo para enviar" : "Arraste um áudio aqui"}
      </span>
      <span className="text-caption text-text-secondary">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        aria-label="Escolher arquivo"
        tabIndex={-1}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          emit(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button variant="ghost" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Escolher arquivo
      </Button>
    </div>
  );
}
