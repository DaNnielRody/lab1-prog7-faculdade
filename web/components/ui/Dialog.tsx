"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./cn";

export type DialogWidth = 480 | 520 | 540;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;

  subtitle?: string;

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
        event.preventDefault();
        if (dismissable) onClose();
      }}
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0"
    >
      {open ? (
        <>
          <div className="fixed inset-0 bg-rail/42" />
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

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-4 px-6 pt-4", className)}>{children}</div>;
}
