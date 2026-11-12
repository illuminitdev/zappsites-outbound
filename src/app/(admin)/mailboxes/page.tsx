import { Mail, Pause, Play, Plus, ShieldAlert } from "lucide-react";
import { saveMailbox, toggleMailbox } from "@/app/actions";
import { Empty, Flash } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Mailbox } from "@/lib/types";

export default async function Mailboxes({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const boxes = must(await db().from("mailboxes").select("*").order("created_at")) as Mailbox[];
  const today = await Promise.all(boxes.map(async (b) => ((await db().rpc("mailbox_sent_today", { mb: b.id })).data as number) ?? 0));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mailboxes</h1>
          <p className="muted">The email accounts that send your sequences and receive replies.</p>
        </div>
        <a href="#add" className="btn-link">
          <Plus size={16} aria-hidden="true" />
          Add mailbox
        </a>
      </div>
      <Flash msg={msg} />

      <div className="card callout info">
        <b className="icon-title">
          <ShieldAlert size={16} aria-hidden="true" />
          Protect your main domain
        </b>
        <p className="small">
          Send from secondary domains (e.g. getwebvault.co.uk), never your main domain. Set up SPF, DKIM and DMARC, warm each mailbox for 2–3 weeks,
          and keep it under 30–40 cold emails a day.
        </p>
      </div>

      {boxes.length === 0 ? (
        <div className="card">
          <Empty icon={Mail} title="No mailboxes yet">Add one below to start sending.</Empty>
        </div>
      ) : (
        <div className="box-grid">
          {boxes.map((b, i) => {
            const used = today[i] ?? 0;
            const pct = Math.min(100, b.daily_limit ? (used / b.daily_limit) * 100 : 0);
            return (
              <div key={b.id} className={`card box ${b.active ? "" : "paused"}`}>
                <div className="box-head">
                  <span className="avatar">{(b.from_name || b.email).charAt(0).toUpperCase()}</span>
                  <div className="box-who">
                    <b>{b.from_name}</b>
                    <span className="muted small">{b.email}</span>
                  </div>
                  {b.active ? <span className="pill good">active</span> : <span className="pill">paused</span>}
                </div>
                <div className="usage">
                  <div className="usage-row">
                    <span className="small muted">Sent today</span>
                    <span className="small">
                      <b>{used}</b> / {b.daily_limit}
                    </span>
                  </div>
                  <div className="usage-bar">
                    <span className={pct >= 100 ? "full" : ""} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="box-foot">
                  <span className="muted small">
                    {b.smtp_host}:{b.smtp_port}
                  </span>
                  <form action={toggleMailbox}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="active" value={String(!b.active)} />
                    <button className="secondary sm">
                      {b.active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                      {b.active ? "Pause" : "Resume"}
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 id="add" className="section-title">
        Add or update a mailbox
      </h2>
      <form action={saveMailbox} className="card form-sections">
        <p className="muted small">Saving an email that already exists updates it.</p>
        <fieldset>
          <legend>Account</legend>
          <div className="row">
            <div>
              <label>Email address</label>
              <input name="email" type="email" required placeholder="ram@getwebvault.co.uk" />
            </div>
            <div>
              <label>From name</label>
              <input name="from_name" required placeholder="Ram Karri" />
            </div>
          </div>
          <div className="row">
            <div>
              <label>SMTP username (defaults to email)</label>
              <input name="smtp_user" />
            </div>
            <div>
              <label>App password</label>
              <input name="smtp_pass" type="password" required />
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Servers</legend>
          <div className="row">
            <div>
              <label>SMTP host / port (sending)</label>
              <div className="host-port">
                <input name="smtp_host" required placeholder="smtp.gmail.com" />
                <input name="smtp_port" type="number" defaultValue={465} />
              </div>
            </div>
            <div>
              <label>IMAP host / port (replies)</label>
              <div className="host-port">
                <input name="imap_host" required placeholder="imap.gmail.com" />
                <input name="imap_port" type="number" defaultValue={993} />
              </div>
            </div>
          </div>
          <div className="hints">
            <div>
              <b>Google Workspace</b>
              <span>smtp.gmail.com : 465 · imap.gmail.com : 993 · app password</span>
            </div>
            <div>
              <b>Microsoft 365</b>
              <span>smtp.office365.com : 587 · outlook.office365.com : 993</span>
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Limits</legend>
          <label>Daily cold-email limit</label>
          <input name="daily_limit" type="number" defaultValue={30} style={{ maxWidth: 200 }} />
        </fieldset>
        <div className="form-foot">
          <button className="btn-primary">Save mailbox</button>
        </div>
      </form>
    </>
  );
}
