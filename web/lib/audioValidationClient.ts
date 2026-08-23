import {
  validateAudioFile,
  type AudioValidationRequest,
  type AudioValidationResponse,
  type AudioValidationResult,
} from "@/lib/audioValidation";

export const WORKER_FAILURE_MESSAGE =
  "O validador paralelo de áudio falhou. Selecione o arquivo novamente.";
export const WORKER_TIMEOUT_MS = 10_000;

let nextRequestId = 0;

function abortError(): DOMException {
  return new DOMException("A validação do áudio foi cancelada.", "AbortError");
}

async function validateWithAsyncFallback(
  file: File,
  signal?: AbortSignal,
): Promise<AudioValidationResult> {
  await Promise.resolve();
  if (signal?.aborted) throw abortError();

  const result = await validateAudioFile(file);
  if (signal?.aborted) throw abortError();
  return result;
}

export function validateAudioFileInBackground(
  file: File,
  signal?: AbortSignal,
): Promise<AudioValidationResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === "undefined") return validateWithAsyncFallback(file, signal);

  let worker: Worker;
  try {
    worker = new Worker(new URL("../workers/audioValidation.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return validateWithAsyncFallback(file, signal);
  }

  const requestId = ++nextRequestId;

  return new Promise<AudioValidationResult>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      finish();
    };

    const onAbort = () => settle(() => reject(abortError()));

    worker.onmessage = (event: MessageEvent<AudioValidationResponse>) => {
      const response = event.data;
      if (response?.requestId !== requestId) return;
      if ("error" in response) {
        settle(() => reject(new Error(WORKER_FAILURE_MESSAGE)));
        return;
      }
      settle(() => resolve(response.result));
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault?.();
      settle(() => reject(new Error(WORKER_FAILURE_MESSAGE)));
    };
    worker.onmessageerror = () => {
      settle(() => reject(new Error(WORKER_FAILURE_MESSAGE)));
    };
    timeoutId = setTimeout(() => {
      settle(() => reject(new Error(WORKER_FAILURE_MESSAGE)));
    }, WORKER_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });

    const request: AudioValidationRequest = { requestId, file };
    try {
      worker.postMessage(request);
    } catch {
      settle(() => reject(new Error(WORKER_FAILURE_MESSAGE)));
    }
  });
}
