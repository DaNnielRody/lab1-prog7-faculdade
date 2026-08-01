import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TranscriptionScreen from "@/app/page";
import { getSummary, uploadAudio } from "@/lib/api";
import type { AudioFileDto } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, uploadAudio: vi.fn(), getSummary: vi.fn() };
});

const uploadAudioMock = vi.mocked(uploadAudio);
const getSummaryMock = vi.mocked(getSummary);

const AUDIO_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const pendingUpload = (): AudioFileDto => ({
  id: AUDIO_ID,
  originalFileName: "aula.mp3",
  storedFileName: "aula.m4a",
  url: "http://localhost:5218/files/aula.m4a",
  contentType: "audio/mp4",
  sizeBytes: 2048,
  createdAtUtc: "2026-08-01T10:00:00Z",
  summaryStatus: "Pending",
});

const audioFile = () => new File(["conteudo"], "aula.mp3", { type: "audio/mpeg" });

describe("loading state while the upload is in flight", () => {
  beforeEach(() => {
    uploadAudioMock.mockReset();
    getSummaryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the loading component until the upload resolves, then removes it", async () => {
    let resolveUpload: ((dto: AudioFileDto) => void) | undefined;
    uploadAudioMock.mockImplementation(
      (_file, opts) =>
        new Promise<AudioFileDto>((resolve) => {
          opts?.onProgress?.(42);
          resolveUpload = resolve;
        }),
    );
    getSummaryMock.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<TranscriptionScreen />);

    expect(screen.getByText("Nenhum áudio ainda")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText("Escolher arquivo"), audioFile());
    await user.click(screen.getByRole("button", { name: "Transcrever" }));
    await user.click(screen.getByRole("button", { name: "Enviar e transcrever" }));

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("Enviando áudio para POST /api/audios…")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();

    const cta = screen.getByRole("button", { name: /Enviando…/ });
    expect(cta).toHaveAttribute("aria-busy", "true");
    expect(cta).toBeDisabled();

    vi.useFakeTimers();
    await act(async () => {
      resolveUpload?.(pendingUpload());
    });

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Enviando áudio para POST /api/audios…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviando…/ })).not.toBeInTheDocument();

    expect(screen.getByText("201 Created")).toBeInTheDocument();
    expect(screen.getByText("Na fila para transcrição")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});
