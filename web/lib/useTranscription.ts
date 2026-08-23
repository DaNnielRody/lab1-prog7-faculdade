"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getSummary, uploadAudio } from "@/lib/api";
import type { AudioValidationState } from "@/lib/audioValidation";
import { validateAudioFileInBackground } from "@/lib/audioValidationClient";
import type {
  AudioFileDto,
  AudioSummaryDto,
  Phase,
  SelectedFile,
  SummaryStatus,
  ThreadMessage,
} from "@/lib/types";

export const POLL_INTERVAL_MS = 2000;
export const POLL_CEILING_MS = 5 * 60 * 1000;
const MAX_POLL_TICKS = POLL_CEILING_MS / POLL_INTERVAL_MS;

const TIMEOUT_MESSAGE =
  "A transcrição passou de 5 minutos sem resposta. Tente novamente mais tarde.";
const NO_FILE_MESSAGE = "Selecione um arquivo de áudio antes de enviar.";
const GENERIC_FAILURE = "Não foi possível concluir a transcrição deste áudio.";

const PHASE_BY_STATUS: Record<SummaryStatus, Phase> = {
  Pending: "pending",
  Processing: "processing",
  Completed: "completed",
  Failed: "failed",
  Disabled: "disabled",
};

const TERMINAL_PHASES: readonly Phase[] = ["completed", "failed", "disabled"];

function phaseForStatus(status: SummaryStatus): Phase {
  return PHASE_BY_STATUS[status] ?? "failed";
}

