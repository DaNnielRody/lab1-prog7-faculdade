import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listAudios } from "@/lib/api";
import { useProcessedAudios } from "@/lib/useProcessedAudios";
import type { AudioFileDto, Phase } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listAudios: vi.fn() };
});

const listAudiosMock = vi.mocked(listAudios);

function pendingAudio(): AudioFileDto {
  return {
    id: "accepted-audio",
    originalFileName: "nova-aula.mp3",
    storedFileName: "nova-aula.mp3",
    url: "http://localhost:5218/files/nova-aula.mp3",
    contentType: "audio/mpeg",
    sizeBytes: 4096,
    createdAtUtc: "2026-08-23T12:00:00Z",
    processingStatus: "Pending",
    summaryStatus: "Pending",
  };
}

describe("useProcessedAudios", () => {
  beforeEach(() => {
    listAudiosMock.mockReset();
  });

  it("adds a server-accepted Pending audio immediately while refreshing the list", async () => {
    listAudiosMock.mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ phase, accepted }: { phase: Phase; accepted: AudioFileDto | null }) =>
        useProcessedAudios(phase, accepted),
      { initialProps: { phase: "idle" as Phase, accepted: null as AudioFileDto | null } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => rerender({ phase: "pending", accepted: pendingAudio() }));

    await waitFor(() => expect(listAudiosMock).toHaveBeenCalledTimes(2));

    // A GET can briefly lag behind the POST. Its empty response must not erase the accepted DTO
    // or stop the Pending/Processing poller.
    expect(result.current.audios).toEqual([pendingAudio()]);
  });
});
