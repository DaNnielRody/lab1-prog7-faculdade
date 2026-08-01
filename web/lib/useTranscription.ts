"use client";

/**
 * The transcription session phase machine: upload with real progress, then poll the summary.
 * Owns the single poller interval — no component ever polls.
 * See .claude/contexts/frontend/CONTEXT.md → "Phase", "Poller", "Thread".
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getSummary, uploadAudio } from "@/lib/api";
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

/**
 * Maps an API status to a phase, failing loud on anything unknown.
 *
 * A bare lookup returns `undefined` for a status this build has never heard of (a sixth
 * SummaryStatus, a proxy rewriting the body). `undefined` is not terminal, so the poller would
 * keep running against a thread that renders nothing — a blank screen for five minutes. Treating
 * it as a failure at least tells the user something happened.
 */
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
  /** 0..100, only meaningful while the phase is `uploading`. */
  progress: number;
  file: SelectedFile | null;
  audio: AudioFileDto | null;
  summary: AudioSummaryDto | null;
  error: string | null;
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
  const [messages, setMessages] = useState<ThreadMessage[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ticksRef = useRef(0);
  const seqRef = useRef(0);
  const lastPhaseRef = useRef<Phase>("idle");
  const fileRef = useRef<SelectedFile | null>(null);
  const audioRef = useRef<AudioFileDto | null>(null);

  /**
   * Identifies the live session. `start()`, `retry()` and `reset()` open a new one, and unmount
   * closes the last one for good. Every async continuation captures the generation it belongs to
   * and drops itself if that generation is no longer current.
   *
   * `intervalRef` cannot carry this on its own: between `start()` and the upload resolving there
   * is no interval yet, so a `reset()` or an unmount in that window leaves nothing for the
   * continuation to notice — it would revive a cleared session, or start a poller that outlives
   * the component and calls the API every 2s for the life of the page.
   */
  const generationRef = useRef(0);
  const isCurrent = useCallback((generation: number) => generationRef.current === generation, []);

  const stopPoller = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /** Moves to `next`; appends exactly one message, and nothing when the phase repeats. */
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
        // Same guard as the success path: a reset(), an unmount or a terminal phase that landed
        // while the request was in flight already ended the session, so a late rejection must not
        // revive it.
        if (!isCurrent(generation) || intervalRef.current === null) return;
        stopPoller();
        setError(cause instanceof ApiError ? cause.message : GENERIC_FAILURE);
        transition("failed");
        return;
      }

      // Stopped, reset or unmounted while the request was in flight.
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
      // The session this poller belongs to ended while its upload was in flight; starting an
      // interval now would outlive the component and hit the API every 2s forever.
      if (!isCurrent(generation)) return;
      ticksRef.current = 0;
      intervalRef.current = setInterval(() => {
        void poll(id, generation);
      }, POLL_INTERVAL_MS);
    },
    [isCurrent, poll, stopPoller],
  );

  const selectFile = useCallback((next: File) => {
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
  }, []);

  const clearFile = useCallback(() => {
    if (fileRef.current) URL.revokeObjectURL(fileRef.current.objectUrl);
    fileRef.current = null;
    setFile(null);
  }, []);

  const start = useCallback(async () => {
    const selected = fileRef.current;
    if (!selected) {
      setError(NO_FILE_MESSAGE);
      transition("failed");
      return;
    }

    stopPoller();
    // A fresh upload opens a new session: any continuation still pending from the previous one
    // (an in-flight upload, a poll response on the wire) is now stale and must drop itself.
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

    // The user hit "Recomeçar", or the component unmounted, while the bytes were on the wire.
    // The audio is stored server-side either way, but this screen has moved on.
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
    // Ends the session: whatever is still in flight resolves into a generation nobody listens to.
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
    setProgress(0);
    setMessages([]);
    setPhase("idle");
  }, [stopPoller]);

  useEffect(() => {
    return () => {
      // Closes the session for good. Clearing the interval is not enough on its own: an upload
      // still on the wire would resolve after this and start a brand-new poller on a component
      // that no longer exists.
      generationRef.current += 1;
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      intervalRef.current = null;
      if (fileRef.current) URL.revokeObjectURL(fileRef.current.objectUrl);
    };
  }, []);

  return {
    phase,
    progress,
    file,
    audio,
    summary,
    error,
    messages,
    selectFile,
    clearFile,
    start,
    retry,
    reset,
  };
}
