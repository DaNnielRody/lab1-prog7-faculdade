import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_DWELL_MS, Toast, type ToastNotice } from "@/components/ui/Toast";

function notice(overrides: Partial<ToastNotice> = {}): ToastNotice {
  return {
    id: 1,
    message: "Não foi possível carregar os áudios processados.",
    actionLabel: "Recarregar a lista",
    onAction: vi.fn(),
    ...overrides,
  };
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function dwell(ms = TOAST_DWELL_MS) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  // A live region injected together with its content is frequently not announced, so the host
  // must pre-exist and the notice must arrive as a mutation.
  it("keeps its status host mounted and empty when there is no notice", () => {
    render(<Toast notice={null} onDismiss={vi.fn()} />);

    const host = screen.getByRole("status");
    expect(host).toBeInTheDocument();
    expect(host).toBeEmptyDOMElement();
  });

  it("dismisses itself after the dwell", async () => {
    const onDismiss = vi.fn();
    render(<Toast notice={notice()} onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();
    await dwell();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("holds the dwell while the pointer is over it", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Toast notice={notice()} onDismiss={onDismiss} />);

    await user.hover(screen.getByText("Não foi possível carregar os áudios processados."));
    await dwell(TOAST_DWELL_MS * 2);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  // WCAG SC 2.2.1: a keyboard user tabbing to the action must not have it vanish under the caret.
  it("holds the dwell while focus is inside it", async () => {
    const onDismiss = vi.fn();
    render(<Toast notice={notice()} onDismiss={onDismiss} />);

    act(() => screen.getByRole("button", { name: "Recarregar a lista" }).focus());
    await dwell(TOAST_DWELL_MS * 2);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  // showModal() puts a dialog in the top layer, above {z.toast} and behind the scrim: letting the
  // timer run would spend the notice on a screen the user cannot see.
  it("holds the dwell while a dialog is open", async () => {
    const onDismiss = vi.fn();
    render(<Toast notice={notice()} onDismiss={onDismiss} paused />);

    await dwell(TOAST_DWELL_MS * 2);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("runs the action and can be dismissed by hand", async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Toast notice={notice({ onAction })} onDismiss={onDismiss} />);

    await user.click(screen.getByRole("button", { name: "Recarregar a lista" }));
    expect(onAction).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Dispensar aviso" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  // `error` never returns to null between two consecutive failures, so the id is the only rising
  // edge a repeated failure produces.
  it("restarts the dwell when a repeated failure produces a new id", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast notice={notice({ id: 1 })} onDismiss={onDismiss} />);

    await dwell(TOAST_DWELL_MS - 1000);
    rerender(<Toast notice={notice({ id: 2 })} onDismiss={onDismiss} />);

    await dwell(TOAST_DWELL_MS - 1000);
    expect(onDismiss).not.toHaveBeenCalled();

    await dwell(1000);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
