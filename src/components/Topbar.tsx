"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, CheckCheck, Menu, Trash2 } from "lucide-react";
import { NAV_TOGGLE_EVENT } from "@/components/NavDrawer";
import { clearNotifications, markNotificationsRead } from "@/app/(admin)/notification-actions";

export interface Notification {
  id: string;
  label: string;
  detail: string;
  href: string;
  count: number;
  tone: "info" | "warn" | "bad" | "good";
  read?: boolean;
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
export function Topbar({ notifications: fromServer }: { notifications: Notification[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  // Local read/cleared marks ("id:count") so the badge updates instantly, before the server re-renders.
  const [readKeys, setReadKeys] = useState<Set<string>>(() => new Set());
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(() => new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const key = (n: Notification) => `${n.id}:${n.count}`;
  const persist = (action: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const r = await action();
      setSaveError(r.error ?? null);
    });
  const notifications = fromServer
    .filter((n) => !clearedKeys.has(key(n)))
    .map((n) => (readKeys.has(key(n)) ? { ...n, read: true } : n));
  const unread = notifications.filter((n) => !n.read);
  const total = unread.reduce((n, x) => n + x.count, 0);
  const snap = (list: Notification[]) => list.map(({ id, count }) => ({ id, count }));
  const addKeys = (set: Set<string>, list: Notification[]) => new Set([...set, ...list.map(key)]);
  const markAllRead = () => {
    const list = unread;
    setReadKeys((s) => addKeys(s, list));
    persist(() => markNotificationsRead(snap(list)));
  };
  const clearAll = () => {
    const list = notifications;
    setClearedKeys((s) => addKeys(s, list));
    persist(() => clearNotifications(snap(list)));
  };
  const markOneRead = (n: Notification) => {
    if (n.read) return;
    setReadKeys((s) => addKeys(s, [n]));
    persist(() => markNotificationsRead(snap([n])));
  };

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
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-menu"
          onClick={() => window.dispatchEvent(new Event(NAV_TOGGLE_EVENT))}
          aria-label="Open menu"
          aria-controls="app-nav"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="topbar-title">{titleFor(path)}</div>
      </div>
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
            <div className="notif-head">
              <span>Notifications</span>
              {notifications.length > 0 && (
                <span className="notif-actions">
                  <button type="button" onClick={markAllRead} disabled={pending || unread.length === 0}>
                    <CheckCheck size={14} aria-hidden="true" />
                    Mark all as read
                  </button>
                  <button type="button" onClick={clearAll} disabled={pending}>
                    <Trash2 size={14} aria-hidden="true" />
                    Clear all
                  </button>
                </span>
              )}
            </div>
            {saveError && (
              <div className="notif-error" role="alert">
                {saveError}
              </div>
            )}
            {notifications.length === 0 ? (
              <div className="notif-empty">You&apos;re all caught up.</div>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  className={`notif-item${n.read ? " read" : ""}`}
                  role="menuitem"
                  onClick={() => markOneRead(n)}
                >
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
