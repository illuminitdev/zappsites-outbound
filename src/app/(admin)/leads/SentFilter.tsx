"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ListFilter } from "lucide-react";

type Kind = "sent" | "failed" | "replied";
const KINDS: { value: Kind; label: string }[] = [
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "replied", label: "Replied" },
];
const RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "30d", label: "Last 30 days" },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const niceDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Leads "Sent on" filter: pick Sent / Failed / Replied, then Today, Yesterday, Last 30 days or any date
 * from a calendar. Value is "<kind>:<range>" (e.g. "sent:today", "failed:2026-11-18") or "all".
 */
export function SentFilter({
  value,
  counts,
  params,
  today,
}: {
  value: string;
  /** Lead counts by "<kind>:<range>", plus "all". */
  counts: Record<string, number>;
  params: Record<string, string | undefined>;
  /** Today's date (YYYY-MM-DD, UK time): the latest day the calendar allows. */
  today: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [curKind, curRange] = value === "all" ? (["sent", ""] as const) : (value.split(":") as [Kind, string]);
  const [kind, setKind] = useState<Kind>(curKind);
  const picked = DATE_RE.test(curRange) ? curRange : "";

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
    for (const [k, val] of Object.entries({ ...params, sent: v })) if (val && val !== "all" && k !== "page") u.set(k, val);
    return u.size ? `/leads?${u}` : "/leads";
  };

  const kindLabel = KINDS.find((k) => k.value === curKind)?.label ?? "Sent";
  const rangeLabel = RANGES.find((r) => r.value === curRange)?.label ?? (picked ? niceDate(picked) : "");
  const count = counts[value];

  return (
    <div className="filter" ref={ref}>
      <button type="button" className={`filter-btn${value !== "all" ? " active" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <ListFilter size={16} aria-hidden="true" />
        <span className="filter-label">{value === "all" ? "Sent on" : kindLabel}:</span>
        <b>{value === "all" ? "All" : rangeLabel}</b>
        {count != null && <span className="filter-count">{count}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="filter-menu sent-menu" role="dialog" aria-label="Filter by when emails were sent">
          <div className="sent-kinds" role="tablist">
            {KINDS.map((k) => (
              <button key={k.value} type="button" role="tab" aria-selected={kind === k.value} className={kind === k.value ? "on" : undefined} onClick={() => setKind(k.value)}>
                {k.label}
              </button>
            ))}
          </div>

          <Link href={href("all")} className={value === "all" ? "on" : undefined} onClick={() => setOpen(false)}>
            <span className="filter-check">{value === "all" && <Check size={14} aria-hidden="true" />}</span>
            <span className="filter-name">All leads</span>
            <span className="filter-count">{counts.all}</span>
          </Link>
          {RANGES.map((r) => {
            const v = `${kind}:${r.value}`;
            return (
              <Link key={r.value} href={href(v)} className={v === value ? "on" : undefined} onClick={() => setOpen(false)}>
                <span className="filter-check">{v === value && <Check size={14} aria-hidden="true" />}</span>
                <span className="filter-name">{r.label}</span>
                <span className="filter-count">{counts[v] ?? 0}</span>
              </Link>
            );
          })}

          <div className="sent-date">
            <label htmlFor="sent-date-input">
              <CalendarDays size={15} aria-hidden="true" />
              Pick a date
              {picked && kind === curKind && <span className="filter-count">{counts[`${kind}:${picked}`] ?? 0}</span>}
            </label>
            <input
              id="sent-date-input"
              ref={dateRef}
              type="date"
              max={today}
              defaultValue={picked}
              onClick={() => dateRef.current?.showPicker?.()}
              onChange={(e) => {
                if (!DATE_RE.test(e.target.value)) return;
                setOpen(false);
                router.push(href(`${kind}:${e.target.value}`));
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
