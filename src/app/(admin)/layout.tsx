import { LogOut } from "lucide-react";
import { NavLinks } from "@/components/NavLinks";
import { Topbar, type Notification } from "@/components/Topbar";
import { logout } from "@/app/login/actions";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Things that need attention, for the bell. A failed count (e.g. a table not migrated yet) is just skipped. */
async function loadNotifications(): Promise<Notification[]> {
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  };
  const head = { count: "exact" as const, head: true };
  const now = new Date();
  const [replies, ready, errors, calls] = await Promise.all([
    count(db().from("messages").select("id", head).eq("direction", "in").eq("handled", false)),
    count(db().from("leads").select("id", head).eq("status", "ready")),
    count(db().from("leads").select("id", head).eq("status", "error")),
    count(
      db()
        .from("bookings")
        .select("id", head)
        .eq("status", "confirmed")
        .gte("start_at", now.toISOString())
        .lte("start_at", new Date(now.getTime() + 86400_000).toISOString()),
    ),
  ]);
  const s = (n: number) => (n === 1 ? "" : "s");
  const out: Notification[] = [];
  if (replies) out.push({ id: "replies", label: `${replies} repl${replies === 1 ? "y" : "ies"} waiting`, detail: "Read and answer in the inbox", href: "/inbox", count: replies, tone: "info" });
  if (calls) out.push({ id: "calls", label: `${calls} call${s(calls)} in the next 24 hours`, detail: "See upcoming calls on the dashboard", href: "/", count: calls, tone: "good" });
  if (ready) out.push({ id: "ready", label: `${ready} lead${s(ready)} ready to approve`, detail: "Review the emails, then approve", href: "/leads?status=ready", count: ready, tone: "warn" });
  if (errors) out.push({ id: "errors", label: `${errors} lead${s(errors)} with errors`, detail: "Fix the website or email, then reset", href: "/leads?status=error", count: errors, tone: "bad" });
  return out;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const notifications = await loadNotifications();
  return (
    <div className="shell">
      <nav className="nav">
        <a href="/" className="nav-brand" aria-label={`${brand.name} outbound engine – dashboard`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logoUrl} alt={brand.name} />
          <span>Outbound engine</span>
        </a>
        <NavLinks />
        <form action={logout} className="nav-logout">
          <button className="secondary">
            <LogOut size={16} aria-hidden="true" />
            Log out
          </button>
        </form>
      </nav>
      <div className="content">
        <Topbar notifications={notifications} />
        <main>{children}</main>
      </div>
    </div>
  );
}
