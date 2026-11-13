"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, Mail, Megaphone, Settings, Users, type LucideIcon } from "lucide-react";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/mailboxes", label: "Mailboxes", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Sidebar links; the current section is highlighted (sub-pages like /leads/123 count as Leads). */
export function NavLinks() {
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
          </Link>
        );
      })}
    </>
  );
}
