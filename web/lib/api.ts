import type { AudioFileDto, AudioSummaryDto } from "@/lib/types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5218";

interface ProblemDetails {
  title?: string | null;
  detail?: string | null;
  status?: number | null;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const GENERIC_ERROR =
  "Não foi possível falar com o servidor. Verifique se a API está no ar e tente novamente.";
const DECODE_ERROR =
  "Não foi possível decodificar o áudio enviado. Verifique se o arquivo é um áudio válido.";
const VALIDATION_ERROR = "Arquivo inválido. Verifique o formato e o tamanho do áudio.";
const ABORT_ERROR = "O envio foi cancelado.";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseProblemDetails(body: string): ProblemDetails | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object") {
      return parsed as ProblemDetails;
    }
  } catch {
  }
  return null;
}

const SERVER_ERROR =
  "O servidor não conseguiu processar este áudio. Tente novamente em instantes.";

function messageForStatus(status: number, body: string): string {
  if (status >= 500) return SERVER_ERROR;

  const problem = parseProblemDetails(body);

  const fromBody = asText(problem?.detail) || asText(problem?.title);
  if (fromBody) return fromBody;

  if (status === 400) return VALIDATION_ERROR;
  if (status === 422) return DECODE_ERROR;
  return GENERIC_ERROR;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export function uploadAudio(file: File, opts: UploadOptions = {}): Promise<AudioFileDto> {
  const { onProgress, signal } = opts;

  return new Promise<AudioFileDto>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError(ABORT_ERROR, 0));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/audios`);
    xhr.responseType = "text";

    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);

    const settle = (finish: () => void) => {
      signal?.removeEventListener("abort", onAbort);
      finish();
    };

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (!event.lengthComputable || event.total <= 0) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(Math.min(100, Math.max(0, percent)));
      };
    }

    xhr.onload = () => {
      const body = typeof xhr.responseText === "string" ? xhr.responseText : "";
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          settle(() => resolve(JSON.parse(body) as AudioFileDto));
        } catch {
          settle(() => reject(new ApiError(GENERIC_ERROR, xhr.status)));
        }
        return;
      }
      settle(() => reject(new ApiError(messageForStatus(xhr.status, body), xhr.status)));
    };

    xhr.onerror = () => settle(() => reject(new ApiError(GENERIC_ERROR, 0)));
    xhr.ontimeout = () => settle(() => reject(new ApiError(GENERIC_ERROR, 0)));
    xhr.onabort = () => settle(() => reject(new ApiError(ABORT_ERROR, 0)));

    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export async function getSummary(id: string, signal?: AbortSignal): Promise<AudioSummaryDto> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/audios/${id}/summary`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(GENERIC_ERROR, 0);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new ApiError(messageForStatus(response.status, body), response.status);
  }

  try {
    return JSON.parse(body) as AudioSummaryDto;
  } catch {
    throw new ApiError(GENERIC_ERROR, response.status);
  }
}
