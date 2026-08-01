import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, getSummary, uploadAudio } from "@/lib/api";
import { POLL_INTERVAL_MS, useTranscription } from "@/lib/useTranscription";
import type { AudioFileDto, AudioSummaryDto, SummaryStatus } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, uploadAudio: vi.fn(), getSummary: vi.fn() };
});

const uploadAudioMock = vi.mocked(uploadAudio);
const getSummaryMock = vi.mocked(getSummary);

const AUDIO_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function audioDto(summaryStatus: SummaryStatus, overrides: Partial<AudioFileDto> = {}): AudioFileDto {
  return {
    id: AUDIO_ID,
    originalFileName: "aula.mp3",
    storedFileName: "aula.m4a",
    url: "http://localhost:5218/files/aula.m4a",
    contentType: "audio/mp4",
    sizeBytes: 2048,
    createdAtUtc: "2026-08-01T10:00:00Z",
    summaryStatus,
    ...overrides,
  };
}

function summaryDto(status: SummaryStatus, overrides: Partial<AudioSummaryDto> = {}): AudioSummaryDto {
  return {
    id: AUDIO_ID,
    status,
    summary: status === "Completed" ? "Resumo do áudio." : null,
    summaryLength: status === "Completed" ? 16 : 0,
    maxSummaryLength: 500,
    language: "pt",
    error: null,
    updatedAtUtc: "2026-08-01T10:00:10Z",
    ...overrides,
  };
}

const file = () => new File(["conteudo"], "aula.mp3", { type: "audio/mpeg" });

async function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
  }
}

async function startWithFile(result: { current: ReturnType<typeof useTranscription> }) {
  act(() => result.current.selectFile(file()));
  await act(async () => {
    await result.current.start();
  });
}

