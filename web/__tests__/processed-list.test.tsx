import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProcessedList } from "@/components/transcription/ProcessedList";
import type { AudioFileDto } from "@/lib/types";

const SUMMARY_TEXT =
  "A aula percorre o pipeline de compressão e o worker de transcrição do servidor.";

function audio(overrides: Partial<AudioFileDto> = {}): AudioFileDto {
  return {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    originalFileName: "aula.mp3",
    storedFileName: "aula.m4a",
    url: "http://localhost:5218/files/aula.m4a",
    contentType: "audio/mp4",
    sizeBytes: 2048,
    createdAtUtc: "2026-08-08T14:32:00Z",
    processingStatus: "Completed",
    summaryStatus: "Completed",
    summary: SUMMARY_TEXT,
    summaryLanguage: "pt",
    ...overrides,
  };
}

function renderList(audios: AudioFileDto[]) {
  return render(
    <ProcessedList
      audios={audios}
      loading={false}
      error={null}
      phase="idle"
      onReload={vi.fn()}
    />,
  );
}

describe("ProcessedList", () => {
  it("renders the summary text of a Completed audio", () => {
    renderList([audio()]);

    expect(screen.getByText(SUMMARY_TEXT)).toBeInTheDocument();
    expect(screen.getByText(`${SUMMARY_TEXT.length} / 500 caracteres`)).toBeInTheDocument();
    expect(screen.getByText("Concluído")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Áudios processados" })).toBeInTheDocument();
    expect(screen.getByText("1 áudio")).toBeInTheDocument();
  });

  it("renders the compression state instead of an empty body", () => {
    renderList([
      audio({ processingStatus: "Processing", summaryStatus: "Pending", summary: null }),
    ]);

    expect(screen.getByText("Comprimindo o áudio no servidor…")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Comprimindo")).toBeInTheDocument();

    const item = screen.getByRole("listitem");
    expect(item).toHaveAttribute("aria-busy", "true");
    expect(item.textContent).not.toBe("");
  });

  it("renders the transcription state while the server summarizes", () => {
    renderList([
      audio({ processingStatus: "Completed", summaryStatus: "Processing", summary: null }),
    ]);

    expect(screen.getByText("Transcrevendo com Whisper tiny…")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Resumindo")).toBeInTheDocument();
  });

  it("renders the compression failure and the raw server reason", () => {
    const reason = "ffmpeg saiu com o código 1.";
    renderList([
      audio({
        processingStatus: "Failed",
        processingError: reason,
        summaryStatus: "Pending",
        summary: null,
      }),
    ]);

    expect(screen.getByText("Não foi possível comprimir este áudio")).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });

  it("renders the summary failure and the raw server reason", () => {
    const reason = "O worker não conseguiu transcrever o áudio.";
    renderList([
      audio({ summaryStatus: "Failed", summaryError: reason, summary: null }),
    ]);

    expect(screen.getByText("Não foi possível resumir este áudio")).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("renders `Disabled` as a neutral row, with no error treatment", () => {
    const { container } = renderList([audio({ summaryStatus: "Disabled", summary: null })]);

    expect(
      screen.getByText("Resumo desativado no servidor. O áudio foi armazenado."),
    ).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Resumo desativado")).toBeInTheDocument();

    expect(container.querySelector(".bg-danger-soft")).toBeNull();
    expect(container.querySelector(".border-danger-border")).toBeNull();
    expect(container.querySelector(".text-danger")).toBeNull();
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-busy", "false");
  });

  it("shows the compression copy when both stages are Pending", () => {
    renderList([
      audio({ processingStatus: "Pending", summaryStatus: "Pending", summary: null }),
    ]);

    expect(screen.getByText("Na fila para compressão")).toBeInTheDocument();
    expect(screen.queryByText("Na fila para transcrição")).not.toBeInTheDocument();
    expect(screen.getByText("Comprimindo")).toBeInTheDocument();
    expect(screen.queryByText("Resumindo")).not.toBeInTheDocument();
  });

  it("renders nothing while the session is idle and the server has no audio", () => {
    const { container } = render(
      <ProcessedList audios={[]} loading={false} error={null} phase="idle" onReload={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("offers a retry when the list itself failed to load", async () => {
    const onReload = vi.fn();
    render(
      <ProcessedList
        audios={[]}
        loading={false}
        error="boom"
        phase="idle"
        onReload={onReload}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar a lista de áudios.",
    );
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});
