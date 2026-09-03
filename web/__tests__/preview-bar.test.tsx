import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PreviewBar } from "@/components/transcription/PreviewBar";
import type { AudioFileDto } from "@/lib/types";

// Missing symbol this file pins: `@/components/transcription/PreviewBar` exporting a named
// `PreviewBar` component with props `{ audio: AudioFileDto; className?: string }`. `audio` is the
// same AudioFileDto the thread already holds for a processed item — no new shape.
// docs/DESIGN.md §7 `{component.preview-bar}` / `{component.track-selector}` /
// `{component.track-selector-unavailable}` is the authoritative contract asserted below.

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
    summary: "resumo",
    summaryLanguage: "pt",
    filterStatus: "Completed",
    filterError: null,
    filteredUrl: "http://localhost:5218/files/aula.filtered.m4a",
    filteredSizeBytes: 1024,
    filteredContentType: "audio/mp4",
    ...overrides,
  };
}

describe("PreviewBar — play/pause e nomes acessíveis", () => {
  it("expõe um play/pause cujo nome acessível diz qual faixa toca, tocando o original por padrão", () => {
    render(<PreviewBar audio={audio()} />);

    expect(screen.getByRole("button", { name: "Reproduzir áudio original" })).toBeInTheDocument();
  });

  it("troca o nome acessível do play/pause para a faixa com filtro quando ela está selecionada", async () => {
    const user = userEvent.setup();
    render(<PreviewBar audio={audio()} />);

    await user.click(screen.getByRole("radio", { name: "Com filtro" }));

    expect(screen.getByRole("button", { name: "Reproduzir áudio com filtro" })).toBeInTheDocument();
  });
});

describe("PreviewBar — seletor de faixa", () => {
  it("expõe um radiogroup rotulado 'Fonte de áudio' com as duas opções literais", () => {
    render(<PreviewBar audio={audio()} />);

    const group = screen.getByRole("radiogroup", { name: "Fonte de áudio" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Original" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Com filtro" })).toBeInTheDocument();
  });

  it("seleciona Original por padrão, com aria-checked correto nas duas opções", () => {
    render(<PreviewBar audio={audio()} />);

    expect(screen.getByRole("radio", { name: "Original" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Com filtro" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("a fonte inicial é a URL de download original do áudio", () => {
    const item = audio();
    const { container } = render(<PreviewBar audio={item} />);

    const source = container.querySelector("audio");
    expect(source).not.toBeNull();
    expect(source?.getAttribute("src")).toBe(item.url);
  });

  it("selecionar Com filtro troca a fonte para a URL filtrada e reinicia a posição", async () => {
    const user = userEvent.setup();
    const item = audio();
    const { container } = render(<PreviewBar audio={item} />);

    await user.click(screen.getByRole("radio", { name: "Com filtro" }));

    expect(screen.getByRole("radio", { name: "Com filtro" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Original" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    const source = container.querySelector("audio");
    expect(source?.getAttribute("src")).toBe(item.filteredUrl);
    // Track switching pauses and resets elapsed to 0:00 — same reset PlayerBar already runs on a
    // source change (docs/DESIGN.md §7, "Track switching" row).
    expect(screen.getAllByText("0:00").length).toBeGreaterThan(0);
  });
});

describe("PreviewBar — Com filtro indisponível (pendente/processando)", () => {
  it.each(["Pending", "Processing"] as const)(
    "com filterStatus %s, Com filtro fica não selecionável e o motivo fica visível",
    (filterStatus) => {
      render(<PreviewBar audio={audio({ filterStatus })} />);

      const option = screen.getByRole("radio", { name: "Com filtro" });
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText("Filtro em processamento")).toBeInTheDocument();

      const describedBy = option.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)).toHaveTextContent(
        "Filtro em processamento",
      );
    },
  );

  it.each(["Pending", "Processing"] as const)(
    "clicar em Com filtro indisponível (%s) não seleciona a opção",
    async (filterStatus) => {
      const user = userEvent.setup();
      render(<PreviewBar audio={audio({ filterStatus })} />);

      await user.click(screen.getByRole("radio", { name: "Com filtro" }));

      expect(screen.getByRole("radio", { name: "Com filtro" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(screen.getByRole("radio", { name: "Original" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    },
  );
});

describe("PreviewBar — Com filtro indisponível (falha)", () => {
  it("com filterStatus Failed e filterError presente, mostra o motivo bruto do servidor", () => {
    render(
      <PreviewBar
        audio={audio({ filterStatus: "Failed", filterError: "ffmpeg falhou ao filtrar (código 7)." })}
      />,
    );

    const option = screen.getByRole("radio", { name: "Com filtro" });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Falha ao gerar o filtro")).toBeInTheDocument();
    expect(screen.getByText("ffmpeg falhou ao filtrar (código 7).")).toBeInTheDocument();

    const describedBy = option.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      "ffmpeg falhou ao filtrar (código 7).",
    );
  });

  it("com filterStatus Failed e filterError nulo, usa o mesmo texto de fallback do resto do thread", () => {
    render(<PreviewBar audio={audio({ filterStatus: "Failed", filterError: null })} />);

    expect(screen.getByText("Falha ao gerar o filtro")).toBeInTheDocument();
    // Same fallback string used by "history compression failed" / "history summary failed"
    // (docs/DESIGN.md §7 track-selector-unavailable table).
    expect(screen.getByText("O servidor não informou o motivo.")).toBeInTheDocument();
  });
});

describe("PreviewBar — não inunda o role=\"log\" da conversa", () => {
  it("o transporte da barra fica sob aria-live=\"off\" no próprio container", () => {
    const { container } = render(<PreviewBar audio={audio()} />);

    const liveOffHost = container.querySelector('[aria-live="off"]');
    expect(liveOffHost).not.toBeNull();
    // The play button and the elapsed/duration transport live inside that aria-live="off" host.
    const playButton = screen.getByRole("button", { name: "Reproduzir áudio original" });
    expect(liveOffHost?.contains(playButton)).toBe(true);
  });
});
