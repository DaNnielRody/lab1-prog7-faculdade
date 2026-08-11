"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/ui/cn";

/** {timing.toast-dwell} — a WCAG SC 2.2.1 time limit, not motion. Never scaled by reduced-motion. */
export const TOAST_DWELL_MS = 8000;

export interface ToastNotice {
  /** Bumped per failed attempt so a repeated failure produces a new object and restarts the dwell. */
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ToastProps {
  notice: ToastNotice | null;
  /**
   * True while any dialog is open: showModal() puts it in the top layer, above {z.toast} and
   * behind {component.scrim}, so the toast is unreadable and its dwell must hold.
   */
  paused?: boolean;
  onDismiss: () => void;
  className?: string;
}

export function Toast({ notice, paused = false, onDismiss, className }: ToastProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = paused || hovered || focused;

  useEffect(() => {
    if (!notice || held) return;
    const timer = setTimeout(onDismiss, TOAST_DWELL_MS);
    return () => clearTimeout(timer);
  }, [notice, held, onDismiss]);

  return (
    // The host is mounted from first render and left in the DOM when empty: a live region
    // injected together with its content is frequently not announced. role="status", never
    // "alert" — nothing failed that the user initiated, and §8 Don't 10 reserves the alert for
    // the primary flow. It composes with the thread's role="log" because the two never carry
    // the same content; the processed list itself stays without aria-live.
    <div
      role="status"
      aria-atomic="true"
      className={cn(
        "on-rail pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-start p-4",
        "xl:bottom-player-bar xl:left-rail xl:right-panel xl:px-6 xl:pt-0 xl:pb-4",
        className,
      )}
    >
      {notice ? (
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={() => setFocused(false)}
          className="pointer-events-auto flex w-full max-w-bubble flex-wrap items-center gap-3 rounded-md bg-rail px-4 py-3"
        >
          <span className="min-w-0 flex-1 text-body text-rail-text">{notice.message}</span>
          {notice.actionLabel ? (
            <button
              type="button"
              onClick={notice.onAction}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-rail-hairline px-4 py-2 text-label text-rail-text hover:bg-rail-raised xl:min-h-0"
            >
              {notice.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dispensar aviso"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full p-2 text-label text-rail-muted hover:bg-rail-raised xl:min-h-0 xl:min-w-0"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
