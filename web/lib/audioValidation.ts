export const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024;

export type AudioValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export interface AudioValidationRequest {
  requestId: number;
  file: File;
}

export type AudioValidationResponse =
  | { requestId: number; result: AudioValidationResult }
  | { requestId: number; error: true };

export type AudioValidationState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "valid" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

interface AudioFormat {
  label: string;
  mimeTypes: readonly string[];
  hasValidSignature: (bytes: Uint8Array) => boolean;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

const AUDIO_FORMATS: Readonly<Record<string, AudioFormat>> = {
  ".mp3": {
    label: "MP3",
    mimeTypes: ["audio/mpeg", "audio/mp3"],
    hasValidSignature: (bytes) =>
      startsWith(bytes, [0x49, 0x44, 0x33]) ||
      (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
  },
  ".wav": {
    label: "WAV",
    mimeTypes: ["audio/wav", "audio/x-wav", "audio/wave"],
    hasValidSignature: (bytes) =>
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8),
  },
  ".ogg": {
    label: "OGG",
    mimeTypes: ["audio/ogg", "application/ogg"],
    hasValidSignature: (bytes) => startsWith(bytes, [0x4f, 0x67, 0x67, 0x53]),
  },
  ".flac": {
    label: "FLAC",
    mimeTypes: ["audio/flac", "audio/x-flac"],
    hasValidSignature: (bytes) => startsWith(bytes, [0x66, 0x4c, 0x61, 0x43]),
  },
  ".m4a": {
    label: "M4A",
    mimeTypes: ["audio/mp4", "audio/x-m4a", "audio/m4a"],
    hasValidSignature: (bytes) => {
      if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
      return ["M4A ", "M4B ", "isom", "iso2", "mp41", "mp42", "qt  "].includes(
        ascii(bytes, 8, 4),
      );
    },
  },
  ".aac": {
    label: "AAC",
    mimeTypes: ["audio/aac", "audio/aacp", "audio/x-aac"],
    hasValidSignature: (bytes) =>
      bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0,
  },
  ".webm": {
    label: "WEBM",
    mimeTypes: ["audio/webm"],
    hasValidSignature: (bytes) => startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]),
  },
};

function extensionOf(name: string): string {
  const match = /(?:^|\/)(?:.*)(\.[^.\/]+)$/.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Não foi possível ler o arquivo."));
    reader.readAsArrayBuffer(blob);
  });
}

export async function validateAudioFile(file: File): Promise<AudioValidationResult> {
  const extension = extensionOf(file.name);
  const format = AUDIO_FORMATS[extension];

  if (!format) {
    const shownExtension = extension || "ausente";
    return {
      valid: false,
      message: `A extensão ${shownExtension} não é permitida. Use MP3, WAV, OGG, FLAC, M4A, AAC ou WEBM.`,
    };
  }

  const mimeType = file.type.trim().toLowerCase();
  if (!format.mimeTypes.includes(mimeType)) {
    return {
      valid: false,
      message: `O tipo do arquivo (${mimeType || "não informado"}) não é compatível com a extensão ${extension}.`,
    };
  }

  if (file.size === 0) {
    return { valid: false, message: "O arquivo de áudio está vazio." };
  }

  if (file.size > MAX_AUDIO_SIZE_BYTES) {
    return { valid: false, message: "O arquivo excede o tamanho máximo de 50 MB." };
  }

  const bytes = await readBytes(file.slice(0, 16));
  if (!format.hasValidSignature(bytes)) {
    return {
      valid: false,
      message: `O conteúdo do arquivo não corresponde a um áudio ${format.label} válido.`,
    };
  }

  return { valid: true };
}
