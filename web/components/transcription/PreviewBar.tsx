"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Waveform } from "@/components/ui/Waveform";
import { CodeLine } from "@/components/ui/CodeLine";
import { cn } from "@/components/ui/cn";
import type { AudioFileDto } from "@/lib/types";
import { formatClock } from "./format";

export interface PreviewBarProps {
  audio: AudioFileDto;
  className?: string;
}

type Track = "original" | "filtered";

const TRACK_LABEL: Record<Track, string> = {
  original: "Original",
  filtered: "Com filtro",
};

/**
 * `{component.preview-bar}` (docs/DESIGN.md §7) — the per-item playback control mounted inside a
 * processed-audio message row. Two sources, the item's own bytes: "Original" is what
 * `GET /api/audios/{id}/download` already serves, "Com filtro" is the new filtered download,
 * gated on `filterStatus === "Completed"`. Never the locally selected file — that stays
 * `{component.player-bar}`'s job, unchanged.
 */
export function PreviewBar({ audio, className }: PreviewBarProps) {
  const reasonId = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<Track>("original");
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  const filterAvailable = audio.filterStatus === "Completed" && !!audio.filteredUrl;
  const src = track === "original" ? audio.url : (audio.filteredUrl ?? "");

  // Track switching swaps the <audio> source, pauses and resets elapsed to 0:00 — the same reset
  // {component.player-bar} already runs on a source change (docs/DESIGN.md §7, "Track switching").
  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
    setDuration(0);
  }, [src]);

  const progress = duration > 0 ? elapsed / duration : 0;

  function toggle() {
    const element = audioRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play();
      setPlaying(true);
    } else {
      element.pause();
      setPlaying(false);
    }
  }

  function selectTrack(next: Track) {
    if (next === "filtered" && !filterAvailable) return;
    setTrack(next);
  }

  function onSelectorKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next: Track = track === "original" ? "filtered" : "original";
    // Roving tabindex: a disabled "Com filtro" is skipped by arrow navigation, same as any
    // disabled radio in a native group.
    if (next === "filtered" && !filterAvailable) return;
    selectTrack(next);
  }

  const playLabel = `${playing ? "Pausar" : "Reproduzir"} áudio ${track === "original" ? "original" : "com filtro"}`;

  return (
    <div aria-live="off" className={cn("flex flex-col gap-1", className)}>
      <div className="flex w-full items-center gap-4 rounded-md border border-hairline bg-canvas p-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playLabel}
          style={{ width: "38px", height: "38px" }}
          className="flex shrink-0 items-center justify-center rounded-full bg-brand text-label text-text"
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <span className="shrink-0 font-mono text-mono text-text-secondary">
          {formatClock(elapsed)}
        </span>
        <Waveform progress={progress} className="min-w-0 flex-1 overflow-hidden" />
        <span className="shrink-0 font-mono text-mono text-text-secondary">
          {formatClock(duration)}
        </span>
        <div role="radiogroup" aria-label="Fonte de áudio" className="flex shrink-0 gap-1 rounded-full bg-surface-muted p-1">
          <button
            type="button"
            role="radio"
            aria-checked={track === "original"}
            tabIndex={track === "original" ? 0 : -1}
            onClick={() => selectTrack("original")}
            onKeyDown={onSelectorKeyDown}
            className={cn(
              "rounded-full px-3 py-1 text-label",
              track === "original" ? "bg-brand-soft text-brand-text" : "text-text-secondary",
            )}
          >
            {TRACK_LABEL.original}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={track === "filtered"}
            aria-disabled={!filterAvailable || undefined}
            aria-describedby={!filterAvailable ? reasonId : undefined}
            tabIndex={track === "filtered" ? 0 : -1}
            onClick={() => selectTrack("filtered")}
            onKeyDown={onSelectorKeyDown}
            className={cn(
              "rounded-full px-3 py-1 text-label",
              track === "filtered"
                ? "bg-brand-soft text-brand-text"
                : filterAvailable
                  ? "text-text-secondary"
                  : "cursor-not-allowed text-text-secondary opacity-55",
            )}
          >
            {TRACK_LABEL.filtered}
          </button>
        </div>
        <audio
          ref={audioRef}
          key={src}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            setDuration(Number.isFinite(value) ? value : 0);
          }}
          onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      </div>
      {!filterAvailable ? (
        <div id={reasonId} className="flex min-w-0 items-center gap-2 pl-1">
          {audio.filterStatus === "Failed" ? (
            <>
              <span className="text-caption text-text-secondary">Falha ao gerar o filtro</span>
              <CodeLine className="flex-1">
                {audio.filterError ?? "O servidor não informou o motivo."}
              </CodeLine>
            </>
          ) : (
            <>
              <span className="text-caption text-text-secondary">Filtro em processamento</span>
              <span className="ml-auto shrink-0 font-mono text-mono text-text-secondary">
                {audio.filterStatus}
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