describe("useTranscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    uploadAudioMock.mockReset();
    getSummaryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("walks idle → uploading → pending → processing → completed", async () => {
    const seenPhases: string[] = [];
    uploadAudioMock.mockImplementation(async (_file, opts) => {
      opts?.onProgress?.(40);
      opts?.onProgress?.(100);
      return audioDto("Pending");
    });
    getSummaryMock
      .mockResolvedValueOnce(summaryDto("Processing"))
      .mockResolvedValue(summaryDto("Completed"));

    const { result } = renderHook(() => useTranscription());
    expect(result.current.phase).toBe("idle");

    act(() => result.current.selectFile(file()));
    expect(result.current.file?.name).toBe("aula.mp3");

    const started = act(async () => {
      await result.current.start();
    });
    await started;

    expect(result.current.audio?.id).toBe(AUDIO_ID);
    expect(result.current.progress).toBe(100);
    expect(result.current.phase).toBe("pending");

    await tick();
    expect(result.current.phase).toBe("processing");

    await tick();
    expect(result.current.phase).toBe("completed");
    expect(result.current.summary?.summary).toBe("Resumo do áudio.");
    expect(result.current.error).toBeNull();

    seenPhases.push(...result.current.messages.map((message) => message.phase));
    expect(seenPhases).toEqual(["uploading", "pending", "processing", "completed"]);
  });

  it("shows the loading phase with real progress while the upload is in flight", async () => {
    let resolveUpload: ((dto: AudioFileDto) => void) | undefined;
    uploadAudioMock.mockImplementation(
      (_file, opts) =>
        new Promise<AudioFileDto>((resolve) => {
          opts?.onProgress?.(35);
          resolveUpload = resolve;
        }),
    );

    const { result } = renderHook(() => useTranscription());
    act(() => result.current.selectFile(file()));

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.start();
    });

    expect(result.current.phase).toBe("uploading");
    expect(result.current.progress).toBe(35);

    await act(async () => {
      resolveUpload?.(audioDto("Disabled"));
      await pending;
    });

    expect(result.current.phase).toBe("disabled");
  });

  it("never starts the poller when the API answers Disabled", async () => {
    uploadAudioMock.mockResolvedValue(audioDto("Disabled"));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);

    expect(result.current.phase).toBe("disabled");
    expect(result.current.error).toBeNull();

    await tick(3);
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  it("surfaces the error message when the polled status is Failed", async () => {
    uploadAudioMock.mockResolvedValue(audioDto("Pending"));
    getSummaryMock.mockResolvedValue(
      summaryDto("Failed", { error: "O modelo não conseguiu transcrever o áudio." }),
    );

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);
    await tick();

    expect(result.current.phase).toBe("failed");
    expect(result.current.error).toBe("O modelo não conseguiu transcrever o áudio.");
  });

  it("fails the phase when the upload itself rejects", async () => {
    uploadAudioMock.mockRejectedValue(new ApiError("A extensão .txt não é suportada.", 400));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);

    expect(result.current.phase).toBe("failed");
    expect(result.current.error).toBe("A extensão .txt não é suportada.");
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  it("stops the poller once a terminal phase is reached", async () => {
    uploadAudioMock.mockResolvedValue(audioDto("Pending"));
    getSummaryMock.mockResolvedValue(summaryDto("Completed"));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);

    await tick();
    expect(result.current.phase).toBe("completed");
    expect(getSummaryMock).toHaveBeenCalledTimes(1);

    await tick(5);
    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("clears the interval on unmount", async () => {
    uploadAudioMock.mockResolvedValue(audioDto("Pending"));
    getSummaryMock.mockResolvedValue(summaryDto("Processing"));

    const { result, unmount } = renderHook(() => useTranscription());
    await startWithFile(result);

    await tick();
    expect(getSummaryMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(getSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a message when the same phase is polled twice", async () => {
    uploadAudioMock.mockResolvedValue(audioDto("Pending"));
    getSummaryMock.mockResolvedValue(summaryDto("Processing"));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);

    await tick(3);

    expect(getSummaryMock).toHaveBeenCalledTimes(3);
    expect(result.current.messages.map((message) => message.phase)).toEqual([
      "uploading",
      "pending",
      "processing",
    ]);
  });

  it("fails with a timeout message after the 5-minute ceiling", async () => {
    uploadAudioMock.mockResolvedValue(audioDto("Pending"));
    getSummaryMock.mockResolvedValue(summaryDto("Processing"));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000);
    });

    expect(result.current.phase).toBe("failed");
    expect(result.current.error).toMatch(/5 minutos/);
    expect(getSummaryMock).toHaveBeenCalledTimes(150);
  });

  it("re-polls on retry when the audio already exists", async () => {
    uploadAudioMock.mockResolvedValue(audioDto("Pending"));
    getSummaryMock
      .mockResolvedValueOnce(summaryDto("Failed", { error: "Falha temporária." }))
      .mockResolvedValue(summaryDto("Completed"));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);
    await tick();
    expect(result.current.phase).toBe("failed");

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.phase).toBe("pending");
    expect(uploadAudioMock).toHaveBeenCalledTimes(1);

    await tick();
    expect(result.current.phase).toBe("completed");
  });

  it("re-uploads on retry when no audio exists yet", async () => {
    uploadAudioMock
      .mockRejectedValueOnce(new ApiError("Falha de rede.", 0))
      .mockResolvedValue(audioDto("Disabled"));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);
    expect(result.current.phase).toBe("failed");

    await act(async () => {
      await result.current.retry();
    });

    expect(uploadAudioMock).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("disabled");
  });

  it("reset() returns to idle, revokes the object URL and stops the poller", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    uploadAudioMock.mockResolvedValue(audioDto("Pending"));
    getSummaryMock.mockResolvedValue(summaryDto("Processing"));

    const { result } = renderHook(() => useTranscription());
    await startWithFile(result);
    await tick();

    const callsBeforeReset = getSummaryMock.mock.calls.length;
    act(() => result.current.reset());

    expect(result.current.phase).toBe("idle");
    expect(result.current.file).toBeNull();
    expect(result.current.audio).toBeNull();
    expect(result.current.summary).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.progress).toBe(0);
    expect(result.current.messages).toEqual([]);
    expect(revoke).toHaveBeenCalled();

    await tick(3);
    expect(getSummaryMock).toHaveBeenCalledTimes(callsBeforeReset);

    revoke.mockRestore();
  });

  it("clearFile() drops the selection and revokes its object URL", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { result } = renderHook(() => useTranscription());

    act(() => result.current.selectFile(file()));
    expect(result.current.file).not.toBeNull();

    act(() => result.current.clearFile());
    expect(result.current.file).toBeNull();
    expect(revoke).toHaveBeenCalled();

    revoke.mockRestore();
  });

  it("refuses to start without a selected file", async () => {
    const { result } = renderHook(() => useTranscription());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.phase).toBe("failed");
    expect(result.current.error).toMatch(/Selecione um arquivo/);
    expect(uploadAudioMock).not.toHaveBeenCalled();
  });

  describe("a session that ended never comes back", () => {
    it("drops an upload that resolves after reset()", async () => {
      let release!: (dto: AudioFileDto) => void;
      uploadAudioMock.mockImplementation(
        () => new Promise<AudioFileDto>((resolve) => { release = resolve; }),
      );
      getSummaryMock.mockResolvedValue(summaryDto("Processing"));

      const { result } = renderHook(() => useTranscription());
      act(() => result.current.selectFile(file()));
      let started!: Promise<void>;
      await act(async () => { started = result.current.start(); });
      expect(result.current.phase).toBe("uploading");

      act(() => result.current.reset());
      expect(result.current.phase).toBe("idle");

      await act(async () => { release(audioDto("Pending")); await started; });

      expect(result.current.phase).toBe("idle");
      expect(result.current.audio).toBeNull();
      expect(result.current.messages).toHaveLength(0);

      await tick(3);
      expect(getSummaryMock).not.toHaveBeenCalled();
    });

    it("never starts a poller when the upload resolves after unmount", async () => {
      let release!: (dto: AudioFileDto) => void;
      uploadAudioMock.mockImplementation(
        () => new Promise<AudioFileDto>((resolve) => { release = resolve; }),
      );
      getSummaryMock.mockResolvedValue(summaryDto("Processing"));

      const { result, unmount } = renderHook(() => useTranscription());
      act(() => result.current.selectFile(file()));
      let started!: Promise<void>;
      await act(async () => { started = result.current.start(); });

      unmount();
      await act(async () => { release(audioDto("Pending")); await started; });
      await tick(5);

      expect(getSummaryMock).not.toHaveBeenCalled();
    });

    it("ignores a poll response belonging to a previous session", async () => {
      let releaseSummary!: (dto: AudioSummaryDto) => void;
      uploadAudioMock.mockResolvedValue(audioDto("Pending"));
      getSummaryMock.mockImplementationOnce(
        () => new Promise<AudioSummaryDto>((resolve) => { releaseSummary = resolve; }),
      );

      const { result } = renderHook(() => useTranscription());
      act(() => result.current.selectFile(file()));
      await act(async () => { await result.current.start(); });
      expect(result.current.phase).toBe("pending");

      await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
      act(() => result.current.reset());

      await act(async () => {
        releaseSummary(summaryDto("Completed"));
        await Promise.resolve();
      });

      expect(result.current.phase).toBe("idle");
      expect(result.current.summary).toBeNull();
    });
  });
});
