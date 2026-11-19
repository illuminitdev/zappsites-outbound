"use client";

import { useRef } from "react";
import { CalendarCheck, X } from "lucide-react";
import { meetingBooked } from "@/app/actions";
import { ModalClose } from "@/components/Modal";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Admin-only "Mark meeting booked" button. Asks for confirmation in a styled dialog first,
 * because the action stops the sequence and can't be undone except by resetting the lead.
 * (Prospects who book through the public booking page are not affected by this.)
 */
export function MeetingBookedButton({ leadId, company }: { leadId: string; company: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();

  return (
    <>
      <button type="button" className="secondary" onClick={() => ref.current?.showModal()}>
        Mark meeting booked
      </button>
      <dialog
        ref={ref}
        className="modal modal-md"
        aria-label="Mark meeting booked"
        onClick={(e) => e.target === ref.current && close()}
      >
        <div className="modal-head">
          <h2>Mark meeting booked?</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          <form action={meetingBooked} className="confirm-form">
            <input type="hidden" name="id" value={leadId} />
            <p className="confirm-lead">
              <CalendarCheck size={18} aria-hidden="true" />
              Mark <strong>{company}</strong> as meeting booked?
            </p>
            <p className="muted">This stops any emails still to be sent. It does not add an entry to Bookings.</p>
            <div className="confirm-actions">
              <button type="button" className="secondary" onClick={close}>
                Cancel
              </button>
              <ModalClose.Provider value={close}>
                <SubmitButton pending="Saving...">Yes, mark booked</SubmitButton>
              </ModalClose.Provider>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
