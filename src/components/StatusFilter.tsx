"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ListFilter } from "lucide-react";

/** "Filter" button that opens a dropdown of lead statuses with counts. */
export function StatusFilter({ status, q, options }: { status: string; q?: string; options: { value: string; count: number }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = (v: string) => `/leads?status=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const label = (v: string) => (v === "all" ? "All statuses" : v.replace(/_/g, " "));
  const current = options.find((o) => o.value === status);

  return (
    <div className="filter" ref={ref}>
      <button type="button" className={`filter-btn${status !== "all" ? " active" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <ListFilter size={16} aria-hidden="true" />
        <span className="filter-label">Status:</span>
        <b>{label(status)}</b>
        {current && <span className="filter-count">{current.count}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="filter-menu" role="listbox">
          {options.map((o) => (
            <Link key={o.value} href={href(o.value)} role="option" aria-selected={o.value === status} className={o.value === status ? "on" : undefined} onClick={() => setOpen(false)}>
              <span className="filter-check">{o.value === status && <Check size={14} aria-hidden="true" />}</span>
              <span className="filter-name">{label(o.value)}</span>
              <span className="filter-count">{o.count}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
