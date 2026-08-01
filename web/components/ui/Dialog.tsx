"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * {component.dialog} + {component.scrim} — docs/DESIGN.md §7 Overlays.
 * Built on the native <dialog> element: focus trap, focus restore and Escape come from the
 * platform, so no dependency is added. {component.dialog-confirm} passes dismissable={false},
 * because a destructive action requires an explicit choice.
 */
export type DialogWidth = 480 | 520 | 540;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional subline in {type.body} {colors.text.secondary}. */
  subtitle?: string;
  /** Documented widths only — docs/DESIGN.md §4: 540 upload, 520 outcome, 480 confirm. */
  width?: DialogWidth;
  dismissable?: boolean;
  children: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  width = 520,
  dismissable = true,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        // Escape: the platform's own close request.
        event.preventDefault();
        if (dismissable) onClose();
      }}
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0"
    >
      {open ? (
        <>
          {/* {component.scrim} — {colors.ink.base} at 42%, dismisses unless the dialog is a confirm. */}
          <div className="fixed inset-0 bg-rail/42" />
          {/*
            The centering layer is a later sibling of the scrim, so it paints on top and would
            swallow every outside click. It lets them through and the card takes them back, which
            keeps the documented click-outside-to-dismiss path alive without a z-index ladder.
          */}
          <div
            className="pointer-events-none fixed inset-0 flex items-center justify-center p-4"
            onClick={dismissable ? onClose : undefined}
          >
            <div
              role="document"
              style={{ width: `${width}px` }}
              onClick={(event) => event.stopPropagation()}
              className="pointer-events-auto relative flex max-w-full flex-col overflow-hidden rounded-lg bg-canvas shadow-dialog"
            >
              <header className="flex items-start gap-4 px-6 pt-6">
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="text-title font-semibold text-text">{title}</h2>
                  {subtitle ? (
                    <p className="text-body text-text-secondary">{subtitle}</p>
                  ) : null}
                </div>
                {dismissable ? (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Fechar"
                    className="ml-auto shrink-0 rounded-full p-2 text-label text-text-secondary hover:bg-surface-muted"
                  >
                    ✕
                  </button>
                ) : null}
              </header>
              {children}
            </div>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

/** {component.dialog-footer} — muted surface, top hairline, buttons right-aligned, primary last. */
export function DialogFooter({
  note,
  className,
  children,
}: {
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-4 flex items-center gap-2 border-t border-hairline bg-surface-muted px-6 pt-4 pb-5",
        className,
      )}
    >
      {note ? <span className="text-caption text-text-secondary">{note}</span> : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Body wrapper — {spacing.6} sides, {spacing.4} row gap (docs/DESIGN.md §7). */
export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-4 px-6 pt-4", className)}>{children}</div>;
}
