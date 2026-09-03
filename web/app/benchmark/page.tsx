"use client";

import { useState } from "react";

import {
  validateAudioBytes,
  validateAudioFileSequential,
} from "@/lib/audioValidation";
import { validateAudioFileInBackground } from "@/lib/audioValidationClient";

const ITERATIONS = 12;
const PAYLOAD_BYTES = 8 * 1024 * 1024;
const MP3_HEADER = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);

type BenchmarkRow = {
  mode: "sequential" | "worker";
  iterations: number;
  payloadBytes: number;
  totalMs: number;
  averageMs: number;
  eventLoopDelayMs: number;
};

function createFixture(): File {
  const bytes = new Uint8Array(PAYLOAD_BYTES);
  bytes.set(MP3_HEADER);
  return new File([bytes], "browser-benchmark.mp3", { type: "audio/mpeg" });
}

async function measureSequential(file: File): Promise<BenchmarkRow> {
  const timerStarted = performance.now();
  const eventLoop = new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - timerStarted), 0);
  });
  const started = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) {
    const result = await validateAudioFileSequential(file);
    if (!result.valid) throw new Error(result.message);
  }
  const totalMs = performance.now() - started;
  return {
    mode: "sequential",
    iterations: ITERATIONS,
    payloadBytes: file.size,
    totalMs,
    averageMs: totalMs / ITERATIONS,
    eventLoopDelayMs: await eventLoop,
  };
}

async function measureWorker(file: File): Promise<BenchmarkRow> {
  const timerStarted = performance.now();
  const eventLoop = new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - timerStarted), 0);
  });
  const started = performance.now();
  const results = [];
  // Keep the workload equal to the current product behaviour: one selected file at a time. The
  // Worker still runs off the main thread, but we intentionally do not turn this into a synthetic
  // pool benchmark with Promise.all.
  for (let i = 0; i < ITERATIONS; i += 1) {
    results.push(await validateAudioFileInBackground(file, undefined, "parallel"));
  }
  if (results.some((result) => !result.valid)) throw new Error("A validação do Worker falhou.");
  const totalMs = performance.now() - started;
  return {
    mode: "worker",
    iterations: ITERATIONS,
    payloadBytes: file.size,
    totalMs,
    averageMs: totalMs / ITERATIONS,
    eventLoopDelayMs: await eventLoop,
  };
}

export default function ClientBenchmarkPage() {
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runBenchmark() {
    setRunning(true);
    setError(null);
    try {
      const file = createFixture();
      // Keep the synchronous core exercised in the browser too; it is the baseline used by the
      // headless benchmark and proves that both paths validate the same header.
      const core = validateAudioBytes({
        name: file.name,
        type: file.type,
        size: file.size,
        bytes: new Uint8Array(await file.slice(0, 16).arrayBuffer()),
      });
      if (!core.valid) throw new Error(core.message);
      setRows([await measureSequential(file), await measureWorker(file)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao executar o benchmark.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main style={{ fontFamily: "monospace", maxWidth: 960, margin: "0 auto", padding: 32 }}>
      <h1>Activity #1 — benchmark do cliente</h1>
      <p>
        Instrumentação não ligada à navegação: compara validação serial na thread principal com o
        Web Worker real gerado pelo build. O validador lê somente os primeiros 16 bytes.
      </p>
      <button type="button" onClick={() => void runBenchmark()} disabled={running}>
        {running ? "Executando…" : "Executar benchmark"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      <pre>{JSON.stringify(rows, null, 2)}</pre>
    </main>
  );
}
