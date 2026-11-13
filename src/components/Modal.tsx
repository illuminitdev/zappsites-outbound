"use client";

import { createContext, useRef, type ReactNode } from "react";
import { FileSearch, Pencil, Plus, Upload, X } from "lucide-react";

// Icons are picked by name: a server page can't pass a component function to this client component.
const ICONS = { plus: Plus, upload: Upload, pencil: Pencil, audit: FileSearch };
const VARIANTS = { primary: "btn-link", secondary: "btn-link btn-outline", small: "secondary sm" };

/** Lets a SubmitButton inside the dialog close it once its server action has finished. */
export const ModalClose = createContext<(() => void) | null>(null);

/** A button that opens its children in a centred, floating dialog. Esc, the X or a click on the backdrop closes it. */
export function ModalButton({
  label,
  title,
  children,
  icon = "plus",
  variant = "primary",
  size = "lg",
}: {
  label: string;
  title: string;
  children: ReactNode;
  icon?: keyof typeof ICONS;
  variant?: keyof typeof VARIANTS;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const Icon = ICONS[icon];
  const close = () => ref.current?.close();

  return (
    <>
      <button type="button" className={VARIANTS[variant]} onClick={() => ref.current?.showModal()}>
        <Icon size={variant === "small" ? 14 : 16} aria-hidden="true" />
        {label}
      </button>
      <dialog
        ref={ref}
        className={size === "md" ? "modal modal-md" : "modal"}
        aria-label={title}
        onClick={(e) => e.target === ref.current && close()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          <ModalClose.Provider value={close}>{children}</ModalClose.Provider>
        </div>
      </dialog>
    </>
  );
}
