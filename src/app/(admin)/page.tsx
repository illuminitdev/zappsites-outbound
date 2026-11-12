import Link from "next/link";
import { ArrowRight, CalendarCheck, MessageSquareReply, Play, Send, TriangleAlert, type LucideIcon } from "lucide-react";
import { runTick } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Flash, fmt } from "@/components/ui";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import { weeklyStats } from "@/lib/pipeline";

// Main funnel, in order. Outcomes that leave the funnel are shown separately.
const FUNNEL = [
  { id: "new", label: "New", hint: "Imported" },
  { id: "enriched", label: "Enriched", hint: "Email found" },
  { id: "audited", label: "Audited", hint: "Site checked" },
  { id: "ready", label: "Ready", hint: "Awaiting approval" },
  { id: "sequencing", label: "Sequencing", hint: "Emails going out" },
  { id: "replied", label: "Replied", hint: "Human reply" },
  { id: "interested", label: "Interested", hint: "Positive reply" },
  { id: "meeting", label: "Meeting", hint: "Call booked" },
];
const OUTCOMES = [
  { id: "not_interested", label: "Not interested", tone: "" },
  { id: "unsubscribed", label: "Unsubscribed", tone: "" },
  { id: "bounced", label: "Bounced", tone: "bad" },
  { id: "error", label: "Error", tone: "bad" },
];

type Call = { id: string; name: string; company: string | null; email: string; phone: string | null; method: string; note: string | null; start_at: string; lead_id: string | null };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  };
  const head = { count: "exact" as const, head: true };

  const [s, statusCounts, waiting, callsRes] = await Promise.all([
    weeklyStats(),
    Promise.all([...FUNNEL, ...OUTCOMES].map(async (st) => [st.id, await count(db().from("leads").select("id", head).eq("status", st.id))] as const)),
    count(db().from("messages").select("id", head).eq("direction", "in").eq("handled", false)),
    // Don't crash if the bookings migration (0004) hasn't been run yet; flag it instead.
    db().from("bookings").select("*").eq("status", "confirmed").gte("start_at", new Date(Date.now() - 3600_000).toISOString()).order("start_at").limit(8),
  ]);
  const byStatus = new Map(statusCounts);
  const bookingsMissing = !!callsRes.error;
  const calls = (callsRes.data ?? []) as Call[];
  const maxFunnel = Math.max(1, ...FUNNEL.map((f) => byStatus.get(f.id) ?? 0));
  const bounceHigh = s.sent > 0 && s.bounces / s.sent > 0.03;

  const kpis: { label: string; value: string | number; sub: string; icon: LucideIcon; warn?: boolean }[] = [
    { label: "Emails sent", value: s.sent, sub: "last 7 days", icon: Send },
    { label: "Reply rate", value: s.replyRate, sub: `${s.replies} replies`, icon: MessageSquareReply },
    { label: "Meetings booked", value: s.meetings, sub: `${s.interested} interested`, icon: CalendarCheck },
    { label: "Bounce rate", value: s.bounceRate, sub: bounceHigh ? "Over 3%: pause and clean your list" : `${s.bounces} bounces`, icon: TriangleAlert, warn: bounceHigh },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {greeting()}, {brand.person}
          </h1>
          <p className="muted">Here&apos;s how outbound is doing. The pipeline runs automatically every 10 minutes.</p>
        </div>
        <form action={runTick}>
          <SubmitButton pending="Running pipeline... (can take a few minutes)">
            <Play size={15} aria-hidden="true" />
            Run pipeline now
          </SubmitButton>
        </form>
      </div>
      <Flash msg={msg} />

      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className={`card kpi ${k.warn ? "kpi-warn" : ""}`}>
            <span className="kpi-label">
              <k.icon size={15} aria-hidden="true" />
              {k.label}
            </span>
            <b className="kpi-value">{k.value}</b>
            <span className="kpi-sub">{k.sub}</span>
          </div>
        ))}
      </div>

      <div className="dash-cols">
        <section className="card">
          <div className="card-head">
            <h2>Pipeline</h2>
            <Link href="/leads" className="muted icon-link">
              All leads
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className="funnel">
            {FUNNEL.map((f) => {
              const n = byStatus.get(f.id) ?? 0;
              return (
                <Link key={f.id} href={`/leads?status=${f.id}`} className="funnel-row">
                  <span className="funnel-label">
                    {f.label}
                    <small>{f.hint}</small>
                  </span>
                  <span className="funnel-track">
                    <span className="funnel-bar" style={{ width: n ? `${Math.max(4, (n / maxFunnel) * 100)}%` : 0 }} />
                  </span>
                  <span className="funnel-n">{n}</span>
                </Link>
              );
            })}
          </div>
          <div className="outcomes">
            {OUTCOMES.map((o) => (
              <Link key={o.id} href={`/leads?status=${o.id}`} className={`outcome ${o.tone}`}>
                {o.label} <b>{byStatus.get(o.id) ?? 0}</b>
              </Link>
            ))}
          </div>
        </section>

        <div className="dash-side">
          <Link href="/inbox" className={`card side-stat ${waiting ? "has" : ""}`}>
            <span className="kpi-label">
              <MessageSquareReply size={15} aria-hidden="true" />
              Replies waiting
            </span>
            <b className="kpi-value">{waiting}</b>
            <span className="kpi-sub icon-link">
              {waiting ? (
                <>
                  Open the inbox to answer <ArrowRight size={12} aria-hidden="true" />
                </>
              ) : (
                "You're all caught up"
              )}
            </span>
          </Link>

          <section className="card">
            <div className="card-head">
              <h2>Upcoming calls</h2>
            </div>
            {bookingsMissing ? (
              <p className="muted small">Bookings aren&apos;t set up yet. Run the database migrations (see Settings).</p>
            ) : calls.length === 0 ? (
              <p className="muted small">No calls booked yet.</p>
            ) : (
              <div className="calls">
                {calls.map((c) => (
                  <div key={c.id} className="call">
                    <div className="call-when">{fmt(c.start_at)}</div>
                    <div>
                      {c.lead_id ? <Link href={`/leads/${c.lead_id}`}>{c.company ?? c.name}</Link> : <b>{c.company ?? c.name}</b>}
                      <small className="muted">
                        {c.name} · {c.method === "video" ? "video call" : c.phone}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Engagement</h2>
              <span className="muted small">7 days</span>
            </div>
            <div className="mini-stats">
              <div>
                <b>{s.views}</b>
                <span>Audit page views</span>
              </div>
              <div>
                <b>{s.clicks}</b>
                <span>Booking clicks</span>
              </div>
              <div>
                <b>{s.interested}</b>
                <span>Interested</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
