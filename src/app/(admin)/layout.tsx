import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { cookies } from "next/headers";
import { NavDrawer } from "@/components/NavDrawer";
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

type NotifState = { notif_id: string; read_count: number | null; cleared_count: number | null };

/** The user's saved read/cleared marks. Empty if not logged in or the table isn't migrated yet. */
async function loadNotificationStates(userId: string | null): Promise<NotifState[]> {
  if (!userId) return [];
  const { data, error } = await db().from("notification_states").select("notif_id, read_count, cleared_count").eq("user_id", userId);
  return error || !data ? [] : (data as NotifState[]);
}

/** A notification is read or cleared only while its count is the same as when the user acted on it. */
function applyNotificationStates(states: NotifState[], list: Notification[]): Notification[] {
  const byId = new Map(states.map((r) => [r.notif_id, r]));
  return list
    .filter((n) => byId.get(n.id)?.cleared_count !== n.count)
    .map((n) => ({ ...n, read: byId.get(n.id)?.read_count === n.count }));
}

async function currentUserId(): Promise<string | null> {
  return sessionUserId((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Username of whoever is logged in (the proxy has already checked the session). */
async function loadCurrentUser(id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await db().from("admin_users").select("username").eq("id", id).maybeSingle();
  return data?.username ?? null;
}

/** Bell with live counts. Streamed in, so pages never wait for these queries. */
async function TopbarWithNotifications() {
  const userId = await currentUserId();
  // Fetch the notification counts and the user's read/cleared state side by side (one round trip).
  const [raw, states] = await Promise.all([loadNotifications(), loadNotificationStates(userId)]);
  return <Topbar notifications={applyNotificationStates(states, raw)} />;
}

/** Logged-in user's name and avatar. Streamed in, like the bell. */
async function NavUser() {
  const username = await loadCurrentUser(await currentUserId());
  if (!username) return null;
  return (
    <div className="nav-user">
      <span className="nav-user-avatar" aria-hidden="true">
        {username.charAt(0).toUpperCase()}
      </span>
      <span className="nav-user-text">
        <b>{username}</b>
        <small>Administrator</small>
      </span>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <NavDrawer>
        <a href="/" className="nav-brand" aria-label="ZappSites Outbound – dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zappsites-outbound-logo.png" alt="ZappSites Outbound" />
        </a>
        <NavLinks />
        <form action={logout} className="nav-logout">
          <Suspense fallback={null}>
            <NavUser />
          </Suspense>
          <SubmitButton className="secondary" pending="Logging out...">
            <LogOut size={16} aria-hidden="true" />
            Log out
          </SubmitButton>
        </form>
      </NavDrawer>
      <div className="content">
        <Suspense fallback={<Topbar notifications={[]} />}>
          <TopbarWithNotifications />
        </Suspense>
        <main>{children}</main>
      </div>
    </div>
  );
}
