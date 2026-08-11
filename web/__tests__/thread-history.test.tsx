import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Thread } from "@/components/transcription/Thread";
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

function renderThread(processed: AudioFileDto[], phase: "idle" | "completed" = "idle") {
  return render(
    <Thread
      phase={phase}
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

describe("Thread — áudios já processados", () => {
  // The requirement: each processed audio shows that audio's summary.
  it("mostra o resumo de cada áudio processado, como mensagem da conversa", () => {
    renderThread([
      audio({ id: "a", originalFileName: "um.mp3", summary: "Resumo do primeiro." }),
      audio({ id: "b", originalFileName: "dois.mp3", summary: "Resumo do segundo." }),
    ]);

    expect(screen.getByText("Resumo do primeiro.")).toBeInTheDocument();
    expect(screen.getByText("Resumo do segundo.")).toBeInTheDocument();
    expect(screen.getAllByText("Resumo")).toHaveLength(2);
    expect(screen.getByText("um.mp3")).toBeInTheDocument();
  });

  // This is the defect a human found by opening the page: an empty state claiming there is
  // nothing, directly above two audios. It cannot recur while both come from the same list.
  it("não mostra o empty state quando existe histórico", () => {
    renderThread([audio()]);

    expect(screen.queryByText("Nenhum áudio ainda")).not.toBeInTheDocument();
  });

  it("mostra o empty state só quando a conversa está de fato vazia", () => {
    renderThread([]);

    expect(screen.getByText("Nenhum áudio ainda")).toBeInTheDocument();
  });

  // The screen is a conversation (Figma "Chat body", node 5:47) — no list, no section heading,
  // no bordered card. A regression here means the separate region crept back in.
  it("não desenha lista, seção nem cabeçalho próprio", () => {
    const { container } = renderThread([audio()]);

    expect(screen.queryByRole("heading", { name: "Áudios processados" })).not.toBeInTheDocument();
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("mostra a falha de compressão com o motivo do servidor", () => {
    renderThread([
      audio({
        processingStatus: "Failed",
        processingError: "ffmpeg falhou ao comprimir o áudio (código 183).",
        summaryStatus: "Failed",
        summary: null,
      }),
    ]);

    expect(screen.getByText(/Não foi possível comprimir/)).toBeInTheDocument();
    expect(
      screen.getByText("ffmpeg falhou ao comprimir o áudio (código 183)."),
    ).toBeInTheDocument();
  });

  // Compression is strictly upstream: while ffmpeg runs there is no .m4a, so "resumindo" would
  // be a lie.
  it("dá precedência à compressão sobre a sumarização", () => {
    renderThread([audio({ processingStatus: "Processing", summaryStatus: "Pending" })]);

    expect(screen.getByText(/comprimindo/)).toBeInTheDocument();
    expect(screen.queryByText(/aguardando o resumo/)).not.toBeInTheDocument();
  });

  it("renderiza Disabled como estado neutro, sem tratamento de erro", () => {
    const { container } = renderThread([
      audio({ summaryStatus: "Disabled", summary: null, summaryLanguage: null }),
    ]);

    expect(screen.getByText(/resumo desativado no servidor/)).toBeInTheDocument();
    expect(container.querySelector(".bg-danger-soft")).toBeNull();
    expect(container.querySelector(".text-danger")).toBeNull();
  });

  it("nunca deixa um áudio sem corpo, seja qual for o estado", () => {
    renderThread([audio({ summaryStatus: "Pending", summary: null })]);

    expect(screen.getByText(/aguardando o resumo/)).toBeInTheDocument();
  });

  it("mostra o motivo que o servidor deu para a falha de resumo", () => {
    renderThread([
      audio({
        summaryStatus: "Failed",
        summary: null,
        summaryError: "O worker de resumo está indisponível.",
      }),
    ]);

    expect(screen.getByText("O worker de resumo está indisponível.")).toBeInTheDocument();
    expect(screen.queryByText("O servidor não informou o motivo.")).not.toBeInTheDocument();
  });
});

describe("Thread — ações do balão de erro da sessão", () => {
  // Figma "actions" (5:527): button-primary-sm e button-ghost-sm têm a mesma caixa. Um primary
  // de tamanho padrão ao lado de um ghost fica mais alto — foi o que apareceu na tela.
  it("renderiza os dois botões com a mesma métrica", () => {
    render(
      <Thread
        phase="failed"
        progress={0}
        file={null}
        audio={null}
        summary={null}
        error="O worker não conseguiu transcrever o áudio."
        messages={[{ id: "m1", author: "system", phase: "failed", createdAt: 0 }]}
        processed={[]}
        onRetry={vi.fn()}
        onSendAnother={vi.fn()}
      />,
    );

    const retry = screen.getByRole("button", { name: "Tentar novamente" });
    const another = screen.getByRole("button", { name: "Enviar outro áudio" });

    for (const metric of ["px-4", "py-2", "text-label", "rounded-full"]) {
      expect(retry.className).toContain(metric);
      expect(another.className).toContain(metric);
    }
  });
});
