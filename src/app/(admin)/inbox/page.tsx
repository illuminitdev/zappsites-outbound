import Link from "next/link";
import { CheckCheck, ChevronRight, Inbox as InboxIcon, MessageCircleQuestion, ThumbsUp } from "lucide-react";
import { Empty, Flash, Pill } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead, Message } from "@/lib/types";
import { avatarColor, shortTime } from "./thread";

type View = "waiting" | "handled";
type LeadLite = Pick<Lead, "id" | "company" | "first_name" | "last_name" | "email">;

export default async function Inbox({ searchParams }: { searchParams: Promise<{ msg?: string; view?: string }> }) {
  const { msg, view: viewParam } = await searchParams;
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

  const waiting = waitingCount.count ?? 0;
  const handled = handledCount.count ?? 0;
  const interested = view === "waiting" ? rows.filter((m) => m.classification === "interested").length : 0;
  const questions = view === "waiting" ? rows.filter((m) => m.classification === "question").length : 0;
  const tab = (v: View) => (v === "handled" ? "/inbox?view=handled" : "/inbox");

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
              ? `${waiting} ${waiting === 1 ? "reply" : "replies"} waiting. Open one to read the full conversation and send Claude's draft.`
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

      <section className="card ib-rows">
        <div className="ib-rows-head">
          <div>
            <h2>{view === "waiting" ? "Waiting for you" : "Handled"}</h2>
            <span className="muted small">
              {view === "waiting" ? "Replies that need an answer, newest first." : "Answered, auto-replies and anything marked done."}
            </span>
          </div>
          <div className="ib-seg">
            <Link href={tab("waiting")} className={view === "waiting" ? "on" : undefined}>
              Waiting <span>{waiting}</span>
            </Link>
            <Link href={tab("handled")} className={view === "handled" ? "on" : undefined}>
              Handled <span>{handled}</span>
            </Link>
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty icon={InboxIcon} title={view === "waiting" ? "You're all caught up" : "Nothing here yet"}>
            Replies are pulled from your mailboxes every 10 minutes and triaged by Claude.
          </Empty>
        ) : (
          <ul>
            {rows.map((m) => {
              const name = m.lead?.company ?? "Unknown lead";
              const person = [m.lead?.first_name, m.lead?.last_name].filter(Boolean).join(" ");
              return (
                <li key={m.id}>
                  <Link href={`/inbox/${m.id}`} className={`ib-row ${m.handled ? "" : "unread"}`}>
                    <span className="lead-avatar sm" style={{ background: avatarColor(name) }}>
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span className="ib-row-main">
                      <span className="ib-row-top">
                        <b className="ib-row-name">{name}</b>
                        <span className="muted small ib-row-person">{person || m.lead?.email || ""}</span>
                        <time>{shortTime(m.received_at)}</time>
                      </span>
                      <span className="ib-row-subject">{m.subject || "(no subject)"}</span>
                      <span className="ib-row-snip">{(m.body_text ?? "").replace(/\s+/g, " ").trim().slice(0, 220)}</span>
                      {m.classification && (
                        <span className="ib-row-tag">
                          <Pill v={m.classification} />
                        </span>
                      )}
                    </span>
                    <ChevronRight size={18} className="ib-row-go" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
