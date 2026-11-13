import { ArrowDownToLine, ArrowUpFromLine, Gauge, Inbox, Mail, Pause, Play, Send } from "lucide-react";
import { toggleMailbox } from "@/app/actions";
import { MailboxForm } from "@/components/MailboxForm";
import { ModalButton } from "@/components/Modal";
import { ProviderIcon, providerName } from "@/components/ProviderIcons";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Mailbox } from "@/lib/types";

export default async function Mailboxes({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const boxes = must(await db().from("mailboxes").select("*").order("created_at")) as Mailbox[];
  const head = { count: "exact" as const, head: true };
  const perBox = await Promise.all(
    boxes.map(async (b) => {
      const [today, total, received] = await Promise.all([
        db().rpc("mailbox_sent_today", { mb: b.id }),
        db().from("messages").select("id", head).eq("mailbox_id", b.id).eq("direction", "out").eq("status", "sent"),
        db().from("messages").select("id", head).eq("mailbox_id", b.id).eq("direction", "in"),
      ]);
      return { today: (today.data as number) ?? 0, total: total.count ?? 0, received: received.count ?? 0 };
    }),
  );

  const active = boxes.filter((b) => b.active);
  const sentToday = boxes.reduce((a, b, i) => a + (b.active ? perBox[i].today : 0), 0);
  const capacity = active.reduce((a, b) => a + b.daily_limit, 0);
  const sentAll = perBox.reduce((a, p) => a + p.total, 0);
  const repliesAll = perBox.reduce((a, p) => a + p.received, 0);

  const summary = [
    { label: "Active mailboxes", value: `${active.length}`, sub: `${boxes.length} connected`, icon: Mail, tone: "green" },
    { label: "Sent today", value: `${sentToday}`, sub: `of ${capacity} daily capacity`, icon: Gauge, tone: "orange" },
    { label: "Emails sent", value: `${sentAll}`, sub: "All time", icon: Send, tone: "blue" },
    { label: "Replies received", value: `${repliesAll}`, sub: "All time", icon: Inbox, tone: "grey" },
  ];

  return (
    <>
      <section className="dash-hero">
        <div>
          <h1>Mailboxes</h1>
          <p>The email accounts that send your sequences and receive replies.</p>
        </div>
        <div className="head-actions">
          <ModalButton label="Add mailbox" title="Add mailbox" size="md">
            <MailboxForm />
          </ModalButton>
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
            <span className="dash-kpi-sub">{k.sub}</span>
          </div>
        ))}
      </div>

      {boxes.length === 0 ? (
        <div className="card">
          <Empty icon={Mail} title="No mailboxes yet">
            Click “Add mailbox” to connect one and start sending.
          </Empty>
        </div>
      ) : (
        <div className="mb-grid">
          {boxes.map((b, i) => {
            const p = perBox[i];
            const pct = Math.min(100, b.daily_limit ? (p.today / b.daily_limit) * 100 : 0);
            const left = Math.max(0, b.daily_limit - p.today);
            return (
              <article key={b.id} className={`card mb ${b.active ? "" : "paused"}`}>
                <header className="mb-head">
                  <span className="mb-logo">
                    <ProviderIcon smtpHost={b.smtp_host} />
                  </span>
                  <div className="mb-who">
                    <h2>{b.from_name}</h2>
                    <span className="muted small">{b.email}</span>
                  </div>
                  {b.active ? (
                    <span className="pill good camp-status">
                      <span className="camp-dot" />
                      Active
                    </span>
                  ) : (
                    <span className="pill camp-status">Paused</span>
                  )}
                </header>

                <div className="mb-usage">
                  <div className="mb-usage-row">
                    <span>
                      <b>{p.today}</b>
                      <span className="muted"> / {b.daily_limit} sent today</span>
                    </span>
                    <span className="muted small">{pct >= 100 ? "Limit reached" : `${left} left`}</span>
                  </div>
                  <div className="dash-track lg">
                    <span className={`dash-bar ${pct >= 100 ? "full" : ""}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="mb-stats">
                  <div>
                    <b>{p.total}</b>
                    <span>Sent all time</span>
                  </div>
                  <div>
                    <b>{p.received}</b>
                    <span>Replies</span>
                  </div>
                  <div>
                    <b>{providerName(b.smtp_host)}</b>
                    <span>Provider</span>
                  </div>
                </div>

                <dl className="mb-servers">
                  <div>
                    <dt>
                      <ArrowUpFromLine size={13} aria-hidden="true" />
                      Sending
                    </dt>
                    <dd>
                      {b.smtp_host}:{b.smtp_port}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <ArrowDownToLine size={13} aria-hidden="true" />
                      Replies
                    </dt>
                    <dd>
                      {b.imap_host}:{b.imap_port}
                    </dd>
                  </div>
                </dl>

                <footer className="camp-foot">
                  <ModalButton label="Edit" title={`Edit ${b.email}`} icon="pencil" variant="small" size="md">
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
                    <input type="hidden" name="active" value={String(!b.active)} />
                    <SubmitButton className="secondary sm" pending={b.active ? "Pausing..." : "Resuming..."}>
                      {b.active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                      {b.active ? "Pause" : "Resume"}
                    </SubmitButton>
                  </form>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
