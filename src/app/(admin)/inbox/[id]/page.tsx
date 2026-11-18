import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, CheckCheck, CornerUpLeft, Mail, Send, Sparkles } from "lucide-react";
import { markHandled, replyAction } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Flash, Pill } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead, Mailbox, Message } from "@/lib/types";
import { avatarColor, cleanBody, longTime } from "../thread";

type LeadLite = Pick<Lead, "id" | "company" | "first_name" | "last_name" | "email">;
type BoxLite = Pick<Mailbox, "id" | "email" | "from_name">;

/** One reply, shown full page with every email sent and received for that lead, oldest first, like a mail client. */
export default async function Conversation({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  const [{ id }, { msg }] = await Promise.all([params, searchParams]);

  const rows = must(await db().from("messages").select("*").eq("id", id).limit(1)) as Message[];
  const selected = rows[0];
  if (!selected || selected.direction !== "in") notFound();

  const [lead, thread, boxes] = await Promise.all([
    db()
      .from("leads")
      .select("id,company,first_name,last_name,email")
      .eq("id", selected.lead_id)
      .single()
      .then((r) => must(r) as LeadLite),
    db()
      .from("messages")
      .select("*")
      .eq("lead_id", selected.lead_id)
      // Everything they sent, and only what we actually sent (not drafts or scheduled follow-ups).
      .or("direction.eq.in,status.eq.sent")
      .then((r) => must(r) as Message[]),
    db()
      .from("mailboxes")
      .select("id,email,from_name")
      .then((r) => must(r) as BoxLite[]),
  ]);

  const when = (m: Message) => (m.direction === "in" ? m.received_at : m.sent_at) ?? m.created_at;
  const emails = thread.sort((a, b) => when(a).localeCompare(when(b)));
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const company = lead.company ?? "Unknown lead";
  const person = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  const theirName = person || company;
  const last = emails[emails.length - 1];
  const subject = (selected.subject ?? "(no subject)").replace(/^(re:\s*)+/i, "");

  return (
    <>
      <div className="cv-top">
        <Link href={selected.handled ? "/inbox?view=handled" : "/inbox"} className="cv-back">
          <ArrowLeft size={16} aria-hidden="true" />
          Inbox
        </Link>
      </div>
      <Flash msg={msg} />

      <section className="card cv">
        <header className="cv-head">
          <div className="cv-title">
            <h1>{subject}</h1>
            <span className="muted small">
              {emails.length} {emails.length === 1 ? "email" : "emails"} with {company}
            </span>
          </div>
          <div className="cv-head-right">
            <Pill v={selected.classification ?? "untriaged"} />
            <Link href={`/leads/${lead.id}`} className="secondary sm btn-link btn-outline ib-open">
              Open lead
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <div className="cv-thread">
          {emails.map((m) => {
            const ours = m.direction === "out";
            const box = m.mailbox_id ? boxById.get(m.mailbox_id) : undefined;
            const fromName = ours ? box?.from_name || "You" : theirName;
            const fromEmail = ours ? box?.email : lead.email;
            const toLabel = ours ? `to ${theirName}${lead.email ? ` <${lead.email}>` : ""}` : `to ${box?.email ?? "you"}`;
            const body = cleanBody(m.body_text);
            // Like a mail client: the email you opened and the latest one are open, older ones fold to a line.
            const open = m.id === selected.id || m.id === last?.id;
            return (
              <details key={m.id} className={`cv-mail ${ours ? "ours" : "theirs"} ${m.id === selected.id ? "current" : ""}`} open={open}>
                <summary>
                  <span className="lead-avatar" style={{ background: ours ? "#1f1f1f" : avatarColor(company), color: ours ? "#fff" : undefined }}>
                    {fromName.charAt(0).toUpperCase()}
                  </span>
                  <span className="cv-from">
                    <span className="cv-from-line">
                      <b>{fromName}</b>
                      {fromEmail && <span className="muted small">&lt;{fromEmail}&gt;</span>}
                      {ours ? <span className="cv-tag ours">Sent</span> : m.classification && <Pill v={m.classification} />}
                    </span>
                    <span className="muted small cv-to">{toLabel}</span>
                    <span className="muted small cv-snip">{body.replace(/\s+/g, " ").slice(0, 140)}</span>
                  </span>
                  <time className="muted small">{longTime(when(m))}</time>
                </summary>
                <div className="cv-body">
                  {m.subject && <div className="cv-subject">{m.subject}</div>}
                  <pre>{body || "(empty email)"}</pre>
                </div>
              </details>
            );
          })}
        </div>

        {!selected.handled ? (
          <form action={replyAction} className="cv-reply">
            <input type="hidden" name="id" value={selected.id} />
            <input type="hidden" name="back" value={`/inbox/${selected.id}`} />
            <div className="cv-reply-head">
              <CornerUpLeft size={16} aria-hidden="true" />
              <span>
                Reply to <b>{theirName}</b>
                {lead.email && (
                  <span className="muted">
                    {" "}
                    <Mail size={12} aria-hidden="true" /> {lead.email}
                  </span>
                )}
              </span>
            </div>
            <label className="ib-reply-label">
              <Sparkles size={14} aria-hidden="true" />
              {selected.draft_reply ? "Claude's draft reply" : "Your reply"}
              <span className="muted small">· edit before sending. [BOOKING_LINK] becomes your tracked booking link.</span>
            </label>
            <textarea name="body" style={{ minHeight: 220 }} defaultValue={selected.draft_reply ?? ""} />
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
              Handled{selected.classification === "out_of_office" ? ": automatic reply, nothing to answer" : ""}.
            </span>
          </div>
        )}
      </section>
    </>
  );
}
