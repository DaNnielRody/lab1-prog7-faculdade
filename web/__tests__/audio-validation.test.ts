import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_AUDIO_SIZE_BYTES,
  validateAudioBytes,
  validateAudioFile,
} from "@/lib/audioValidation";
import {
  AUDIO_VALIDATION_MODE,
  WORKER_TIMEOUT_MS,
  validateAudioFileInBackground,
} from "@/lib/audioValidationClient";

const MP3_SIGNATURE = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
const WAV_SIGNATURE = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

function audioFile(
  contents: BlobPart = MP3_SIGNATURE,
  name = "aula.mp3",
  type = "audio/mpeg",
): File {
  return new File([contents], name, { type });
}

describe("validateAudioFile", () => {
  it("exposes a synchronous core for the sequential baseline", () => {
    expect(
      validateAudioBytes({
        name: "aula.mp3",
        type: "audio/mpeg",
        size: MP3_SIGNATURE.byteLength,
        bytes: MP3_SIGNATURE,
      }),
    ).toEqual({ valid: true });
  });

  it("accepts an audio whose extension, MIME type, size and signature agree", async () => {
    await expect(validateAudioFile(audioFile())).resolves.toEqual({ valid: true });
  });

  it.each([
    ["sample.wav", "audio/wav", WAV_SIGNATURE],
    ["sample.ogg", "audio/ogg", new Uint8Array([0x4f, 0x67, 0x67, 0x53])],
    ["sample.flac", "audio/flac", new Uint8Array([0x66, 0x4c, 0x61, 0x43])],
    [
      "sample.m4a",
      "audio/mp4",
      new Uint8Array([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
      ]),
    ],
    ["sample.aac", "audio/aac", new Uint8Array([0xff, 0xf1, 0x50, 0x80])],
    ["sample.webm", "audio/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
  ])("accepts the supported signature for %s", async (name, type, signature) => {
    await expect(validateAudioFile(audioFile(signature, name, type))).resolves.toEqual({
      valid: true,
    });
  });

  it("blocks an unsupported extension", async () => {
    const result = await validateAudioFile(audioFile(MP3_SIGNATURE, "anotacoes.txt"));

    expect(result).toEqual({
      valid: false,
      message: "A extensão .txt não é permitida. Use MP3, WAV, OGG, FLAC, M4A, AAC ou WEBM.",
    });
  });

  it("blocks a MIME type that is incompatible with the extension", async () => {
    const result = await validateAudioFile(audioFile(MP3_SIGNATURE, "aula.mp3", "text/plain"));

    expect(result).toEqual({
      valid: false,
      message: "O tipo do arquivo (text/plain) não é compatível com a extensão .mp3.",
    });
  });

  it("blocks an empty file", async () => {
    const result = await validateAudioFile(audioFile(new Uint8Array(), "vazio.mp3"));

    expect(result).toEqual({ valid: false, message: "O arquivo de áudio está vazio." });
  });

  it("blocks a file larger than 50 MB", async () => {
    const file = audioFile();
    Object.defineProperty(file, "size", { value: MAX_AUDIO_SIZE_BYTES + 1 });

    const result = await validateAudioFile(file);

    expect(result).toEqual({
      valid: false,
      message: "O arquivo excede o tamanho máximo de 50 MB.",
    });
  });

  it("blocks content whose magic bytes disagree with extension and MIME type", async () => {
    const result = await validateAudioFile(audioFile(WAV_SIGNATURE));

    expect(result).toEqual({
      valid: false,
      message: "O conteúdo do arquivo não corresponde a um áudio MP3 válido.",
    });
  });
});

describe("validateAudioFileInBackground", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses an asynchronous fallback when Web Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    let settled = false;

    const validation = validateAudioFileInBackground(audioFile()).then((result) => {
      settled = true;
      return result;
    });

    expect(settled).toBe(false);
    await expect(validation).resolves.toEqual({ valid: true });
  });

  it("supports an explicit sequential mode without constructing a Worker", async () => {
    const WorkerSpy = vi.fn();
    vi.stubGlobal("Worker", WorkerSpy);

    await expect(validateAudioFileInBackground(audioFile(), undefined, "sequential")).resolves.toEqual({
      valid: true,
    });
    expect(WorkerSpy).not.toHaveBeenCalled();
  });

  it("keeps parallel as the default configured mode", () => {
    expect(AUDIO_VALIDATION_MODE).toBe("parallel");
  });

  it("reports a Worker runtime failure and terminates it", async () => {
    class FailingWorker {
      static last: FailingWorker;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;
      terminate = vi.fn();

      constructor() {
        FailingWorker.last = this;
      }

      postMessage() {
        queueMicrotask(() => this.onerror?.(new ErrorEvent("error", { message: "boom" })));
      }
    }
    vi.stubGlobal("Worker", FailingWorker);

    await expect(validateAudioFileInBackground(audioFile())).rejects.toThrow(
      "O validador paralelo de áudio falhou. Selecione o arquivo novamente.",
    );
    expect(FailingWorker.last.terminate).toHaveBeenCalledOnce();
  });

  it("reports an internal validation failure returned by the Worker", async () => {
    class ErrorResponseWorker {
      static last: ErrorResponseWorker;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;
      terminate = vi.fn();

      constructor() {
        ErrorResponseWorker.last = this;
      }

      postMessage(message: { requestId: number }) {
        queueMicrotask(() =>
          this.onmessage?.(
            new MessageEvent("message", {
              data: { requestId: message.requestId, error: true },
            }),
          ),
        );
      }
    }
    vi.stubGlobal("Worker", ErrorResponseWorker);

    await expect(validateAudioFileInBackground(audioFile())).rejects.toThrow(
      "O validador paralelo de áudio falhou. Selecione o arquivo novamente.",
    );
    expect(ErrorResponseWorker.last.terminate).toHaveBeenCalledOnce();
  });

  it("times out and terminates a Worker that stops responding", async () => {
    class SilentWorker {
      static last: SilentWorker;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;
      terminate = vi.fn();

      constructor() {
        SilentWorker.last = this;
      }

      postMessage() {}
    }
    vi.stubGlobal("Worker", SilentWorker);
    vi.useFakeTimers();

    const validation = validateAudioFileInBackground(audioFile());
    const rejected = expect(validation).rejects.toThrow(
      "O validador paralelo de áudio falhou. Selecione o arquivo novamente.",
    );
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);

    await rejected;
    expect(SilentWorker.last.terminate).toHaveBeenCalledOnce();
  });
});
