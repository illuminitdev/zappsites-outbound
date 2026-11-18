"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ListFilter } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * A filter button that opens a dropdown of options with counts. Choosing one changes only its own
 * URL parameter (`param`) and keeps the other filters and the search; it always goes back to page 1.
 */
export function FilterMenu({
  param,
  title,
  value,
  options,
  params,
  basePath = "/leads",
}: {
  param: string;
  title: string;
  value: string;
  options: FilterOption[];
  /** The page's current filters and search, e.g. { status: "sequencing", q: "acme" }. */
  params: Record<string, string | undefined>;
  basePath?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Open below the button when there's room, otherwise above; never taller than the space available.
  const [place, setPlace] = useState<{ up: boolean; max: number }>({ up: false, max: 420 });

  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      const btn = ref.current?.getBoundingClientRect();
      if (!btn) return;
      const gap = 16;
      const below = window.innerHeight - btn.bottom - gap;
      const above = btn.top - gap - 60; // keep clear of the sticky top bar
      const want = 420;
      const up = below < Math.min(want, 260) && above > below;
      setPlace({ up, max: Math.max(160, Math.min(want, up ? above : below)) });
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open]);

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

  const href = (v: string) => {
    const u = new URLSearchParams();
    for (const [k, val] of Object.entries({ ...params, [param]: v })) if (val && val !== "all" && k !== "page") u.set(k, val);
    const s = u.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className="filter" ref={ref}>
      <button type="button" className={`filter-btn${value !== "all" ? " active" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <ListFilter size={16} aria-hidden="true" />
        <span className="filter-label">{title}:</span>
        <b>{current?.label}</b>
        {current?.count != null && <span className="filter-count">{current.count}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={`filter-menu${place.up ? " up" : ""}`} role="listbox" style={{ maxHeight: place.max }}>
          {options.map((o) => (
            <Link key={o.value} href={href(o.value)} role="option" aria-selected={o.value === value} className={o.value === value ? "on" : undefined} onClick={() => setOpen(false)}>
              <span className="filter-check">{o.value === value && <Check size={14} aria-hidden="true" />}</span>
              <span className="filter-name">{o.label}</span>
              {o.count != null && <span className="filter-count">{o.count}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
