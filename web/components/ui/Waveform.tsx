import type { CSSProperties } from "react";
import { cn } from "./cn";

const MIN_BAR_HEIGHT = 6;
const MAX_BAR_HEIGHT = 24;

export function barHeight(index: number): number {
  const wave = (Math.sin(index * 0.7) + Math.sin(index * 0.23 + 1.1)) / 4 + 0.5;
  return Math.round(MIN_BAR_HEIGHT + wave * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT));
}

const BAR_STYLES_BY_COUNT = new Map<number, readonly CSSProperties[]>();

function barStyles(bars: number): readonly CSSProperties[] {
  const cached = BAR_STYLES_BY_COUNT.get(bars);
  if (cached) return cached;

  const styles = Array.from({ length: bars }, (_, index) => ({
    width: "3px",
    height: `${barHeight(index)}px`,
  }));
  BAR_STYLES_BY_COUNT.set(bars, styles);
  return styles;
}

export interface WaveformProps {
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
