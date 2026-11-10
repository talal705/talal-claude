"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A native modal dialog: the browser traps focus, closes on Escape and returns focus to the opener.
 * Children are rendered only while open, so their state starts fresh each time.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  locked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  /** True while an action is running: Escape does not close the dialog. */
  locked?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClose={onClose}
      onCancel={(event) => {
        if (locked) event.preventDefault();
      }}
    >
      {open && children}
    </dialog>
  );
}
