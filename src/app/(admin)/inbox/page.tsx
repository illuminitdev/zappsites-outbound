import Link from "next/link";
import { ArrowUpRight, Check, CheckCheck, Inbox as InboxIcon, Mail, MessageCircleQuestion, Send, Sparkles, ThumbsUp } from "lucide-react";
import { markHandled, replyAction } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash, Pill, fmt } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead, Message } from "@/lib/types";

type View = "waiting" | "handled";
type LeadLite = Pick<Lead, "id" | "company" | "first_name" | "last_name" | "email">;

const AVATAR_COLORS = ["#fde2c0", "#d9e7ff", "#d5f0e3", "#f9d9e3", "#e6defb", "#fbe9b7"];
function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** "14:05" today, "Mon" this week, otherwise "12 Nov". */
function shortTime(d: string | null) {
  if (!d) return "";
  const date = new Date(d);
  const age = Date.now() - date.getTime();
  const o: Intl.DateTimeFormatOptions =
    age < 86400_000 ? { hour: "2-digit", minute: "2-digit" } : age < 6 * 86400_000 ? { weekday: "short" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(date);
}

export default async function Inbox({ searchParams }: { searchParams: Promise<{ msg?: string; view?: string; id?: string }> }) {
  const { msg, view: viewParam, id } = await searchParams;
  const view: View = viewParam === "handled" ? "handled" : "waiting";

  const head = { count: "exact" as const, head: true };
  const [rows, waitingCount, handledCount] = await Promise.all([
    db()
      .from("messages")
      // Each reply with its lead, in the same request.
      .select("*, lead:leads(id,company,first_name,last_name,email)")
      .eq("direction", "in")
      .eq("handled", view === "handled")
      .order("received_at", { ascending: false })
      .limit(100)
      .then((r) => must(r) as (Message & { lead: LeadLite | null })[]),
    db().from("messages").select("id", head).eq("direction", "in").eq("handled", false),
    db().from("messages").select("id", head).eq("direction", "in").eq("handled", true),
  ]);
  const list = rows as Message[];
  const byId = new Map(rows.filter((m) => m.lead).map((m) => [m.lead_id, m.lead as LeadLite]));

  const selected = list.find((m) => m.id === id) ?? list[0];
  const lead = selected ? byId.get(selected.lead_id) : undefined;
  const waiting = waitingCount.count ?? 0;
  const handled = handledCount.count ?? 0;
  const interested = view === "waiting" ? list.filter((m) => m.classification === "interested").length : 0;
  const questions = view === "waiting" ? list.filter((m) => m.classification === "question").length : 0;
  const href = (v: View, mid?: string) => `/inbox?${new URLSearchParams({ ...(v === "handled" ? { view: v } : {}), ...(mid ? { id: mid } : {}) })}`;

  const summary = [
    { label: "Waiting for you", value: waiting, icon: InboxIcon, tone: "orange" },
    { label: "Interested", value: interested, icon: ThumbsUp, tone: "green" },
    { label: "Questions", value: questions, icon: MessageCircleQuestion, tone: "blue" },
    { label: "Handled", value: handled, icon: CheckCheck, tone: "grey" },
  ];

  return (
    <>
      <section className="dash-hero">
        <div>
          <h1>Inbox</h1>
          <p>
            {waiting
              ? `${waiting} ${waiting === 1 ? "reply" : "replies"} waiting. Claude has drafted answers; edit before sending.`
              : "Replies from prospects land here, sorted by Claude."}
          </p>
        </div>
      </section>
      <Flash msg={msg} />

      <div className="dash-kpis">
        {summary.map((k) => (
          <div key={k.label} className="card dash-kpi">
            <div className="dash-kpi-top">
              <span>{k.label}</span>
              <span className={`dash-chip sm ${k.tone}`}>
                <k.icon size={15} aria-hidden="true" />
              </span>
            </div>
            <b className="dash-kpi-value">{k.value}</b>
          </div>
        ))}
      </div>

      <div className="ib">
        <aside className="card ib-list">
          <div className="ib-tabs">
            <Link href={href("waiting")} className={view === "waiting" ? "on" : undefined}>
              Waiting <span>{waiting}</span>
            </Link>
            <Link href={href("handled")} className={view === "handled" ? "on" : undefined}>
              Handled <span>{handled}</span>
            </Link>
          </div>
          {list.length === 0 ? (
            <div className="ib-list-empty muted small">{view === "waiting" ? "No replies waiting." : "Nothing handled yet."}</div>
          ) : (
            <ul>
              {list.map((m) => {
                const l = byId.get(m.lead_id);
                const name = l?.company ?? "Unknown lead";
                return (
                  <li key={m.id}>
                    <Link href={href(view, m.id)} className={`ib-item ${m.id === selected?.id ? "on" : ""}`}>
                      <span className="lead-avatar sm" style={{ background: avatarColor(name) }}>
                        {name.charAt(0).toUpperCase()}
                      </span>
                      <span className="ib-item-text">
                        <span className="ib-item-top">
                          <b>{name}</b>
                          <time>{shortTime(m.received_at)}</time>
                        </span>
                        <span className="ib-item-sub">{m.subject || "(no subject)"}</span>
                        <span className="ib-item-snip">{(m.body_text ?? "").replace(/\s+/g, " ").slice(0, 90)}</span>
                        {m.classification && (
                          <span className="ib-item-tag">
                            <Pill v={m.classification} />
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="card ib-pane">
          {!selected ? (
            <Empty icon={InboxIcon} title={view === "waiting" ? "You're all caught up" : "Nothing here yet"}>
              Replies are pulled from your mailboxes every 10 minutes and triaged by Claude.
            </Empty>
          ) : (
            <>
              <header className="ib-head">
                <span className="lead-avatar" style={{ background: avatarColor(lead?.company ?? "?") }}>
                  {(lead?.company ?? "?").charAt(0).toUpperCase()}
                </span>
                <div className="ib-who">
                  <h2>{lead?.company ?? "Unknown lead"}</h2>
                  <span className="muted small lead-meta">
                    {[lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "No name"}
                    {lead?.email && (
                      <a href={`mailto:${lead.email}`} className="lead-meta-item lead-link">
                        <Mail size={12} aria-hidden="true" />
                        {lead.email}
                      </a>
                    )}
                  </span>
                </div>
                <div className="ib-head-right">
                  <Pill v={selected.classification ?? "untriaged"} />
                  <Link href={`/leads/${selected.lead_id}`} className="secondary sm btn-link btn-outline ib-open">
                    Open lead
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </header>

              <div className="ib-msg">
                <div className="ib-msg-top">
                  <b>{selected.subject || "(no subject)"}</b>
                  <span className="muted small">{fmt(selected.received_at)}</span>
                </div>
                <pre>{selected.body_text}</pre>
              </div>

              {view === "waiting" ? (
                <form action={replyAction} className="ib-reply">
                  <input type="hidden" name="id" value={selected.id} />
                  <label className="ib-reply-label">
                    <Sparkles size={14} aria-hidden="true" />
                    {selected.draft_reply ? "Claude's draft reply" : "Your reply"}
                    <span className="muted small">· edit before sending. [BOOKING_LINK] becomes your tracked booking link.</span>
                  </label>
                  <textarea key={selected.id} name="body" style={{ minHeight: 170 }} defaultValue={selected.draft_reply ?? ""} />
                  <div className="form-foot">
                    <SubmitButton className="secondary" formAction={markHandled} formNoValidate pending="Marking...">
                      <Check size={15} aria-hidden="true" />
                      Mark handled without replying
                    </SubmitButton>
                    <SubmitButton pending="Sending...">
                      <Send size={15} aria-hidden="true" />
                      Send reply
                    </SubmitButton>
                  </div>
                </form>
              ) : (
                <div className="dash-empty">
                  <CheckCheck size={18} aria-hidden="true" />
                  <span>
                    Handled. See the full conversation on the <Link href={`/leads/${selected.lead_id}`}>lead page</Link>.
                  </span>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
