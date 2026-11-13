import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  Eye,
  Mail,
  Megaphone,
  MessageSquareReply,
  MousePointerClick,
  Play,
  Plus,
  Send,
  ThumbsUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { runTick } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Flash } from "@/components/ui";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import { weeklyStats } from "@/lib/pipeline";
import { leadStatusCounts } from "@/lib/stats";

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

const TZ = "Europe/London";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const fmtPart = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).format(new Date(d));

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  };
  const head = { count: "exact" as const, head: true };
  const now = Date.now();

  const [s, { total: totalLeads, byStatus }, waiting, callsRes, boxes, activeCampaigns] = await Promise.all([
    // All-time totals (the weekly report email still uses the 7-day window).
    weeklyStats(36500),
    leadStatusCounts(),
    count(db().from("messages").select("id", head).eq("direction", "in").eq("handled", false)),
    // Don't crash if the bookings migration (0004) hasn't been run yet; flag it instead.
    db().from("bookings").select("*").eq("status", "confirmed").gte("start_at", new Date(now - 3600_000).toISOString()).order("start_at").limit(5),
    // Mailboxes and today's sends fetched side by side (same "today" as mailbox_sent_today: since UTC midnight).
    Promise.all([
      db().from("mailboxes").select("id,email,daily_limit").eq("active", true),
      db()
        .from("messages")
        .select("mailbox_id")
        .eq("direction", "out")
        .eq("status", "sent")
        .gte("sent_at", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString())
        .limit(1000),
    ]).then(([mb, sentRows]) => {
      const perBox = new Map<string, number>();
      for (const r of (sentRows.data ?? []) as { mailbox_id: string | null }[]) if (r.mailbox_id) perBox.set(r.mailbox_id, (perBox.get(r.mailbox_id) ?? 0) + 1);
      return ((mb.data ?? []) as { id: string; email: string; daily_limit: number }[]).map((b) => ({ ...b, sent: perBox.get(b.id) ?? 0 }));
    }),
    count(db().from("campaigns").select("id", head).eq("active", true)),
  ]);

  const n = (id: string) => byStatus.get(id) ?? 0;
  const bookingsMissing = !!callsRes.error;
  const calls = (callsRes.data ?? []) as Call[];
  const maxFunnel = Math.max(1, ...FUNNEL.map((f) => n(f.id)));
  const bounceHigh = s.sent > 0 && s.bounces / s.sent > 0.03;
  const sentToday = boxes.reduce((a, b) => a + b.sent, 0);
  const capacity = boxes.reduce((a, b) => a + b.daily_limit, 0);
  const today = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date());

  const kpis: { label: string; value: string | number; sub: string; icon: LucideIcon; tone: string; warn?: boolean }[] = [
    { label: "Emails sent", value: s.sent, sub: "All time", icon: Send, tone: "orange" },
    { label: "Reply rate", value: s.replyRate, sub: `${s.replies} ${s.replies === 1 ? "reply" : "replies"}`, icon: MessageSquareReply, tone: "blue" },
    { label: "Meetings booked", value: s.meetings, sub: `${s.interested} interested`, icon: CalendarCheck, tone: "green" },
    {
      label: "Bounce rate",
      value: s.bounceRate,
      sub: bounceHigh ? "Over 3%: pause and clean your list" : `${s.bounces} ${s.bounces === 1 ? "bounce" : "bounces"}`,
      icon: TriangleAlert,
      tone: bounceHigh ? "red" : "grey",
      warn: bounceHigh,
    },
  ];

  return (
    <>
      <Flash msg={msg} />

      <section className="dash-hero">
        <div>
          <span className="dash-date">{today}</span>
          <h1>
            {greeting()}, {brand.person}
          </h1>
          <p>
            {totalLeads} leads in your pipeline · {activeCampaigns} active {activeCampaigns === 1 ? "campaign" : "campaigns"}
          </p>
        </div>
        <div className="dash-hero-actions">
          <Link href="/leads" className="btn-link btn-outline">
            <Plus size={16} aria-hidden="true" />
            Add leads
          </Link>
          <form action={runTick}>
            <SubmitButton pending="Running pipeline...">
              <Play size={15} aria-hidden="true" />
              Run pipeline now
            </SubmitButton>
          </form>
        </div>
      </section>

      <div className="dash-kpis">
        {kpis.map((k) => (
          <div key={k.label} className={`card dash-kpi ${k.warn ? "warn" : ""}`}>
            <div className="dash-kpi-top">
              <span>{k.label}</span>
              <span className={`dash-chip sm ${k.tone}`}>
                <k.icon size={15} aria-hidden="true" />
              </span>
            </div>
            <b className="dash-kpi-value">{k.value}</b>
            <span className="dash-kpi-sub">{k.sub}</span>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <section className="card dash-pipeline">
          <div className="card-head">
            <h2>Pipeline</h2>
            <Link href="/leads" className="icon-link small">
              All leads
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className="dash-funnel">
            {FUNNEL.map((f, i) => {
              const v = n(f.id);
              return (
                <Link key={f.id} href={`/leads?status=${f.id}`} className="dash-stage">
                  <span className={`dash-step ${v ? "on" : ""}`}>{i + 1}</span>
                  <span className="dash-stage-label">
                    {f.label}
                    <small>{f.hint}</small>
                  </span>
                  <span className="dash-track">
                    <span className="dash-bar" style={{ width: v ? `${Math.max(3, (v / maxFunnel) * 100)}%` : 0 }} />
                  </span>
                  <span className="dash-stage-n">{v}</span>
                </Link>
              );
            })}
          </div>
          <div className="dash-outcomes">
            <span className="muted small">Left the pipeline</span>
            {OUTCOMES.map((o) => (
              <Link key={o.id} href={`/leads?status=${o.id}`} className={`dash-outcome ${o.tone}`}>
                {o.label}
                <b>{n(o.id)}</b>
              </Link>
            ))}
          </div>
        </section>

        <div className="dash-side">
          <section className="card">
            <div className="card-head">
              <h2>Sending today</h2>
              <Link href="/mailboxes" className="icon-link small">
                Mailboxes
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            {boxes.length === 0 ? (
              <div className="dash-empty">
                <Mail size={18} aria-hidden="true" />
                <span>
                  No active mailbox. <Link href="/mailboxes">Add one</Link> to start sending.
                </span>
              </div>
            ) : (
              <>
                <div className="dash-capacity">
                  <b>{sentToday}</b>
                  <span>/ {capacity} emails</span>
                </div>
                <div className="dash-track lg">
                  <span className="dash-bar" style={{ width: `${capacity ? Math.min(100, (sentToday / capacity) * 100) : 0}%` }} />
                </div>
                <ul className="dash-boxes">
                  {boxes.map((b) => (
                    <li key={b.id}>
                      <span className="dash-dot" />
                      <span className="dash-box-email">{b.email}</span>
                      <span className="muted small">
                        {b.sent}/{b.daily_limit}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="dash-meta">
                  <Megaphone size={14} aria-hidden="true" />
                  {activeCampaigns} active {activeCampaigns === 1 ? "campaign" : "campaigns"}
                </div>
              </>
            )}
          </section>

          <section className="card" id="calls">
            <div className="card-head">
              <h2>Upcoming calls</h2>
            </div>
            {bookingsMissing ? (
              <p className="muted small">Bookings aren&apos;t set up yet. Run the database migrations (see Settings).</p>
            ) : calls.length === 0 ? (
              <div className="dash-empty">
                <CalendarClock size={18} aria-hidden="true" />
                <span>No calls booked yet.</span>
              </div>
            ) : (
              <ul className="dash-calls">
                {calls.map((c) => (
                  <li key={c.id}>
                    <span className="dash-cal">
                      <small>{fmtPart(c.start_at, { month: "short" })}</small>
                      <b>{fmtPart(c.start_at, { day: "numeric" })}</b>
                    </span>
                    <span className="dash-call-text">
                      {c.lead_id ? <Link href={`/leads/${c.lead_id}`}>{c.company ?? c.name}</Link> : <b>{c.company ?? c.name}</b>}
                      <small className="muted">
                        {fmtPart(c.start_at, { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {c.name} · {c.method === "video" ? "Video" : c.phone}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Engagement</h2>
              <span className="muted small">All time</span>
            </div>
            <div className="dash-mini">
              <div>
                <Eye size={16} aria-hidden="true" />
                <b>{s.views}</b>
                <span>Audit views</span>
              </div>
              <div>
                <MousePointerClick size={16} aria-hidden="true" />
                <b>{s.clicks}</b>
                <span>Booking clicks</span>
              </div>
              <div>
                <ThumbsUp size={16} aria-hidden="true" />
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
