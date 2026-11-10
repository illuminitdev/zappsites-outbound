import Link from "next/link";
import { markHandled, replyAction } from "@/app/actions";
import { Flash, Pill, fmt } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead, Message } from "@/lib/types";

export default async function Inbox({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const waiting = must(
    await db().from("messages").select("*").eq("direction", "in").eq("handled", false).order("received_at", { ascending: false }).limit(100),
  ) as Message[];
  const leadIds = [...new Set(waiting.map((m) => m.lead_id))];
  const leads = leadIds.length ? (must(await db().from("leads").select("id,company,first_name,email").in("id", leadIds)) as Pick<Lead, "id" | "company" | "first_name" | "email">[]) : [];
  const byId = new Map(leads.map((l) => [l.id, l]));

  return (
    <>
      <h1>Inbox</h1>
      <Flash msg={msg} />
      {!waiting.length && <p className="muted">Nothing waiting. Replies are pulled from your mailboxes every 10 minutes and triaged by Claude.</p>}
      {waiting.map((m) => {
        const l = byId.get(m.lead_id);
        return (
          <div className="card" key={m.id}>
            <div className="muted">
              <Link href={`/leads/${m.lead_id}`}>{l?.company}</Link> · {l?.email} · {fmt(m.received_at)} · <Pill v={m.classification ?? "untriaged"} />
            </div>
            <b>{m.subject}</b>
            <pre style={{ margin: "8px 0" }}>{m.body_text}</pre>
            <form action={replyAction}>
              <input type="hidden" name="id" value={m.id} />
              <label>Your reply (Claude's draft; edit before sending. [BOOKING_LINK] becomes your tracked booking link)</label>
              <textarea name="body" style={{ minHeight: 120 }} defaultValue={m.draft_reply ?? ""} />
              <button>Send reply</button>
            </form>
            <form action={markHandled}>
              <input type="hidden" name="id" value={m.id} />
              <button className="secondary">Mark handled without replying</button>
            </form>
          </div>
        );
      })}
    </>
  );
}
