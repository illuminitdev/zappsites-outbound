"use client";

import { useActionState, useRef } from "react";
import { Mail, Pencil, X } from "lucide-react";
import { updateLeadEmail, type EmailEditState } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

/** Pencil next to the lead's email: opens a small dialog to correct it (and re-send emails that failed). */
export function EditEmailButton({ leadId, email, failed }: { leadId: string; email: string | null; failed: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState<EmailEditState, FormData>(updateLeadEmail, null);
  const close = () => ref.current?.close();

  return (
    <>
      <button type="button" className="ld-contact-edit" onClick={() => ref.current?.showModal()} aria-label={email ? "Edit email" : "Add email"} title={email ? "Edit email" : "Add email"}>
        <Pencil size={14} aria-hidden="true" />
      </button>
      <dialog ref={ref} className="modal modal-md" aria-label="Edit email" onClick={(e) => e.target === ref.current && close()}>
        <div className="modal-head">
          <h2>{email ? "Edit email" : "Add email"}</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          <form action={action} className="confirm-form">
            <input type="hidden" name="id" value={leadId} />
            {email && (
              <p className="muted small">
                Now: <s>{email}</s>
              </p>
            )}
            <label className="email-edit-field">
              <Mail size={15} aria-hidden="true" />
              <input name="email" type="text" inputMode="email" autoComplete="off" required defaultValue={email ?? ""} placeholder="info@company.co.uk" autoFocus />
            </label>
            <p className="muted small">
              {failed
                ? "Emails that failed to the old address will be scheduled again to the new one."
                : "Any emails still to be sent will go to the new address."}
            </p>
            {state && !state.ok && <p className="email-edit-error">{state.error}</p>}
            <div className="confirm-actions">
              <button type="button" className="secondary" onClick={close}>
                Cancel
              </button>
              <SubmitButton pending="Checking...">Save email</SubmitButton>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
