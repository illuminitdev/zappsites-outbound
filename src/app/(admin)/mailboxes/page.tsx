import { Mail, Pause, Play, ShieldAlert } from "lucide-react";
import { toggleMailbox } from "@/app/actions";
import { MailboxForm } from "@/components/MailboxForm";
import { ModalButton } from "@/components/Modal";
import { Empty, Flash } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Mailbox } from "@/lib/types";

export default async function Mailboxes({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  const boxes = must(
    await db().from("mailboxes").select("*").order("created_at"),
  ) as Mailbox[];
  const today = await Promise.all(
    boxes.map(
      async (b) =>
        ((await db().rpc("mailbox_sent_today", { mb: b.id })).data as number) ??
        0,
    ),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mailboxes</h1>
          <p className="muted">
            The email accounts that send your sequences and receive replies.
          </p>
        </div>
        <ModalButton label="Add mailbox" title="Add mailbox" size="md">
          <MailboxForm />
        </ModalButton>
      </div>
      <Flash msg={msg} />

      <div className="card callout info">
        <b className="icon-title">
          <ShieldAlert size={16} aria-hidden="true" />
          Protect your main domain
        </b>
        <p className="small">
          Send from secondary domains (e.g. getwebvault.co.uk), never your main
          domain. Set up SPF, DKIM and DMARC, warm each mailbox for 2–3 weeks,
          and keep it under 30–40 cold emails a day.
        </p>
      </div>

      {boxes.length === 0 ? (
        <div className="card">
          <Empty icon={Mail} title="No mailboxes yet">
            Click “Add mailbox” to connect one and start sending.
          </Empty>
        </div>
      ) : (
        <div className="box-grid">
          {boxes.map((b, i) => {
            const used = today[i] ?? 0;
            const pct = Math.min(
              100,
              b.daily_limit ? (used / b.daily_limit) * 100 : 0,
            );
            return (
              <div
                key={b.id}
                className={`card box ${b.active ? "" : "paused"}`}
              >
                <div className="box-head">
                  <span className="avatar">
                    {(b.from_name || b.email).charAt(0).toUpperCase()}
                  </span>
                  <div className="box-who">
                    <b>{b.from_name}</b>
                    <span className="muted small">{b.email}</span>
                  </div>
                  {b.active ? (
                    <span className="pill good">active</span>
                  ) : (
                    <span className="pill">paused</span>
                  )}
                </div>
                <div className="usage">
                  <div className="usage-row">
                    <span className="small muted">Sent today</span>
                    <span className="small">
                      <b>{used}</b> / {b.daily_limit}
                    </span>
                  </div>
                  <div className="usage-bar">
                    <span
                      className={pct >= 100 ? "full" : ""}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="box-foot">
                  <span className="muted small">
                    {b.smtp_host}:{b.smtp_port}
                  </span>
                  <div className="box-actions">
                    <ModalButton
                      label="Edit"
                      title={`Edit ${b.email}`}
                      icon="pencil"
                      variant="small"
                      size="md"
                    >
                      <MailboxForm
                        // Never send the saved password to the browser.
                        mailbox={{
                          id: b.id,
                          email: b.email,
                          from_name: b.from_name,
                          smtp_user: b.smtp_user,
                          smtp_host: b.smtp_host,
                          smtp_port: b.smtp_port,
                          imap_host: b.imap_host,
                          imap_port: b.imap_port,
                          daily_limit: b.daily_limit,
                        }}
                      />
                    </ModalButton>
                    <form action={toggleMailbox}>
                      <input type="hidden" name="id" value={b.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={String(!b.active)}
                      />
                      <button className="secondary sm">
                        {b.active ? (
                          <Pause size={14} aria-hidden="true" />
                        ) : (
                          <Play size={14} aria-hidden="true" />
                        )}
                        {b.active ? "Pause" : "Resume"}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
