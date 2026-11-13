import { LogOut } from "lucide-react";
import { cookies } from "next/headers";
import { NavLinks } from "@/components/NavLinks";
import { Topbar, type Notification } from "@/components/Topbar";
import { logout } from "@/app/login/actions";
import { db } from "@/lib/db";
import { leadStatusCounts } from "@/lib/stats";
import { SESSION_COOKIE, sessionUserId } from "@/lib/session";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

/** Things that need attention, for the bell. A failed count (e.g. a table not migrated yet) is just skipped. */
async function loadNotifications(): Promise<Notification[]> {
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  };
  const head = { count: "exact" as const, head: true };
  const now = new Date();
  const [replies, { byStatus }, calls] = await Promise.all([
    count(db().from("messages").select("id", head).eq("direction", "in").eq("handled", false)),
    leadStatusCounts(),
    count(
      db()
        .from("bookings")
        .select("id", head)
        .eq("status", "confirmed")
        .gte("start_at", now.toISOString())
        .lte("start_at", new Date(now.getTime() + 86400_000).toISOString()),
    ),
  ]);
  const ready = byStatus.get("ready") ?? 0;
  const errors = byStatus.get("error") ?? 0;
  const s = (n: number) => (n === 1 ? "" : "s");
  const out: Notification[] = [];
  if (replies) out.push({ id: "replies", label: `${replies} repl${replies === 1 ? "y" : "ies"} waiting`, detail: "Read and answer in the inbox", href: "/inbox", count: replies, tone: "info" });
  if (calls) out.push({ id: "calls", label: `${calls} call${s(calls)} in the next 24 hours`, detail: "See upcoming calls on the dashboard", href: "/", count: calls, tone: "good" });
  if (ready) out.push({ id: "ready", label: `${ready} lead${s(ready)} ready to approve`, detail: "Review the emails, then approve", href: "/leads?status=ready", count: ready, tone: "warn" });
  if (errors) out.push({ id: "errors", label: `${errors} lead${s(errors)} with errors`, detail: "Fix the website or email, then reset", href: "/leads?status=error", count: errors, tone: "bad" });
  return out;
}

/** Username of whoever is logged in (the proxy has already checked the session). */
async function loadCurrentUser(): Promise<string | null> {
  const id = await sessionUserId((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const { data } = await db().from("admin_users").select("username").eq("id", id).maybeSingle();
  return data?.username ?? null;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [notifications, username] = await Promise.all([loadNotifications(), loadCurrentUser()]);
  return (
    <div className="shell">
      <nav className="nav">
        <a href="/" className="nav-brand" aria-label="ZappSites Outbound – dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zappsites-outbound-logo.png" alt="ZappSites Outbound" />
        </a>
        <NavLinks />
        <form action={logout} className="nav-logout">
          {username && (
            <div className="nav-user">
              <span className="nav-user-avatar" aria-hidden="true">
                {username.charAt(0).toUpperCase()}
              </span>
              <span className="nav-user-text">
                <b>{username}</b>
                <small>Administrator</small>
              </span>
            </div>
          )}
          <SubmitButton className="secondary" pending="Logging out...">
            <LogOut size={16} aria-hidden="true" />
            Log out
          </SubmitButton>
        </form>
      </nav>
      <div className="content">
        <Topbar notifications={notifications} />
        <main>{children}</main>
      </div>
    </div>
  );
}
