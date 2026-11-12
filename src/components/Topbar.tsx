"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

export interface Notification {
  id: string;
  label: string;
  detail: string;
  href: string;
  count: number;
  tone: "info" | "warn" | "bad" | "good";
}

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/leads": "Leads",
  "/inbox": "Inbox",
  "/campaigns": "Campaigns",
  "/mailboxes": "Mailboxes",
  "/settings": "Settings",
};

function titleFor(path: string): string {
  if (TITLES[path]) return TITLES[path];
  if (path.startsWith("/leads/")) return "Lead";
  return TITLES[`/${path.split("/")[1]}`] ?? "";
}


/** Top bar: current section title on the left, notification bell on the right. */
export function Topbar({ notifications }: { notifications: Notification[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const total = notifications.reduce((n, x) => n + x.count, 0);

  // Close on outside click, Escape, or navigation.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => setOpen(false), [path]);

  return (
    <header className="topbar">
      <div className="topbar-title">{titleFor(path)}</div>
      <div className="notif" ref={ref}>
        <button
          type="button"
          className="notif-btn"
          onClick={() => setOpen((o) => !o)}
          aria-label={total ? `${total} notifications` : "No notifications"}
          aria-expanded={open}
        >
          <Bell size={20} strokeWidth={2} aria-hidden="true" />
          {total > 0 && <span className="notif-badge">{total > 99 ? "99+" : total}</span>}
        </button>
        {open && (
          <div className="notif-panel" role="menu">
            <div className="notif-head">Notifications</div>
            {notifications.length === 0 ? (
              <div className="notif-empty">You&apos;re all caught up.</div>
            ) : (
              notifications.map((n) => (
                <Link key={n.id} href={n.href} className="notif-item" role="menuitem">
                  <span className={`notif-dot ${n.tone}`} />
                  <span className="notif-text">
                    <b>{n.label}</b>
                    <small>{n.detail}</small>
                  </span>
                  <span className="notif-count">{n.count}</span>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </header>
  );
}
