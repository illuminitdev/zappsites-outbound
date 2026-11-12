"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

/** Password field with an eye button to show or hide what's typed. */
export function PasswordInput({
  id = "password",
  name = id,
  autoComplete = "current-password",
  minLength,
}: {
  id?: string;
  name?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} minLength={minLength} required />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
