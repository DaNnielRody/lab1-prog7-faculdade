/**
 * TypeScript mirrors of the AudioApi DTOs.
 * Source of truth: src/AudioApi/Dtos/AudioFileDto.cs and src/AudioApi/Dtos/AudioSummaryDto.cs.
 * Keep the shapes in sync — this file is the only place the wire format is described.
 */

/** Mirrors src/AudioApi/Models/SummaryStatus.cs. */
export type SummaryStatus = "Pending" | "Processing" | "Completed" | "Failed" | "Disabled";

/** Mirrors AudioFileDto — the 201 Created body of POST /api/audios. */
export interface AudioFileDto {
  id: string;
  originalFileName: string;
  storedFileName: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  createdAtUtc: string;
  summary?: string | null;
  summaryStatus: SummaryStatus;
  summaryLanguage?: string | null;
  summaryError?: string | null;
  summaryUpdatedAtUtc?: string | null;
}

/** Mirrors AudioSummaryDto — the body of GET /api/audios/{id}/summary. */
export interface AudioSummaryDto {
  id: string;
  status: SummaryStatus;
  summary?: string | null;
  summaryLength: number;
  maxSummaryLength: number;
  language?: string | null;
  error?: string | null;
  updatedAtUtc?: string | null;
}

/**
 * The client's own state, wider than SummaryStatus: `idle` and `uploading` exist only in the
 * browser, because the server knows nothing about the file until the POST lands.
 * See .claude/contexts/frontend/CONTEXT.md → "Phase".
 */
export type Phase =
  | "idle"
  | "uploading"
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "disabled";

/** One appended entry in the thread. Append-only within a session. */
export interface ThreadMessage {
  id: string;
  author: "user" | "system" | "summary";
  phase: Phase;
  createdAt: number;
}

export interface SelectedFile {
  file: File;
  name: string;
  sizeBytes: number;
  objectUrl: string;
}
