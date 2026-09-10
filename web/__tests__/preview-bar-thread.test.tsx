import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Thread } from "@/components/transcription/Thread";
import type { AudioFileDto, ProcessingStatus } from "@/lib/types";

// Pins where `{component.preview-bar}` mounts inside the thread (docs/DESIGN.md §7, "Playing a
// processed audio in place"): every processed item with processingStatus === "Completed" gets one,
// across all three bubble variants (summary/error/neutral) — and no other item does.

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
    summary: "resumo do áudio",
    summaryLanguage: "pt",
    filterStatus: "Completed",
    filterError: null,
    filteredUrl: "http://localhost:5218/files/aula.filtered.m4a",
    filteredSizeBytes: 1024,
    filteredContentType: "audio/mp4",
    ...overrides,
  };
}

function renderThread(processed: AudioFileDto[]) {
  return render(
    <Thread
      phase="idle"
      progress={0}
      file={null}
      audio={null}
      summary={null}
      error={null}
      messages={[]}
      processed={processed}
      onRetry={vi.fn()}
      onSendAnother={vi.fn()}
    />,
  );
}

function previewBarPresent() {
  return screen.queryByRole("radiogroup", { name: "Fonte de áudio" }) !== null;
}

describe("Thread — barra de prévia por item processado", () => {
  it("mostra a barra de prévia quando summaryStatus é Completed (bubble-summary)", () => {
    renderThread([audio({ summaryStatus: "Completed" })]);

    expect(previewBarPresent()).toBe(true);
  });

  it("mostra a barra de prévia quando summaryStatus é Failed (bubble-error) — o áudio comprimiu bem", () => {
    renderThread([
      audio({ summaryStatus: "Failed", summary: null, summaryError: "worker indisponível" }),
    ]);

    expect(previewBarPresent()).toBe(true);
  });

  it("mostra a barra de prévia quando summaryStatus é Disabled (bubble neutra)", () => {
    renderThread([audio({ summaryStatus: "Disabled", summary: null, summaryLanguage: null })]);

    expect(previewBarPresent()).toBe(true);
  });

  it("mostra a barra de prévia quando summaryStatus ainda está Pending (bubble neutra)", () => {
    renderThread([audio({ summaryStatus: "Pending", summary: null })]);

    expect(previewBarPresent()).toBe(true);
  });

  it.each(["Pending", "Processing"] as ProcessingStatus[])(
    "não mostra a barra de prévia quando processingStatus é %s, e a mensagem de compressão continua igual",
    (processingStatus) => {
      renderThread([audio({ processingStatus, summaryStatus: "Pending", summary: null })]);

      expect(previewBarPresent()).toBe(false);
      expect(
        screen.getByText(processingStatus === "Processing" ? /comprimindo/ : /na fila para compressão/),
      ).toBeInTheDocument();
    },
  );

  it("não mostra a barra de prévia quando processingStatus é Failed, e a falha de compressão continua igual", () => {
    renderThread([
      audio({
        processingStatus: "Failed",
        processingError: "ffmpeg falhou ao comprimir o áudio (código 183).",
        summaryStatus: "Failed",
        summary: null,
      }),
    ]);

    expect(previewBarPresent()).toBe(false);
    expect(screen.getByText(/Não foi possível comprimir/)).toBeInTheDocument();
    expect(
      screen.getByText("ffmpeg falhou ao comprimir o áudio (código 183)."),
    ).toBeInTheDocument();
  });

  it("cada item processado tem sua própria barra, uma por item", () => {
    renderThread([
      audio({ id: "a", originalFileName: "um.mp3" }),
      audio({ id: "b", originalFileName: "dois.mp3" }),
    ]);

    expect(screen.getAllByRole("radiogroup", { name: "Fonte de áudio" })).toHaveLength(2);
  });
});
