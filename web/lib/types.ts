export type SummaryStatus = "Pending" | "Processing" | "Completed" | "Failed" | "Disabled";

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

export type Phase =
  | "idle"
  | "uploading"
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "disabled";

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
