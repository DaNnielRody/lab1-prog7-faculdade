import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom implements neither of these; the player and the dropzone both need them.
if (typeof URL.createObjectURL === "undefined") {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), writable: true });
}
if (typeof URL.revokeObjectURL === "undefined") {
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
}
if (typeof window.HTMLMediaElement !== "undefined") {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
}
if (typeof window.HTMLDialogElement !== "undefined") {
  window.HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  window.HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
}
