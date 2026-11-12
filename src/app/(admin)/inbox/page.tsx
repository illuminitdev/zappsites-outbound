import Link from "next/link";
import { Check, Inbox as InboxIcon, Send } from "lucide-react";
import { markHandled, replyAction } from "@/app/actions";
import { Empty, Flash, Pill, fmt } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead, Message } from "@/lib/types";

export default async function Inbox({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const waiting = must(
    await db().from("messages").select("*").eq("direction", "in").eq("handled", false).order("received_at", { ascending: false }).limit(100),
  ) as Message[];
  const leadIds = [...new Set(waiting.map((m) => m.lead_id))];
  const leads = leadIds.length
    ? (must(await db().from("leads").select("id,company,first_name,email").in("id", leadIds)) as Pick<Lead, "id" | "company" | "first_name" | "email">[])
    : [];
  const byId = new Map(leads.map((l) => [l.id, l]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted">
            {waiting.length
              ? `${waiting.length} repl${waiting.length === 1 ? "y" : "ies"} waiting. Claude has drafted answers; edit before sending.`
              : "Replies from prospects land here, sorted by Claude."}
          </p>
        </div>
      </div>
      <Flash msg={msg} />

      {!waiting.length && (
        <div className="card">
          <Empty icon={InboxIcon} title="You're all caught up">Replies are pulled from your mailboxes every 10 minutes and triaged by Claude.</Empty>
        </div>
      )}

      {waiting.map((m) => {
        const l = byId.get(m.lead_id);
        const initial = (l?.first_name || l?.company || "?").charAt(0).toUpperCase();
        return (
          <div className="card reply" key={m.id}>
            <div className="reply-head">
              <span className="avatar">{initial}</span>
              <div className="reply-who">
                <Link href={`/leads/${m.lead_id}`} className="row-title">
                  {l?.company ?? "Unknown lead"}
                </Link>
                <span className="muted small">
                  {l?.first_name ? `${l.first_name} · ` : ""}
                  {l?.email} · {fmt(m.received_at)}
                </span>
              </div>
              <Pill v={m.classification ?? "untriaged"} />
            </div>
            {m.subject && <div className="bubble-subject">{m.subject}</div>}
            <blockquote className="their-msg">
              <pre>{m.body_text}</pre>
            </blockquote>
            <form action={replyAction}>
              <input type="hidden" name="id" value={m.id} />
              <label>
                Your reply <span className="muted">· Claude&apos;s draft, edit before sending. [BOOKING_LINK] becomes your tracked booking link.</span>
              </label>
              <textarea name="body" style={{ minHeight: 130 }} defaultValue={m.draft_reply ?? ""} />
              <div className="form-foot">
                <button className="secondary" formAction={markHandled} formNoValidate>
                  <Check size={15} aria-hidden="true" />
                  Mark handled without replying
                </button>
                <button className="btn-primary">
                  <Send size={15} aria-hidden="true" />
                  Send reply
                </button>
              </div>
            </form>
          </div>
        );
      })}
    </>
  );
}
