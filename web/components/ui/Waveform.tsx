import type { CSSProperties } from "react";
import { cn } from "./cn";

/**
 * {component.waveform} — docs/DESIGN.md §7 Panel & Player.
 * 72 bars, 3px wide, heights 6–24px, {spacing.1} gap; played bars {colors.brand.primary},
 * unplayed {colors.surface.hairline-strong}.
 *
 * Heights are derived from the bar index, never randomized: §7 forbids re-randomizing the bar
 * set between renders of the same file, and §11 records that the API exposes no peak data.
 */
const MIN_BAR_HEIGHT = 6;
const MAX_BAR_HEIGHT = 24;

export function barHeight(index: number): number {
  // Two out-of-phase sine terms give a plausible, fully deterministic envelope.
  const wave = (Math.sin(index * 0.7) + Math.sin(index * 0.23 + 1.1)) / 4 + 0.5;
  return Math.round(MIN_BAR_HEIGHT + wave * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT));
}

/**
 * The geometry depends on the bar count alone, never on `progress`. The player re-renders on every
 * `timeupdate` (~4×/s), so computing it inline would re-run 144 `Math.sin` calls and allocate 72
 * style objects per tick for a result that cannot have changed. Cached per count instead — the
 * screen uses one count, and the entries are immutable.
 */
const BAR_STYLES_BY_COUNT = new Map<number, readonly CSSProperties[]>();

function barStyles(bars: number): readonly CSSProperties[] {
  const cached = BAR_STYLES_BY_COUNT.get(bars);
  if (cached) return cached;
  // 3px width and 6–24px heights are literals of docs/DESIGN.md §7, off the 4px scale.
  const styles = Array.from({ length: bars }, (_, index) => ({
    width: "3px",
    height: `${barHeight(index)}px`,
  }));
  BAR_STYLES_BY_COUNT.set(bars, styles);
  return styles;
}

export interface WaveformProps {
  /** 0..1 — the played fraction of the audio. */
  progress: number;
  bars?: number;
  className?: string;
}

export function Waveform({ progress, bars = 72, className }: WaveformProps) {
  const played = Math.min(1, Math.max(0, progress)) * bars;

  return (
    <div aria-hidden="true" className={cn("flex h-6 items-center gap-1", className)}>
      {barStyles(bars).map((style, index) => (
        <span
          key={index}
          style={style}
          className={cn(
            "shrink-0 rounded-full",
            index < played ? "bg-brand" : "bg-hairline-strong",
          )}
        />
      ))}
    </div>
  );
}
