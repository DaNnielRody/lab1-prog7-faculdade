import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TranscriptionScreen from "@/app/page";
import { getSummary, listAudios, uploadAudio } from "@/lib/api";
import type { AudioValidationResult } from "@/lib/audioValidation";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, uploadAudio: vi.fn(), getSummary: vi.fn(), listAudios: vi.fn() };
});

const uploadAudioMock = vi.mocked(uploadAudio);
const listAudiosMock = vi.mocked(listAudios);

const MP3_SIGNATURE = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
const file = () => new File([MP3_SIGNATURE], "aula.mp3", { type: "audio/mpeg" });

class ControlledWorker {
  static last: ControlledWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  requestId = 0;

  constructor() {
    ControlledWorker.last = this;
  }

  postMessage(message: { requestId: number }) {
    this.requestId = message.requestId;
  }

  respond(result: AudioValidationResult) {
    this.onmessage?.(
      new MessageEvent("message", { data: { requestId: this.requestId, result } }),
    );
  }

  fail() {
    this.onerror?.(new ErrorEvent("error", { message: "worker crashed" }));
  }
}

describe("client-side upload validation", () => {
  beforeEach(() => {
    uploadAudioMock.mockReset();
    vi.mocked(getSummary).mockReset();
    listAudiosMock.mockReset();
    listAudiosMock.mockResolvedValue([]);
    vi.stubGlobal("Worker", ControlledWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows validation in progress and disables upload confirmation until accepted", async () => {
    const user = userEvent.setup();
    render(<TranscriptionScreen />);

    await user.upload(screen.getByLabelText("Escolher arquivo"), file());

    expect(screen.getByText("Validando arquivo de áudio…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validando áudio…" })).toBeDisabled();
    expect(uploadAudioMock).not.toHaveBeenCalled();

    await act(async () => ControlledWorker.last.respond({ valid: true }));

    expect(screen.getByRole("button", { name: "Transcrever" })).toBeEnabled();
  });

  it("shows the reason and never uploads a rejected file", async () => {
    const user = userEvent.setup();
    render(<TranscriptionScreen />);
    await user.upload(screen.getByLabelText("Escolher arquivo"), file());

    await act(async () =>
      ControlledWorker.last.respond({
        valid: false,
        message: "O conteúdo do arquivo não corresponde a um áudio MP3 válido.",
      }),
    );

    expect(screen.getByText(
      "O conteúdo do arquivo não corresponde a um áudio MP3 válido.",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arquivo inválido" })).toBeDisabled();
    expect(uploadAudioMock).not.toHaveBeenCalled();
  });

  it("presents a Worker failure without leaving the confirmation enabled", async () => {
    const user = userEvent.setup();
    render(<TranscriptionScreen />);
    await user.upload(screen.getByLabelText("Escolher arquivo"), file());

    await act(async () => ControlledWorker.last.fail());

    expect(screen.getByText(
      "O validador paralelo de áudio falhou. Selecione o arquivo novamente.",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arquivo inválido" })).toBeDisabled();
    expect(uploadAudioMock).not.toHaveBeenCalled();
  });
});
