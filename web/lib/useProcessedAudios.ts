"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, listAudios } from "@/lib/api";
import type { AudioFileDto, Phase } from "@/lib/types";
import { POLL_INTERVAL_MS } from "@/lib/useTranscription";

const LIST_ERROR = "Não foi possível carregar a lista de áudios.";

const TERMINAL_PHASES: readonly Phase[] = ["completed", "failed", "disabled"];

/**
 * Rules #1, #4 and #7 of the processed-card precedence table: a row the server is still
 * working on. It drives the poller here and `aria-busy` in `ProcessedList`, so both read
 * the same predicate instead of deriving it twice.
 */
export function isNonTerminalAudio(audio: AudioFileDto): boolean {
  const processing = audio.processingStatus;
  if (processing === "Pending" || processing === "Processing") return true;
  if (processing === "Failed") return false;

  const summary = audio.summaryStatus;
  return summary !== "Completed" && summary !== "Failed" && summary !== "Disabled";
}

export interface UseProcessedAudios {
  audios: AudioFileDto[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useProcessedAudios(phase: Phase): UseProcessedAudios {
  const [audios, setAudios] = useState<AudioFileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const stopPoller = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    generationRef.current += 1;
    const generation = generationRef.current;

    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);

    let dtos: AudioFileDto[];
    try {
      dtos = await listAudios(controller.signal);
    } catch (cause) {
      if (generationRef.current !== generation) return;
      setError(cause instanceof ApiError ? cause.message : LIST_ERROR);
      setLoading(false);
      return;
    }

    if (generationRef.current !== generation) return;
    setAudios(dtos);
    setError(null);
    setLoading(false);
  }, []);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // The session finished: the server now holds a row whose state the list must show.
  useEffect(() => {
    if (!TERMINAL_PHASES.includes(phase)) return;
    void load();
  }, [phase, load]);

  // Poll only while at least one row is still moving; the flag flips, not the list, so a
  // tick never restarts the interval.
  const polling = audios.some(isNonTerminalAudio);
  useEffect(() => {
    if (!polling) {
      stopPoller();
      return;
    }
    intervalRef.current = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return stopPoller;
  }, [polling, load, stopPoller]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      intervalRef.current = null;
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
  }, []);

  return { audios, loading, error, reload };
}
