import Link from "next/link";
import { notFound } from "next/navigation";
import { approveOne, confirmPecr, meetingBooked, resetLead, saveDraft } from "@/app/actions";
import { Flash, Pill, fmt } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead, Message } from "@/lib/types";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const lead = must(await db().from("leads").select("*").eq("id", id).maybeSingle()) as Lead | null;
  if (!lead) notFound();
  const messages = must(await db().from("messages").select("*").eq("lead_id", id).order("created_at")) as Message[];
  const events = must(await db().from("events").select("type,created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(20)) as { type: string; created_at: string }[];
  const editable = messages.filter((m) => m.direction === "out" && ["draft", "scheduled"].includes(m.status));
  const history = messages.filter((m) => !editable.includes(m));

  return (
    <>
      <p>
        <Link href="/leads">← Leads</Link>
      </p>
      <h1>
        {lead.company} <Pill v={lead.status} />
      </h1>
      <Flash msg={msg} />
      <div className="card">
        <div className="row3">
          <div>
            <label>Contact</label>
            {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "–"}
            <div>{lead.email ?? "no email"} <Pill v={lead.email_status} /></div>
          </div>
          <div>
            <label>Website</label>
            {lead.website ? <a href={lead.website} target="_blank">{lead.domain}</a> : "–"}
            <div className="muted">{lead.city}</div>
          </div>
          <div>
            <label>Audit page</label>
            <a href={`/p/${lead.slug}`} target="_blank">/p/{lead.slug}</a>
            <div className="muted">Score {lead.audit_score ?? "–"}</div>
          </div>
        </div>
        {lead.notes && <p><b>Latest reply:</b> {lead.notes}</p>}
        {lead.last_error && <p className="muted">Error: {lead.last_error}</p>}
      </div>

      {!lead.pecr_ok && (
        <form action={confirmPecr} className="card">
          <input type="hidden" name="id" value={lead.id} />
          <b>PECR check</b>
          <p className="muted">
            Unsolicited marketing email in the UK is only allowed to corporate subscribers (limited companies, LLPs, PLCs) unless
            they have consented. Sole traders and partnerships need consent. Confirm only if you have checked Companies House.
          </p>
          <select name="entity_type" defaultValue="company">
            <option value="company">Limited company / PLC</option>
            <option value="llp">LLP</option>
          </select>
          <button>I've checked: it's a corporate subscriber</button>
        </form>
      )}

      <div className="card">
        <form action={approveOne} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={lead.id} />
          {lead.status === "ready" && <button>Approve and schedule</button>}
        </form>{" "}
        <form action={meetingBooked} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={lead.id} />
          <button className="secondary">Mark meeting booked</button>
        </form>
        <form action={resetLead}>
          <input type="hidden" name="id" value={lead.id} />
          <div className="row">
            <input name="website" placeholder="Correct website (optional)" />
            <input name="email" placeholder="Correct email (optional)" />
          </div>
          <button className="secondary">Reset and re-process</button>
        </form>
      </div>

      {editable.length > 0 && <h2>Sequence (editable until sent)</h2>}
      {editable.map((m) => (
        <form key={m.id} action={saveDraft} className="card">
          <input type="hidden" name="id" value={m.id} />
          <input type="hidden" name="lead_id" value={lead.id} />
          <div className="muted">
            Step {(m.step ?? 0) + 1} · <Pill v={m.status} /> {m.scheduled_for && `· ${fmt(m.scheduled_for)}`}
          </div>
          <label>Subject</label>
          <input name="subject" defaultValue={m.subject ?? ""} />
          <label>Body ([AUDIT_LINK] and [BOOKING_LINK] are filled in when sent)</label>
          <textarea name="body" style={{ minHeight: 160 }} defaultValue={m.body_text ?? ""} />
          <button className="secondary">Save</button>
        </form>
      ))}

      {history.length > 0 && <h2>Thread</h2>}
      {history.map((m) => (
        <div key={m.id} className="card">
          <div className="muted">
            {m.direction === "out" ? "→ Sent" : "← Received"} · {fmt(m.sent_at ?? m.received_at ?? m.created_at)} · <Pill v={m.classification ?? m.status} />
          </div>
          <b>{m.subject}</b>
          <pre>{m.body_text}</pre>
        </div>
      ))}

      {lead.audit && (
        <>
          <h2>Audit</h2>
          <table>
            <tbody>
              {lead.audit.checks.map((c) => (
                <tr key={c.id}>
                  <td>{c.pass ? "✓" : "✗"}</td>
                  <td>{c.label}</td>
                  <td className="muted">{c.detail}</td>
                  <td>{c.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {lead.audit?.aeo && (
        <>
          <h2>
            AI mentions: {lead.audit.aeo.mentions}/{lead.audit.aeo.answered} answers ({lead.audit.aeo.mentionRate}%)
          </h2>
          <p className="muted">
            Category: {lead.audit.aeo.category}
            {lead.audit.aeo.services?.length ? ` · Services asked about: ${lead.audit.aeo.services.join(", ")}` : ""}
            {lead.audit.aeo.promptSource ? ` · Questions: ${{ website: "from their website", campaign: "campaign", fallback: "generic (couldn't read site)", default: "generic" }[lead.audit.aeo.promptSource]}` : ""} · Recommended instead: {lead.audit.aeo.topCompetitors.map((c) => `${c.name} ×${c.count}`).join(", ") || "none detected"}
          </p>
          <table>
            <tbody>
              {lead.audit.aeo.results.map((r, i) => (
                <tr key={i}>
                  <td>{r.engine}</td>
                  <td>
                    {r.prompt}
                    <details>
                      <summary className="muted">answer</summary>
                      <pre style={{ fontSize: 13 }}>{r.error ? `Error: ${r.error}` : r.answerExcerpt}</pre>
                    </details>
                  </td>
                  <td>{r.error ? "error" : r.mentioned ? `✓${r.position ? ` #${r.position}` : ""}${r.cited ? " · cited" : ""}` : "✗"}</td>
                  <td className="muted">{r.competitors.slice(0, 4).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {events.length > 0 && (
        <>
          <h2>Activity</h2>
          {events.map((e, i) => (
            <div key={i} className="muted">
              {fmt(e.created_at)} · {e.type.replace(/_/g, " ")}
            </div>
          ))}
        </>
      )}
    </>
  );
}
