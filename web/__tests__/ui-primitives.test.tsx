import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Badge } from "@/components/ui/Badge";
import { Bubble } from "@/components/ui/Bubble";
import { Button } from "@/components/ui/Button";
import { Chip, type ChipVariant } from "@/components/ui/Chip";
import { CodeLine } from "@/components/ui/CodeLine";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Dropzone } from "@/components/ui/Dropzone";
import { EmptyState } from "@/components/ui/EmptyState";
import { FileCard } from "@/components/ui/FileCard";
import { MessageRow } from "@/components/ui/MessageRow";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import { Stepper } from "@/components/ui/Stepper";
import { Waveform, barHeight } from "@/components/ui/Waveform";

describe("Button", () => {
  it("renders its label", () => {
    render(<Button>Enviar e transcrever</Button>);
    expect(screen.getByRole("button", { name: "Enviar e transcrever" })).toBeInTheDocument();
  });

  it("is aria-busy and non-interactive while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Enviando…
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Enviando/ });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not set aria-busy when idle", () => {
    render(<Button>Recomeçar</Button>);
    expect(screen.getByRole("button", { name: "Recomeçar" })).not.toHaveAttribute("aria-busy");
  });

  it("labels the primary button with ink, never white (docs/DESIGN.md §8 Don't 1)", () => {
    render(<Button variant="primary">Transcrever</Button>);
    const button = screen.getByRole("button", { name: "Transcrever" });
    expect(button.className).toContain("bg-brand");
    const label = screen.getByText("Transcrever");
    expect(label.className).toContain("text-text");
    expect(label.className).not.toContain("text-text-inverse");
    expect(label.className).not.toContain("text-white");
  });

  it("uses the disabled fill and disabled ink when disabled", () => {
    render(<Button disabled>Transcrever</Button>);
    const button = screen.getByRole("button", { name: "Transcrever" });
    expect(button.className).toContain("bg-surface-disabled");
    expect(button.className).toContain("text-text-disabled");
    expect(button.className).not.toContain("bg-brand");
  });

  it("renders the danger variant with inverse text on the danger fill", () => {
    render(<Button variant="danger">Recomeçar</Button>);
    const button = screen.getByRole("button", { name: "Recomeçar" });
    expect(button.className).toContain("bg-danger");
    expect(button.className).toContain("text-text-inverse");
  });
});

