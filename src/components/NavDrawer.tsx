"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/** Event the top bar's menu button fires to open/close the sidebar on small screens. */
export const NAV_TOGGLE_EVENT = "nav:toggle";

/**
 * The sidebar. On wide screens it's always visible; on phones and small tablets (CSS ≤ 900px)
 * it slides in over the page, and closes on navigation, Escape, or a tap on the backdrop.
 */
export function NavDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener(NAV_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(NAV_TOGGLE_EVENT, toggle);
  }, []);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    // Don't let the page behind scroll while the menu is open.
    document.body.classList.add("nav-locked");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("nav-locked");
    };
  }, [open]);

  return (
    <>
      <nav id="app-nav" className={`nav${open ? " open" : ""}`} aria-label="Main">
        {children}
      </nav>
      <div className={`nav-backdrop${open ? " open" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
    </>
  );
}
