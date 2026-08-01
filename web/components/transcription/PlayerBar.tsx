"use client";

import { useEffect, useRef, useState } from "react";

import { Waveform } from "@/components/ui/Waveform";
import { cn } from "@/components/ui/cn";
import type { SelectedFile } from "@/lib/types";
import { formatClock } from "./format";

/**
 * {component.player-bar} + {component.player-card} — docs/DESIGN.md §7 Panel & Player.
 *
 * Playback-only, and it plays the **locally selected file** through `file.objectUrl`
 * (.claude/contexts/frontend/CONTEXT.md): no download round-trip, so the player works before the
 * server has finished anything. There is no download, export or share affordance (§8 Don't 7).
 *
 * This is the one composite besides the page that holds state — the media element's own clock.
 */
export interface PlayerBarProps {
  file: SelectedFile | null;
  className?: string;
}

export function PlayerBar({ file, className }: PlayerBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  // A new file is a new session for the player: rewind and stop.
  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
    setDuration(0);
  }, [file?.objectUrl]);

  const enabled = file !== null;
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

  return (
    <div
      className={cn(
        "flex h-21 shrink-0 items-center border-t border-hairline bg-canvas px-6",
        className,
      )}
    >
      <div
        className={cn(
          "flex w-full items-center gap-4 rounded-md border border-hairline p-3",
          enabled ? "bg-canvas" : "pointer-events-none bg-surface-muted opacity-55",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!enabled}
          aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
          // 38px {component.button-play}; off the 4px scale, a literal of §4 Component Metrics.
          style={{ width: "38px", height: "38px" }}
          className={cn(
            // The glyph is ink on both fills, per §8 Don't 1: white measures 3.12:1 on
            // {colors.brand.primary} and 1.56:1 on {colors.surface.hairline-strong} — the
            // disabled triangle was effectively invisible. Ink is 5.74:1 and 11.45:1.
            "flex shrink-0 items-center justify-center rounded-full text-label text-text",
            enabled ? "bg-brand" : "bg-hairline-strong",
          )}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>

        <span className="shrink-0 font-mono text-mono text-text-secondary">
          {formatClock(enabled ? elapsed : 0)}
        </span>

        <Waveform progress={progress} className="min-w-0 flex-1 overflow-hidden" />

        <span className="shrink-0 font-mono text-mono text-text-secondary">
          {formatClock(enabled ? duration : 0)}
        </span>

        {/* {component.chip-speed} — playback speed is fixed at 1x; the design lists no control. */}
        <span className="shrink-0 rounded-full border border-hairline bg-canvas px-2 py-1 font-mono text-mono text-text-secondary">
          1x
        </span>

        {file ? (
          <audio
            ref={audioRef}
            key={file.objectUrl}
            src={file.objectUrl}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              setDuration(Number.isFinite(value) ? value : 0);
            }}
            onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
        ) : null}
      </div>
    </div>
  );
}
