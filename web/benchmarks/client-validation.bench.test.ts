import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  validateAudioBytes,
  validateAudioFileSequential,
  type AudioValidationResponse,
} from "@/lib/audioValidation";
import { validateAudioFileInBackground } from "@/lib/audioValidationClient";

const MP3_HEADER = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
const SIZES = [16 * 1024, 256 * 1024, 1024 * 1024];
const ITERATIONS = 40;

function fixture(size: number): { file: File; bytes: Uint8Array } {
  const bytes = new Uint8Array(size);
  bytes.set(MP3_HEADER);
  return {
    bytes,
    file: new File([bytes], `benchmark-${size}.mp3`, { type: "audio/mpeg" }),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * This is a protocol-faithful Worker double for the headless benchmark. It still pays for the
 * postMessage/message/terminate lifecycle, while the actual browser Worker is covered by the
 * application tests. A browser run is needed to claim a main-thread responsiveness improvement.
 */
class BenchmarkWorker {
  onmessage: ((event: MessageEvent<AudioValidationResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();

  postMessage(request: { requestId: number; file: File }): void {
    void validateAudioFileSequential(request.file).then((result) => {
      this.onmessage?.(
        new MessageEvent("message", {
          data: { requestId: request.requestId, result },
        }),
      );
    });
  }
}

describe("client validation benchmark", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("measures sequential core, sequential File API and Worker dispatch for the same files", async () => {
    vi.stubGlobal("Worker", BenchmarkWorker);
    const rows: Array<Record<string, number>> = [];

    for (const size of SIZES) {
      const { file, bytes } = fixture(size);
      const sequentialSamples: number[] = [];
      const fileApiSamples: number[] = [];
      const workerSamples: number[] = [];

      // Warm-up removes the first Blob allocation and module JIT from the samples.
      validateAudioBytes({ name: file.name, type: file.type, size: file.size, bytes: bytes.slice(0, 16) });
      await validateAudioFileSequential(file);
      await validateAudioFileInBackground(file);

      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        let started = performance.now();
        const sequential = validateAudioBytes({
          name: file.name,
          type: file.type,
          size: file.size,
          bytes: bytes.slice(0, 16),
        });
        sequentialSamples.push(performance.now() - started);
        expect(sequential).toEqual({ valid: true });

        started = performance.now();
        const fileApi = await validateAudioFileSequential(file);
        fileApiSamples.push(performance.now() - started);
        expect(fileApi).toEqual({ valid: true });

        started = performance.now();
        const worker = await validateAudioFileInBackground(file);
        workerSamples.push(performance.now() - started);
        expect(worker).toEqual({ valid: true });
      }

      rows.push({
        bytes: size,
        iterations: ITERATIONS,
        sequential_core_p50_ms: median(sequentialSamples),
        sequential_file_api_p50_ms: median(fileApiSamples),
        worker_dispatch_p50_ms: median(workerSamples),
        sequential_core_avg_ms: average(sequentialSamples),
        sequential_file_api_avg_ms: average(fileApiSamples),
        worker_dispatch_avg_ms: average(workerSamples),
      });
    }

    // Copy this line to docs/benchmarks/client-validation.json when refreshing the committed
    // evidence. Keeping the output machine-readable makes the chart reproducible without parsing
    // Vitest's human-oriented reporter.
    console.log(`BENCHMARK_JSON ${JSON.stringify(rows)}`);
    expect(rows).toHaveLength(SIZES.length);
  });
});
