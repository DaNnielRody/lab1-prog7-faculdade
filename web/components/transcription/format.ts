/**
 * Formatting helpers shared by the transcription composites.
 * Copy is Portuguese (pt-BR); identifiers are English — docs/DESIGN.md §1.
 */

import type { AudioFileDto, AudioSummaryDto } from "@/lib/types";

/**
 * The ≤500-character ceiling is a domain invariant of the API (docs/DESIGN.md §1), so the UI shows
 * it rather than implying it. Used only as a fallback: whenever an `AudioSummaryDto` is available
 * its own `maxSummaryLength` wins, because the server is the authority.
 */
export const DEFAULT_MAX_SUMMARY_LENGTH = 500;

/** The four values every summary surface shows. */
export interface SummaryFacts {
  text: string;
  length: number;
  maxLength: number;
  /** "—" when nothing has reported a language yet; the API detects it, the client never guesses. */
  language: string;
}

/**
 * Resolves the summary surfaces' values from whichever source is furthest along. The poller's
 * `AudioSummaryDto` wins because the server is the authority; the upload's `AudioFileDto` covers
 * the paths that never poll; the constants are the last resort.
 * Shared so the thread bubble and the completion dialog can never disagree.
 */
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

/** "3,4 MB" — pt-BR decimal comma, as in the {type.caption} metadata line of §7. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace(".", ",")} KB`;
  return `${(kb / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** "WAV" — the uppercase extension, or "ÁUDIO" when the name carries none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "ÁUDIO";
  return name.slice(dot + 1).toUpperCase();
}

/**
 * "3,4 MB · WAV" — the file-card metadata line.
 * Duration is deliberately absent: only {component.player-bar} reads the audio's metadata, and
 * docs/DESIGN.md §8 Don't 4 forbids inventing values the client has not measured.
 */
export function fileMeta(name: string, sizeBytes: number): string {
  return `${formatBytes(sizeBytes)} · ${fileExtension(name)}`;
}

/** "0:04" — {type.mono} elapsed/duration clock of {component.player-card}. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/** "10:32" — the message-row timestamp. */
export function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
