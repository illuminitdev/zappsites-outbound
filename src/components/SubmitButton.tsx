"use client";

import { useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { ModalClose } from "./Modal";

/** Form submit button that shows a spinner and e.g. "Importing..." while the server action runs. */
export function SubmitButton({ children, pending: pendingText, className = "btn-primary" }: { children: ReactNode; pending: string; className?: string }) {
  const { pending } = useFormStatus();
  const closeModal = useContext(ModalClose);
  const was = useRef(false);
  // Inside a modal: keep it open (with the spinner) while the action runs, then close it.
  useEffect(() => {
    if (was.current && !pending) closeModal?.();
    was.current = pending;
  }, [pending, closeModal]);
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <LoaderCircle size={16} className="spin" aria-hidden="true" />
          {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
