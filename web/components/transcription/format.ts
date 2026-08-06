import type { AudioFileDto, AudioSummaryDto } from "@/lib/types";

export const DEFAULT_MAX_SUMMARY_LENGTH = 500;

export interface SummaryFacts {
  text: string;
  length: number;
  maxLength: number;

  language: string;
}

export function summaryFacts(
  summary: AudioSummaryDto | null,
  audio: AudioFileDto | null = null,
): SummaryFacts {
  const text = summary?.summary ?? audio?.summary ?? "";
  return {
    text,
    length: summary?.summaryLength ?? text.length,
    maxLength: summary?.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH,
    language: summary?.language ?? audio?.summaryLanguage ?? "—",
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace(".", ",")} KB`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "ÁUDIO";
  return name.slice(dot + 1).toUpperCase();
}

export function fileMeta(name: string, sizeBytes: number): string {
  return `${formatBytes(sizeBytes)} · ${fileExtension(name)}`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
