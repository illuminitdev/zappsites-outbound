"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";

const ERROR = /error|fail|invalid|missing|must|not set|could not|can't|cannot/i;

/** A small popup that slides in, then disappears after a few seconds (longer for long messages). */
export function Toast({ msg }: { msg: string }) {
  const [open, setOpen] = useState(true);
  const isError = ERROR.test(msg);

  useEffect(() => {
    // Drop ?msg= from the address bar so a refresh doesn't show it again.
    const url = new URL(window.location.href);
    if (url.searchParams.has("msg")) {
      url.searchParams.delete("msg");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const ms = Math.min(8000, Math.max(3000, msg.length * 45));
    const t = setTimeout(() => setOpen(false), ms);
    return () => clearTimeout(t);
  }, [msg]);

  if (!open) return null;
  const Icon = isError ? CircleAlert : CircleCheck;
  return (
    <div className={`toast ${isError ? "toast-error" : ""}`} role={isError ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" className="toast-icon" />
      <span>{msg}</span>
      <button type="button" className="toast-close" onClick={() => setOpen(false)} aria-label="Dismiss">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
