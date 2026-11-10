import { saveMailbox, toggleMailbox } from "@/app/actions";
import { Flash } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Mailbox } from "@/lib/types";

export default async function Mailboxes({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const boxes = must(await db().from("mailboxes").select("*").order("created_at")) as Mailbox[];
  const today = await Promise.all(boxes.map(async (b) => (await db().rpc("mailbox_sent_today", { mb: b.id })).data as number));

  return (
    <>
      <h1>Mailboxes</h1>
      <Flash msg={msg} />
      <p className="muted">
        Send from secondary domains (e.g. getwebvault.co.uk), never your main domain. Set up SPF, DKIM and DMARC, warm each
        mailbox for 2–3 weeks, and keep it under 30–40 cold emails a day.
      </p>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>From name</th>
            <th>Today / limit</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {boxes.map((b, i) => (
            <tr key={b.id}>
              <td>{b.email}</td>
              <td>{b.from_name}</td>
              <td>
                {today[i] ?? 0} / {b.daily_limit}
              </td>
              <td>{b.active ? <span className="pill good">active</span> : <span className="pill">paused</span>}</td>
              <td>
                <form action={toggleMailbox}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="active" value={String(!b.active)} />
                  <button className="secondary" style={{ marginTop: 0 }}>{b.active ? "Pause" : "Resume"}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add or update a mailbox</h2>
      <form action={saveMailbox} className="card">
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
        <div className="row">
          <div>
            <label>SMTP host / port</label>
            <div className="row">
              <input name="smtp_host" required placeholder="smtp.gmail.com" />
              <input name="smtp_port" type="number" defaultValue={465} />
            </div>
          </div>
          <div>
            <label>IMAP host / port</label>
            <div className="row">
              <input name="imap_host" required placeholder="imap.gmail.com" />
              <input name="imap_port" type="number" defaultValue={993} />
            </div>
          </div>
        </div>
        <label>Daily cold-email limit</label>
        <input name="daily_limit" type="number" defaultValue={30} />
        <button>Save mailbox</button>
        <p className="muted">Google Workspace: smtp.gmail.com:465 + imap.gmail.com:993 with an app password. Microsoft 365: smtp.office365.com:587 + outlook.office365.com:993.</p>
      </form>
    </>
  );
}
