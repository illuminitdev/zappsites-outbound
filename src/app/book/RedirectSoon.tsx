"use client";

import { useEffect, useState } from "react";

/** Counts down, then sends the visitor to `to`. Long enough to read the message and let the ads conversion fire. */
export function RedirectSoon({ to, seconds, label }: { to: string; seconds: number; label: string }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      window.location.assign(to);
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, to]);
  return (
    <p aria-live="polite">
      Taking you to {label} in {Math.max(left, 0)}s… <a href={to}>Go now</a>
    </p>
  );
}