function isTerminal(phase: Phase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

function authorFor(phase: Phase): ThreadMessage["author"] {
  if (phase === "uploading") return "user";
  if (phase === "completed") return "summary";
  return "system";
}

export interface UseTranscription {
  phase: Phase;

  progress: number;
  file: SelectedFile | null;
  audio: AudioFileDto | null;
  summary: AudioSummaryDto | null;
  error: string | null;
  validation: AudioValidationState;
  canUpload: boolean;
  messages: ThreadMessage[];
  selectFile: (file: File) => void;
  clearFile: () => void;
  start: () => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
}

export function useTranscription(): UseTranscription {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [audio, setAudio] = useState<AudioFileDto | null>(null);
  const [summary, setSummary] = useState<AudioSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<AudioValidationState>({ status: "idle" });
  const [messages, setMessages] = useState<ThreadMessage[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ticksRef = useRef(0);
  const seqRef = useRef(0);
  const lastPhaseRef = useRef<Phase>("idle");
  const fileRef = useRef<SelectedFile | null>(null);
  const audioRef = useRef<AudioFileDto | null>(null);
  const validationRef = useRef<AudioValidationState>({ status: "idle" });
  const validationSeqRef = useRef(0);
  const validationAbortRef = useRef<AbortController | null>(null);
  const validationTaskRef = useRef<Promise<AudioValidationState> | null>(null);

  const generationRef = useRef(0);
  const isCurrent = useCallback((generation: number) => generationRef.current === generation, []);

  const updateValidation = useCallback((next: AudioValidationState) => {
    validationRef.current = next;
    setValidation(next);
  }, []);

  const cancelValidation = useCallback(() => {
    validationSeqRef.current += 1;
    validationAbortRef.current?.abort();
    validationAbortRef.current = null;
    validationTaskRef.current = null;
  }, []);

  const stopPoller = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const transition = useCallback((next: Phase) => {
    setPhase(next);
    if (lastPhaseRef.current === next) return;
    lastPhaseRef.current = next;
    seqRef.current += 1;
    const message: ThreadMessage = {
      id: `msg-${seqRef.current}`,
      author: authorFor(next),
      phase: next,
      createdAt: Date.now(),
    };
    setMessages((previous) => [...previous, message]);
  }, []);

  const poll = useCallback(
    async (id: string, generation: number) => {
      if (ticksRef.current >= MAX_POLL_TICKS) {
        stopPoller();
        setError(TIMEOUT_MESSAGE);
        transition("failed");
        return;
      }
      ticksRef.current += 1;

      let dto: AudioSummaryDto;
      try {
        dto = await getSummary(id);
      } catch (cause) {
        if (!isCurrent(generation) || intervalRef.current === null) return;
        stopPoller();
        setError(cause instanceof ApiError ? cause.message : GENERIC_FAILURE);
        transition("failed");
        return;
      }

      if (!isCurrent(generation) || intervalRef.current === null) return;

      setSummary(dto);
      const next = phaseForStatus(dto.status);
      if (isTerminal(next)) {
        stopPoller();
        setError(next === "failed" ? (dto.error?.trim() || GENERIC_FAILURE) : null);
      }
      transition(next);
    },
    [isCurrent, stopPoller, transition],
  );

  const startPoller = useCallback(
    (id: string, generation: number) => {
      stopPoller();

      if (!isCurrent(generation)) return;
      ticksRef.current = 0;
      intervalRef.current = setInterval(() => {
        void poll(id, generation);
      }, POLL_INTERVAL_MS);
    },
    [isCurrent, poll, stopPoller],
  );

  const selectFile = useCallback(
    (next: File) => {
      cancelValidation();
      if (fileRef.current) URL.revokeObjectURL(fileRef.current.objectUrl);
      const selected: SelectedFile = {
        file: next,
        name: next.name,
        sizeBytes: next.size,
        objectUrl: URL.createObjectURL(next),
      };
      fileRef.current = selected;
      setFile(selected);
      setError(null);
      updateValidation({ status: "validating" });

      const validationSeq = validationSeqRef.current;
      const controller = new AbortController();
      validationAbortRef.current = controller;
      const task = validateAudioFileInBackground(next, controller.signal)
        .then<AudioValidationState>((result) =>
          result.valid ? { status: "valid" } : { status: "invalid", message: result.message },
        )
        .catch<AudioValidationState>((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") {
            return { status: "idle" };
          }
          return {
            status: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "Não foi possível validar o arquivo de áudio.",
          };
        });
      validationTaskRef.current = task;
      void task.then((nextState) => {
        if (validationSeqRef.current !== validationSeq || fileRef.current !== selected) return;
        validationAbortRef.current = null;
        validationTaskRef.current = null;
        updateValidation(nextState);
      });
    },
    [cancelValidation, updateValidation],
  );

  const clearFile = useCallback(() => {
    cancelValidation();
    if (fileRef.current) URL.revokeObjectURL(fileRef.current.objectUrl);
    fileRef.current = null;
    setFile(null);
    setError(null);
    updateValidation({ status: "idle" });
  }, [cancelValidation, updateValidation]);

  const start = useCallback(async () => {
    const selected = fileRef.current;
    if (!selected) {
      setError(NO_FILE_MESSAGE);
      transition("failed");
      return;
    }

    const pendingValidation = validationTaskRef.current;
    if (pendingValidation) await pendingValidation;

    const validationState = validationRef.current;
    if (fileRef.current !== selected || validationState.status !== "valid") {
      if (validationState.status === "invalid" || validationState.status === "error") {
        setError(validationState.message);
      }
      return;
    }

    stopPoller();

    generationRef.current += 1;
    const generation = generationRef.current;

    audioRef.current = null;
    setAudio(null);
    setSummary(null);
    setError(null);
    setProgress(0);
    transition("uploading");

    let dto: AudioFileDto;
    try {
      dto = await uploadAudio(selected.file, { onProgress: setProgress });
    } catch (cause) {
      if (!isCurrent(generation)) return;
      setError(cause instanceof ApiError ? cause.message : GENERIC_FAILURE);
      transition("failed");
      return;
    }

    if (!isCurrent(generation)) return;

    audioRef.current = dto;
    setAudio(dto);

    const next = phaseForStatus(dto.summaryStatus);
    if (next === "pending" || next === "processing") {
      transition(next);
      startPoller(dto.id, generation);
      return;
    }

    if (next === "failed") setError(dto.summaryError?.trim() || GENERIC_FAILURE);
    transition(next);
  }, [isCurrent, startPoller, stopPoller, transition]);

  const retry = useCallback(async () => {
    const existing = audioRef.current;
    if (!existing) {
      await start();
      return;
    }
    generationRef.current += 1;
    setError(null);
    transition("pending");
    startPoller(existing.id, generationRef.current);
  }, [start, startPoller, transition]);

  const reset = useCallback(() => {
    stopPoller();
    cancelValidation();

    generationRef.current += 1;
    if (fileRef.current) URL.revokeObjectURL(fileRef.current.objectUrl);
    fileRef.current = null;
    audioRef.current = null;
    ticksRef.current = 0;
    lastPhaseRef.current = "idle";
    setFile(null);
    setAudio(null);
    setSummary(null);
    setError(null);
    updateValidation({ status: "idle" });
    setProgress(0);
    setMessages([]);
    setPhase("idle");
  }, [cancelValidation, stopPoller, updateValidation]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      cancelValidation();
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      intervalRef.current = null;
      if (fileRef.current) URL.revokeObjectURL(fileRef.current.objectUrl);
    };
  }, [cancelValidation]);

  return {
    phase,
    progress,
    file,
    audio,
    summary,
    error,
    validation,
    canUpload: phase === "idle" && file !== null && validation.status === "valid",
    messages,
    selectFile,
    clearFile,
    start,
    retry,
    reset,
  };
}
