export type SummaryStatus = "Pending" | "Processing" | "Completed" | "Failed" | "Disabled";

export type ProcessingStatus = "Pending" | "Processing" | "Completed" | "Failed";

export type FilterStatus = "Pending" | "Processing" | "Completed" | "Failed";

export interface AudioFileDto {
  id: string;
  originalFileName: string;
  storedFileName: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  createdAtUtc: string;
  processingStatus?: ProcessingStatus;
  processingError?: string | null;
  processingUpdatedAtUtc?: string | null;
  summary?: string | null;
  summaryStatus: SummaryStatus;
  summaryLanguage?: string | null;
  summaryError?: string | null;
  summaryUpdatedAtUtc?: string | null;
  filterStatus?: FilterStatus;
  filterError?: string | null;
  filteredUrl?: string | null;
  filteredSizeBytes?: number | null;
  filteredContentType?: string | null;
}

export interface AudioSummaryDto {
  id: string;
  status: SummaryStatus;
  processingStatus?: ProcessingStatus;
  processingError?: string | null;
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
