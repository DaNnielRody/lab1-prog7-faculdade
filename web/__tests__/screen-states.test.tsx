import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TranscriptionScreen from "@/app/page";
import { ApiError, getSummary, listAudios, uploadAudio } from "@/lib/api";
import type { AudioFileDto, AudioSummaryDto, SummaryStatus } from "@/lib/types";

// `listAudios` é mockado porque a tela passou a carregar a lista de áudios processados ao montar.
// Sem o mock, o jsdom faria uma chamada de rede real à API — estes testes são sobre o thread.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, uploadAudio: vi.fn(), getSummary: vi.fn(), listAudios: vi.fn() };
});

const uploadAudioMock = vi.mocked(uploadAudio);
const getSummaryMock = vi.mocked(getSummary);
const listAudiosMock = vi.mocked(listAudios);

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

async function selectAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("Escolher arquivo"), audioFile());
  await user.click(screen.getByRole("button", { name: "Transcrever" }));
  await user.click(screen.getByRole("button", { name: "Enviar e transcrever" }));
}

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

async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

async function closeOutcomeDialog(user: ReturnType<typeof userEvent.setup>) {
  const [dismiss] = screen.getAllByRole("button", { name: "Fechar" });
  await user.click(dismiss);
}

describe("screen states", () => {
  beforeEach(() => {
    uploadAudioMock.mockReset();
    getSummaryMock.mockReset();
    listAudiosMock.mockReset();
    listAudiosMock.mockResolvedValue([]);
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

    expect(screen.getAllByRole("button", { name: "Tentar novamente" })).toHaveLength(2);
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });

  it("renders `Disabled` as a neutral state, with no error treatment", async () => {
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

    expect(getSummaryMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(document.querySelector(".bg-danger-soft")).toBeNull();
    expect(document.querySelector(".border-danger-border")).toBeNull();
    expect(document.querySelector(".text-danger")).toBeNull();
  });

  // Regressão: com a API fora do ar, a sessão E a lista falham pela mesma causa. A lista não pode
  // reportar o mesmo fracasso uma segunda vez em vermelho, nem reusar o nome de um botão que faz
  // outra coisa. Encontrado abrindo a tela no navegador, não por teste.
  it("does not let the processed list echo the thread when the whole API is unreachable", async () => {
    const failure = "Não foi possível falar com o servidor. Verifique se a API está no ar.";
    const releaseUpload = deferUpload();
    getSummaryMock.mockResolvedValue(summaryDto("Failed", { error: failure }));
    listAudiosMock.mockRejectedValue(new ApiError(failure, 0));

    const user = userEvent.setup();
    render(<TranscriptionScreen />);
    await selectAndSubmit(user);

    await releaseUpload(audioDto("Pending"));
    await tick();
    vi.useRealTimers();

    await closeOutcomeDialog(user);

    // O aviso vai para o toast, que é fixo e não ocupa fluxo…
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Não foi possível carregar os áudios processados.");
    expect(screen.getByRole("button", { name: "Recarregar a lista" })).toBeInTheDocument();

    // …e a região da lista não desenha nada: nem seção, nem divisor, nem cabeçalho.
    expect(screen.queryByRole("heading", { name: "Áudios processados" })).not.toBeInTheDocument();

    // "Tentar novamente" continua significando uma coisa só: repetir a transcrição.
    expect(screen.getAllByRole("button", { name: "Tentar novamente" })).toHaveLength(2);

    // O toast é neutro: o único tratamento de danger da tela continua sendo o do thread.
    expect(toast.querySelector(".bg-danger-soft")).toBeNull();
    expect(toast.querySelector(".text-danger")).toBeNull();
  });
});
