import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <nav className="nav">
        <strong>Outbound engine</strong>
        <Link href="/">Dashboard</Link>
        <Link href="/leads">Leads</Link>
        <Link href="/inbox">Inbox</Link>
        <Link href="/campaigns">Campaigns</Link>
        <Link href="/mailboxes">Mailboxes</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
