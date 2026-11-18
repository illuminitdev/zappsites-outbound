"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, createLucideIcon, LayoutDashboard, Mail, Megaphone, Settings, Users, type LucideIcon } from "lucide-react";

/** Lucide's inbox tray with a down arrow dropping into it (Lucide has no built-in version). */
const InboxArrowDown = createLucideIcon("inbox-arrow-down", [
  ["path", { d: "M12 2v9", key: "arrow-shaft" }],
  ["path", { d: "m8.5 7.5 3.5 3.5 3.5-3.5", key: "arrow-head" }],
  ["path", { d: "M7.5 5H6.2a2 2 0 0 0-1.7 1L2 11.5", key: "tray-left" }],
  ["path", { d: "M16.5 5h1.3a2 2 0 0 1 1.7 1l2.5 5.5", key: "tray-right" }],
  ["path", { d: "M2 11.5V18a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-6.5", key: "tray-body" }],
  ["path", { d: "M2 11.5h4.4a1 1 0 0 1 .9.6l.9 2a1.5 1.5 0 0 0 1.4.9h4.8a1.5 1.5 0 0 0 1.4-.9l.9-2a1 1 0 0 1 .9-.6H22", key: "tray-lip" }],
]);

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inbox", label: "Inbox", icon: InboxArrowDown },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/mailboxes", label: "Mailboxes", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Sidebar links; the current section is highlighted (sub-pages like /leads/123 count as Leads).
 *  `counts` puts a small number badge after a link, e.g. { "/inbox": 2 } for replies waiting. */
export function NavLinks({ counts = {} }: { counts?: Record<string, number> }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <>
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} prefetch className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
            {label}
            {counts[href] ? (
              <span className="nav-count" aria-label={`${counts[href]} waiting`}>
                {counts[href] > 99 ? "99+" : counts[href]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}