describe("ProgressBar", () => {
  it("exposes aria-valuenow when determinate", () => {
    render(<ProgressBar value={42} label="Enviando" />);
    const bar = screen.getByRole("progressbar", { name: "Enviando" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps a determinate value into 0..100", () => {
    render(<ProgressBar value={140} label="Enviando" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("omits aria-valuenow when indeterminate (docs/DESIGN.md §8 Don't 3)", () => {
    render(<ProgressBar tone="info" label="Processing" />);
    const bar = screen.getByRole("progressbar", { name: "Processing" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar.firstElementChild).toHaveStyle({ width: "30%" });
  });
});

describe("Chip", () => {
  const copy: Array<[ChipVariant, string]> = [
    ["idle", "Aguardando arquivo"],
    ["uploading", "Enviando…"],
    ["processing", "Processando"],
    ["completed", "Concluído"],
    ["failed", "Falhou"],
    ["disabled", "Resumo desativado"],
  ];

  it.each(copy)("renders the %s copy", (variant, label) => {
    render(<Chip variant={variant} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("keeps `disabled` neutral, never red (docs/DESIGN.md §7)", () => {
    render(<Chip variant="disabled" />);
    const chip = screen.getByText("Resumo desativado");
    expect(chip.className).toContain("bg-surface-muted");
    expect(chip.className).not.toContain("danger");
  });
});

describe("Badge", () => {
  it("renders mono content with the requested tone", () => {
    render(<Badge tone="success">201 Created</Badge>);
    const badge = screen.getByText("201 Created");
    expect(badge.className).toContain("font-mono");
    expect(badge.className).toContain("bg-success-soft");
  });
});

describe("Dialog", () => {
  it("renders its title when open", () => {
    render(
      <Dialog open onClose={() => {}} title="Transcrição concluída">
        <p>corpo</p>
      </Dialog>,
    );
    expect(screen.getByRole("heading", { name: "Transcrição concluída" })).toBeInTheDocument();
    expect(screen.getByText("corpo")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Transcrição concluída">
        <p>corpo</p>
      </Dialog>,
    );
    expect(screen.queryByText("Transcrição concluída")).not.toBeInTheDocument();
    expect(screen.queryByText("corpo")).not.toBeInTheDocument();
  });

  it("closes from the dismiss control when dismissable", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Falha na transcrição">
        <p>corpo</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers no dismiss control on the destructive confirm", () => {
    render(
      <Dialog open dismissable={false} onClose={() => {}} title="Recomeçar?" width={480}>
        <DialogFooter>
          <button type="button">Cancelar</button>
        </DialogFooter>
      </Dialog>,
    );
    expect(screen.queryByRole("button", { name: "Fechar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });
});

describe("FileCard", () => {
  it("truncates the name column so the dismiss control is never pushed out", () => {
    render(<FileCard name="cosmic-audio-com-nome-muito-longo.wav" meta="3,4 MB · WAV · 2:40" />);
    const name = screen.getByText("cosmic-audio-com-nome-muito-longo.wav");
    expect(name.className).toContain("min-w-0");
    expect(name.className).toContain("truncate");
    expect(name.parentElement?.className).toContain("min-w-0");
  });

  it("calls onDismiss from the dismiss control", async () => {
    const onDismiss = vi.fn();
    render(<FileCard name="a.wav" meta="1 MB" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Remover arquivo" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("Dropzone", () => {
  it("accepts exactly the API's allowed extensions", () => {
    const { container } = render(<Dropzone onFile={() => {}} />);
    const input = container.querySelector("input[type=file]");
    expect(input).toHaveAttribute("accept", ".mp3,.wav,.ogg,.flac,.m4a,.aac,.webm");
  });

  it("emits the chosen file", async () => {
    const onFile = vi.fn();
    const { container } = render(<Dropzone onFile={onFile} />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.wav", { type: "audio/wav" }));
    expect(onFile).toHaveBeenCalledOnce();
    expect(onFile.mock.calls[0][0].name).toBe("a.wav");
  });

  it("shows the resting headline and the visible file picker", () => {
    render(<Dropzone onFile={() => {}} />);
    expect(screen.getByText("Arraste um áudio aqui")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher arquivo" })).toBeInTheDocument();
  });
});

describe("Select", () => {
  it("associates its overline label with the native select", () => {
    render(
      <Select
        label="IDIOMA"
        defaultValue="auto"
        options={[{ value: "auto", label: "Detectar automaticamente" }]}
      />,
    );
    expect(screen.getByLabelText("IDIOMA")).toHaveValue("auto");
  });
});

describe("Stepper", () => {
  it("renders the API vocabulary verbatim with per-state tone", () => {
    render(
      <Stepper
        steps={[
          { id: "sent", label: "Enviado", state: "done" },
          { id: "queued", label: "Na fila (Pending)", state: "pending" },
          { id: "run", label: "Transcrevendo (Processing)", state: "active" },
          { id: "fail", label: "Concluído (Completed)", state: "failed" },
        ]}
      />,
    );
    expect(screen.getByText("Na fila (Pending)").className).toContain("text-text-secondary");
    expect(screen.getByText("Transcrevendo (Processing)").className).toContain("font-medium");
    expect(screen.getByText("Concluído (Completed)").className).toContain("text-danger");
  });
});

describe("Waveform", () => {
  it("derives bar heights deterministically", () => {
    expect(barHeight(7)).toBe(barHeight(7));
    const heights = Array.from({ length: 72 }, (_, i) => barHeight(i));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...heights)).toBeLessThanOrEqual(24);
    expect(new Set(heights).size).toBeGreaterThan(1);
  });

  it("colours the played portion with the brand fill", () => {
    const { container } = render(<Waveform progress={0.5} bars={10} />);
    const bars = Array.from(container.querySelectorAll("span"));
    expect(bars).toHaveLength(10);
    expect(bars.filter((bar) => bar.className.includes("bg-brand"))).toHaveLength(5);
    expect(bars.filter((bar) => bar.className.includes("bg-hairline-strong"))).toHaveLength(5);
  });
});

describe("MessageRow, Bubble, CodeLine, EmptyState", () => {
  it("renders the message header above its bubble", () => {
    render(
      <MessageRow tone="system" author="Sistema" timestamp="14:02">
        <Bubble variant="loading" accent="info">
          <span>Na fila para transcrição</span>
        </Bubble>
      </MessageRow>,
    );
    expect(screen.getByText("Sistema")).toBeInTheDocument();
    expect(screen.getByText("14:02")).toBeInTheDocument();
    expect(screen.getByText("Na fila para transcrição")).toBeInTheDocument();
  });

  it("caps the bubble at {layout.bubble}", () => {
    render(<Bubble>conteúdo</Bubble>);
    expect(screen.getByText("conteúdo").className).toContain("w-bubble");
  });

  it("renders raw API values in mono", () => {
    render(<CodeLine>summaryStatus: &quot;Failed&quot;</CodeLine>);
    expect(screen.getByText(/summaryStatus/).className).toContain("font-mono");
  });

  it("renders the empty state copy", () => {
    render(<EmptyState headline="Nenhum áudio ainda" subline="Envie um arquivo para começar." />);
    expect(screen.getByRole("heading", { name: "Nenhum áudio ainda" })).toBeInTheDocument();
    expect(screen.getByText("Envie um arquivo para começar.")).toBeInTheDocument();
  });
});
