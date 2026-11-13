"use client";

import { useContext, useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { ModalClose } from "./Modal";

/**
 * Form submit button that shows a spinner and e.g. "Saving..." while the server action runs.
 * In a form with several buttons, only the one that was clicked shows the spinner; all are disabled.
 */
export function SubmitButton({
  children,
  pending: pendingText,
  className = "btn-primary",
  formAction,
  formNoValidate,
  style,
}: {
  children: ReactNode;
  pending: string;
  className?: string;
  formAction?: (f: FormData) => void | Promise<void>;
  formNoValidate?: boolean;
  style?: CSSProperties;
}) {
  const { pending } = useFormStatus();
  const closeModal = useContext(ModalClose);
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const was = useRef(false);

  useEffect(() => {
    // Inside a modal: keep it open (with the spinner) while the action runs, then close it.
    if (was.current && !pending) {
      closeModal?.();
      if (ref.current?.form) delete ref.current.form.dataset.submitter;
    }
    was.current = pending;
  }, [pending, closeModal]);

  const submitter = ref.current?.form?.dataset.submitter;
  const mine = pending && (!submitter || submitter === id);

  return (
    <button
      ref={ref}
      className={className}
      style={style}
      formAction={formAction}
      formNoValidate={formNoValidate}
      disabled={pending}
      aria-busy={mine}
      onClick={(e) => {
        const form = e.currentTarget.form;
        if (form) form.dataset.submitter = id;
      }}
    >
      {mine ? (
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
