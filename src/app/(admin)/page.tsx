import Link from "next/link";
import { runTick } from "@/app/actions";
import { Flash, fmt } from "@/components/ui";
import { db, must } from "@/lib/db";
import { weeklyStats } from "@/lib/pipeline";

const STATUSES = ["new", "enriched", "audited", "ready", "sequencing", "replied", "interested", "meeting", "not_interested", "unsubscribed", "bounced", "error"];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const s = await weeklyStats();
  const counts = await Promise.all(
    STATUSES.map(async (st) => {
      const r = await db().from("leads").select("id", { count: "exact", head: true }).eq("status", st);
      return [st, r.count ?? 0] as const;
    }),
  );
  const waiting = must(await db().from("messages").select("id").eq("direction", "in").eq("handled", false)) as unknown[];
  const boxes = must(await db().from("mailboxes").select("id").eq("active", true)) as unknown[];
  const live = must(await db().from("campaigns").select("id").eq("active", true)) as unknown[];
  // Don't crash the dashboard if the bookings migration (0004) hasn't been run yet; show a warning instead.
  const callsRes = await db().from("bookings").select("*").eq("status", "confirmed").gte("start_at", new Date(Date.now() - 3600_000).toISOString()).order("start_at").limit(20);
  const bookingsMissing = !!callsRes.error;
  const calls = (callsRes.data ?? []) as { id: string; name: string; company: string | null; email: string; phone: string | null; method: string; note: string | null; start_at: string; lead_id: string | null }[];

  return (
    <>
      <h1>Dashboard</h1>
      <Flash msg={msg} />
      {bookingsMissing && (
        <div className="msg">
          Database setup incomplete: {callsRes.error!.message}. Run <code>supabase/migrations/0002_aeo_mentions.sql</code>,{" "}
          <code>0003_page_note.sql</code> and <code>0004_bookings.sql</code> in the Supabase SQL editor.
        </div>
      )}
      {(!boxes.length || !live.length) && (
        <div className="msg">
          Setup: {!boxes.length && <><Link href="/mailboxes">add a sending mailbox</Link>{!live.length && " and "}</>}
          {!live.length && <Link href="/campaigns">create and activate a campaign</Link>}.
        </div>
      )}
      {calls.length > 0 && (
        <>
          <h2>Upcoming calls</h2>
          <table>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td>{fmt(c.start_at)}</td>
                  <td>
                    {c.lead_id ? <Link href={`/leads/${c.lead_id}`}>{c.company ?? c.name}</Link> : c.company ?? c.name}
                    <div className="muted">{c.name}</div>
                  </td>
                  <td>
                    {c.method === "video" ? "video" : c.phone}
                    <div className="muted">{c.email}</div>
                  </td>
                  <td className="muted">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2>Last 7 days</h2>
      <div className="grid">
        {[
          ["Sent", s.sent],
          ["Replies", `${s.replies} · ${s.replyRate}`],
          ["Interested", s.interested],
          ["Meetings", s.meetings],
          ["Audit page views", s.views],
          ["Booking clicks", s.clicks],
          ["Bounces", `${s.bounces} · ${s.bounceRate}`],
        ].map(([k, v]) => (
          <div className="card stat" key={k}>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {waiting.length > 0 && (
        <div className="msg">
          <Link href="/inbox">{waiting.length} replies waiting for you</Link>
        </div>
      )}
      <h2>Pipeline</h2>
      <div className="grid">
        {counts.map(([st, n]) => (
          <Link className="card stat" key={st} href={`/leads?status=${st}`}>
            <b>{n}</b>
            <span>{st.replace(/_/g, " ")}</span>
          </Link>
        ))}
      </div>
      <form action={runTick}>
        <button>Run pipeline now</button>{" "}
        <span className="muted">Runs automatically every 10 minutes via cron.</span>
      </form>
    </>
  );
}
