import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL, ApiError, getSummary, uploadAudio } from "@/lib/api";
import type { AudioFileDto, AudioSummaryDto } from "@/lib/types";

/** Minimal XMLHttpRequest double: the test drives progress, load and error by hand. */
class FakeXhr {
  static instances: FakeXhr[] = [];

  method = "";
  url = "";
  status = 0;
  responseType = "";
  responseText = "";
  body: FormData | null = null;
  aborted = false;

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: FormData) {
    this.body = body;
    FakeXhr.instances.push(this);
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  /** Simulates a real bytes-sent progress event. */
  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.onload?.();
  }

  static last(): FakeXhr {
    const instance = FakeXhr.instances.at(-1);
    if (!instance) throw new Error("no XMLHttpRequest was sent");
    return instance;
  }
}

const audioFileDto: AudioFileDto = {
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  originalFileName: "aula.mp3",
  storedFileName: "3f2504e0.m4a",
  url: "http://localhost:5218/files/3f2504e0.m4a",
  contentType: "audio/mp4",
  sizeBytes: 1024,
  createdAtUtc: "2026-08-01T10:00:00Z",
  summaryStatus: "Pending",
};

const summaryDto: AudioSummaryDto = {
  id: audioFileDto.id,
  status: "Completed",
  summary: "Resumo curto do áudio.",
  summaryLength: 22,
  maxSummaryLength: 500,
  language: "pt",
  error: null,
  updatedAtUtc: "2026-08-01T10:00:30Z",
};

function makeFile(): File {
  return new File(["conteudo"], "aula.mp3", { type: "audio/mpeg" });
}

describe("uploadAudio", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts multipart/form-data to /api/audios with the field name 'file'", async () => {
    const promise = uploadAudio(makeFile());
    const xhr = FakeXhr.last();

    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(`${API_BASE_URL}/api/audios`);
    expect(xhr.body).toBeInstanceOf(FormData);
    expect(xhr.body?.get("file")).toBeInstanceOf(File);

    xhr.respond(201, JSON.stringify(audioFileDto));
    await expect(promise).resolves.toEqual(audioFileDto);
  });

  it("reports real upload percentages through onProgress", async () => {
    const onProgress = vi.fn();
    const promise = uploadAudio(makeFile(), { onProgress });
    const xhr = FakeXhr.last();

    xhr.emitProgress(0, 200);
    xhr.emitProgress(50, 200);
    xhr.emitProgress(200, 200);

    expect(onProgress.mock.calls.map(([percent]) => percent)).toEqual([0, 25, 100]);

    xhr.respond(201, JSON.stringify(audioFileDto));
    await promise;
  });

  it("ignores progress events that carry no computable length", async () => {
    const onProgress = vi.fn();
    const promise = uploadAudio(makeFile(), { onProgress });
    const xhr = FakeXhr.last();

    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 10, total: 0 } as ProgressEvent);
    expect(onProgress).not.toHaveBeenCalled();

    xhr.respond(201, JSON.stringify(audioFileDto));
    await promise;
  });

  it("maps 400 to an ApiError carrying the ProblemDetails validation message", async () => {
    const promise = uploadAudio(makeFile());
    FakeXhr.last().respond(
      400,
      JSON.stringify({
        title: "Arquivo inválido",
        detail: "A extensão .txt não é suportada.",
        status: 400,
      }),
    );

    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "A extensão .txt não é suportada.",
    });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });

  it("maps 422 to an ApiError carrying the decode failure message", async () => {
    const promise = uploadAudio(makeFile());
    FakeXhr.last().respond(
      422,
      JSON.stringify({
        title: "Falha ao processar áudio",
        detail:
          "Não foi possível comprimir o arquivo enviado para AAC. Verifique se o arquivo é um áudio válido.",
        status: 422,
      }),
    );

    await expect(promise).rejects.toMatchObject({
      status: 422,
      message:
        "Não foi possível comprimir o arquivo enviado para AAC. Verifique se o arquivo é um áudio válido.",
    });
  });

  it("never echoes the framework's English 500 body into the Portuguese UI", async () => {
    const promise = uploadAudio(makeFile());
    // Verbatim ASP.NET boilerplate: the exception handler writes valid ProblemDetails whose
    // detail is English and says nothing useful. Trusting it would leak it onto the screen.
    FakeXhr.last().respond(
      500,
      JSON.stringify({
        title: "An error occurred while processing your request.",
        detail: "An error occurred while processing your request.",
        status: 500,
      }),
    );

    const error = await promise.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).not.toContain("An error occurred");
    expect((error as ApiError).message).toBe(
      "O servidor não conseguiu processar este áudio. Tente novamente em instantes.",
    );
  });

  it("falls back to a Portuguese message when the error body is not ProblemDetails", async () => {
    const promise = uploadAudio(makeFile());
    FakeXhr.last().respond(500, "<html>boom</html>");

    const error = await promise.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toMatch(/servidor/i);
  });

  it("maps a network failure to an ApiError with status 0", async () => {
    const promise = uploadAudio(makeFile());
    FakeXhr.last().onerror?.();

    await expect(promise).rejects.toMatchObject({ status: 0 });
  });

  it("aborts the request when the signal fires", async () => {
    const controller = new AbortController();
    const promise = uploadAudio(makeFile(), { signal: controller.signal });
    const xhr = FakeXhr.last();

    controller.abort();

    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getSummary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the AudioSummaryDto", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(summaryDto),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSummary(summaryDto.id)).resolves.toEqual(summaryDto);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/audios/${summaryDto.id}/summary`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("maps 404 to an ApiError carrying the ProblemDetails detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({ title: "Áudio não encontrado", detail: "Nenhum áudio com esse id." }),
      }),
    );

    await expect(getSummary("missing")).rejects.toMatchObject({
      status: 404,
      message: "Nenhum áudio com esse id.",
    });
  });

  it("maps a rejected fetch to an ApiError with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(getSummary(summaryDto.id)).rejects.toBeInstanceOf(ApiError);
  });
});
