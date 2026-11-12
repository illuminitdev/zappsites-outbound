"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows "Logging in..." while the login is being checked. */
export function LoginButton() {
  const { pending } = useFormStatus();
  return (
    <button className="login-btn" disabled={pending} aria-busy={pending}>
      {pending ? "Logging in..." : "Login"}
    </button>
  );
}
