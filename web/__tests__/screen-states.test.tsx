import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TranscriptionScreen from "@/app/page";
import { getSummary, uploadAudio } from "@/lib/api";
import type { AudioFileDto, AudioSummaryDto, SummaryStatus } from "@/lib/types";

/**
 * T6 — the three outcomes the screen has to render, driven end to end through the real page
 * composition: success, failure, and `Summarization:Enabled = false`.
 *
 * Same timer discipline as loading-state.test.tsx: user-event runs on real timers, fake timers are
 * installed at the moment the poller is created, and are handed back once the phase is terminal so
 * the closing interactions run on real timers again.
 */
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, uploadAudio: vi.fn(), getSummary: vi.fn() };
});

const uploadAudioMock = vi.mocked(uploadAudio);
const getSummaryMock = vi.mocked(getSummary);

const AUDIO_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const SUMMARY_TEXT =
  "A aula revisa a arquitetura da API de áudio e o worker local de transcrição.";

function audioDto(summaryStatus: SummaryStatus): AudioFileDto {
  return {
    id: AUDIO_ID,
    originalFileName: "aula.mp3",
    storedFileName: "aula.m4a",
    url: "http://localhost:5218/files/aula.m4a",
    contentType: "audio/mp4",
    sizeBytes: 2048,
    createdAtUtc: "2026-08-01T10:00:00Z",
    summaryStatus,
  };
}

function summaryDto(
  status: SummaryStatus,
  overrides: Partial<AudioSummaryDto> = {},
): AudioSummaryDto {
  return {
    id: AUDIO_ID,
    status,
    summary: null,
    summaryLength: 0,
    maxSummaryLength: 500,
    language: "pt",
    error: null,
    updatedAtUtc: "2026-08-01T10:00:12Z",
    ...overrides,
  };
}

const audioFile = () => new File(["conteudo"], "aula.mp3", { type: "audio/mpeg" });

/** Selects a file in the panel and confirms the upload dialog. */
async function selectAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("Escolher arquivo"), audioFile());
  await user.click(screen.getByRole("button", { name: "Transcrever" }));
  await user.click(screen.getByRole("button", { name: "Enviar e transcrever" }));
}

/**
 * Defers the upload so the test decides when it resolves — and therefore when the poller's
 * interval is created. Installing fake timers first is what makes every later tick controlled.
 */
function deferUpload() {
  let release: ((dto: AudioFileDto) => void) | undefined;
  uploadAudioMock.mockImplementation(
    () =>
      new Promise<AudioFileDto>((resolve) => {
        release = resolve;
      }),
  );
  return async (dto: AudioFileDto) => {
    vi.useFakeTimers();
    await act(async () => {
      release?.(dto);
    });
  };
}

/** One poller tick (2s), with the promise it starts flushed inside act. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

/** Outcome dialogs open on arrival at a terminal phase; the thread is asserted behind them. */
async function closeOutcomeDialog(user: ReturnType<typeof userEvent.setup>) {
  const [dismiss] = screen.getAllByRole("button", { name: "Fechar" });
  await user.click(dismiss);
}

describe("screen states", () => {
  beforeEach(() => {
    uploadAudioMock.mockReset();
    getSummaryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the summary, its length against the 500-character ceiling and the completed chip", async () => {
    const releaseUpload = deferUpload();
    getSummaryMock.mockResolvedValue(
      summaryDto("Completed", {
        summary: SUMMARY_TEXT,
        summaryLength: SUMMARY_TEXT.length,
      }),
    );

    const user = userEvent.setup();
    render(<TranscriptionScreen />);
    await selectAndSubmit(user);

    await releaseUpload(audioDto("Pending"));
    await tick();
    vi.useRealTimers();

    await closeOutcomeDialog(user);

    expect(screen.getByText(SUMMARY_TEXT)).toBeInTheDocument();
    expect(screen.getByText(`${SUMMARY_TEXT.length} / 500 caracteres`)).toBeInTheDocument();
    expect(screen.getByText("Concluído")).toBeInTheDocument();
    expect(screen.getByText("Whisper tiny · resumo extrativo")).toBeInTheDocument();
  });

  it("renders the error message and a retry action when the transcription fails", async () => {
    const failure = "O worker não conseguiu transcrever o áudio.";
    const releaseUpload = deferUpload();
    getSummaryMock.mockResolvedValue(summaryDto("Failed", { error: failure }));

    const user = userEvent.setup();
    render(<TranscriptionScreen />);
    await selectAndSubmit(user);

    await releaseUpload(audioDto("Pending"));
    await tick();
    vi.useRealTimers();

    await closeOutcomeDialog(user);

    expect(screen.getByText("Não foi possível transcrever este áudio")).toBeInTheDocument();
    expect(screen.getByText(failure)).toBeInTheDocument();
    // Two retry affordances by design: one in the error bubble, one as the panel CTA.
    expect(screen.getAllByRole("button", { name: "Tentar novamente" })).toHaveLength(2);
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });

  it("renders `Disabled` as a neutral state, with no error treatment", async () => {
    // The server stored the file and simply does not summarize: docs/DESIGN.md §7 reserves red
    // for `Failed`, so this phase must carry no danger surface anywhere on the screen.
    uploadAudioMock.mockResolvedValue(audioDto("Disabled"));

    const user = userEvent.setup();
    render(<TranscriptionScreen />);
    await selectAndSubmit(user);

    expect(
      screen.getByText("Resumo desativado no servidor. O áudio foi armazenado."),
    ).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Resumo desativado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar outro áudio" })).toBeInTheDocument();

    // No poller was ever needed, and no failure surface exists.
    expect(getSummaryMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(document.querySelector(".bg-danger-soft")).toBeNull();
    expect(document.querySelector(".border-danger-border")).toBeNull();
    expect(document.querySelector(".text-danger")).toBeNull();
  });
});
