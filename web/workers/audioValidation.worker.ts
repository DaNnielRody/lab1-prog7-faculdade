/// <reference lib="webworker" />

import {
  validateAudioFile,
  type AudioValidationRequest,
  type AudioValidationResponse,
} from "../lib/audioValidation";

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<AudioValidationRequest>) => {
  const { requestId, file } = event.data;
  try {
    const result = await validateAudioFile(file);
    const response: AudioValidationResponse = { requestId, result };
    workerScope.postMessage(response);
  } catch {
    const response: AudioValidationResponse = { requestId, error: true };
    workerScope.postMessage(response);
  }
};

export {};
