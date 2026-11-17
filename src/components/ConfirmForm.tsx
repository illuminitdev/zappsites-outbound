"use client";

import type { ReactNode } from "react";

/** A form that asks "are you sure?" before running its server action. */
export function ConfirmForm({ action, message, children }: { action: (f: FormData) => void | Promise<void>; message: string; children: ReactNode }) {
  return (
    <form action={action} onSubmit={(e) => !window.confirm(message) && e.preventDefault()}>
      {children}
    </form>
  );
}
