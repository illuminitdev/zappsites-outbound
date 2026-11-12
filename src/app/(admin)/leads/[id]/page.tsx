import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, X } from "lucide-react";
import { notFound } from "next/navigation";
import { approveOne, confirmPecr, meetingBooked, resetLead, saveDraft } from "@/app/actions";
import { Flash, Pill, Score, fmt } from "@/components/ui";
import { db, must } from "@/lib/db";
import { friendlyError } from "@/lib/errors";
import type { Lead, Message } from "@/lib/types";

const PROMPT_SOURCE = { website: "from their website", campaign: "campaign", fallback: "generic (couldn't read site)", default: "generic" } as const;

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const lead = must(await db().from("leads").select("*").eq("id", id).maybeSingle()) as Lead | null;
  if (!lead) notFound();
  const [messages, events] = await Promise.all([
    db()
      .from("messages")
      .select("*")
      .eq("lead_id", id)
      .order("created_at")
      .then((r) => must(r) as Message[]),
    db()
      .from("events")
      .select("type,created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then((r) => must(r) as { type: string; created_at: string }[]),
  ]);
  const editable = messages.filter((m) => m.direction === "out" && ["draft", "scheduled"].includes(m.status));
  const history = messages.filter((m) => !editable.includes(m));
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  const aeo = lead.audit?.aeo;

  return (
    <>
      <Link href="/leads" className="back">
        <ArrowLeft size={14} aria-hidden="true" />
        All leads
      </Link>
      <div className="page-head">
        <div>
          <h1 className="with-pill">
            {lead.company} <Pill v={lead.status} />
          </h1>
          <p className="muted">
            {lead.domain ?? "No website"}
            {lead.city ? ` · ${lead.city}` : ""} · added {fmt(lead.created_at)}
          </p>
        </div>
        <div className="head-actions">
          {lead.status === "ready" && (
            <form action={approveOne}>
              <input type="hidden" name="id" value={lead.id} />
              <button className="btn-primary">Approve and schedule</button>
            </form>
          )}
          <form action={meetingBooked}>
            <input type="hidden" name="id" value={lead.id} />
            <button className="secondary">Mark meeting booked</button>
          </form>
        </div>
      </div>
      <Flash msg={msg} />

      <div className="info-grid">
        <div className="card info">
          <span className="info-label">Contact</span>
          <b>{name || "–"}</b>
          <span className="small">
            {lead.email ?? "no email"} <Pill v={lead.email_status} />
          </span>
        </div>
        <div className="card info">
          <span className="info-label">Website</span>
          <b>
            {lead.website ? (
              <a href={lead.website} target="_blank" rel="noreferrer">
                {lead.domain}
              </a>
            ) : (
              "–"
            )}
          </b>
          <span className="small muted">{lead.source.replace(/_/g, " ")} lead</span>
        </div>
        <div className="card info">
          <span className="info-label">Audit score</span>
          <b>
            <Score v={lead.audit_score} />
          </b>
          <a href={`/p/${lead.slug}`} target="_blank" className="small icon-link">
            Open their audit page
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <div className="card info">
          <span className="info-label">PECR</span>
          <b>{lead.pecr_ok ? <span className="pill good">corporate subscriber</span> : <span className="pill warn">not confirmed</span>}</b>
          <span className="small muted">{lead.entity_type.replace(/_/g, " ")}</span>
        </div>
      </div>

      {(lead.notes || lead.last_error) && (
        <div className="card">
          {lead.notes && (
            <p className="note">
              <b>Latest reply:</b> {lead.notes}
            </p>
          )}
          {lead.last_error && (
            <>
              <p className="row-error">{friendlyError(lead.last_error)}</p>
              <details className="muted small">
                <summary>Technical details</summary>
                <code className="mono">{lead.last_error}</code>
              </details>
            </>
          )}
        </div>
      )}

      {!lead.pecr_ok && (
        <form action={confirmPecr} className="card callout warn">
          <input type="hidden" name="id" value={lead.id} />
          <b>PECR check needed before sending</b>
          <p className="small">
            Unsolicited marketing email in the UK is only allowed to corporate subscribers (limited companies, LLPs, PLCs) unless they have consented.
            Sole traders and partnerships need consent. Confirm only if you have checked Companies House.
          </p>
          <div className="inline-form">
            <select name="entity_type" defaultValue="company">
              <option value="company">Limited company / PLC</option>
              <option value="llp">LLP</option>
            </select>
            <button>I&apos;ve checked: it&apos;s a corporate subscriber</button>
          </div>
        </form>
      )}

      {editable.length > 0 && (
        <>
          <h2 className="section-title">Email sequence</h2>
          <p className="muted small" style={{ marginTop: -6 }}>
            Editable until sent. [AUDIT_LINK] and [BOOKING_LINK] are filled in when each email goes out.
          </p>
          {editable.map((m) => (
            <form key={m.id} action={saveDraft} className="card email">
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="lead_id" value={lead.id} />
              <div className="email-head">
                <span className="step">Step {(m.step ?? 0) + 1}</span>
                <Pill v={m.status} />
                {m.scheduled_for && <span className="muted small">sends {fmt(m.scheduled_for)}</span>}
              </div>
              <label>Subject</label>
              <input name="subject" defaultValue={m.subject ?? ""} />
              <label>Body</label>
              <textarea name="body" style={{ minHeight: 170 }} defaultValue={m.body_text ?? ""} />
              <div className="form-foot">
                <button className="secondary">Save changes</button>
              </div>
            </form>
          ))}
        </>
      )}

      {history.length > 0 && (
        <>
          <h2 className="section-title">Conversation</h2>
          <div className="thread">
            {history.map((m) => (
              <div key={m.id} className={`bubble ${m.direction === "out" ? "out" : "in"}`}>
                <div className="bubble-head">
                  <b>{m.direction === "out" ? "You" : lead.first_name || lead.company}</b>
                  <span className="muted small">{fmt(m.sent_at ?? m.received_at ?? m.created_at)}</span>
                  <Pill v={m.classification ?? m.status} />
                </div>
                {m.subject && <div className="bubble-subject">{m.subject}</div>}
                <pre>{m.body_text}</pre>
              </div>
            ))}
          </div>
        </>
      )}

      {lead.audit && lead.audit.checks.length > 0 && (
        <>
          <h2 className="section-title">Website audit</h2>
          <div className="card table-card">
            <table className="data">
              <tbody>
                {lead.audit.checks.map((c) => (
                  <tr key={c.id}>
                    <td style={{ width: 32 }}>
                      <span className={`check ${c.pass ? "pass" : "fail"}`}>
                        {c.pass ? <Check size={13} strokeWidth={3} aria-label="Pass" /> : <X size={13} strokeWidth={3} aria-label="Fail" />}
                      </span>
                    </td>
                    <td>
                      <b className="small">{c.label}</b>
                      <div className="muted small">{c.detail}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`impact ${c.impact}`}>{c.impact}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aeo && (
        <>
          <h2 className="section-title">
            AI mentions · {aeo.mentions}/{aeo.answered} answers ({aeo.mentionRate}%)
          </h2>
          <div className="chips-row">
            <span className="chip">Category: {aeo.category}</span>
            {aeo.services?.length ? <span className="chip">Services: {aeo.services.join(", ")}</span> : null}
            {aeo.promptSource && <span className="chip">Questions: {PROMPT_SOURCE[aeo.promptSource]}</span>}
            <span className="chip">Recommended instead: {aeo.topCompetitors.map((c) => `${c.name} ×${c.count}`).join(", ") || "none detected"}</span>
          </div>
          <div className="card table-card">
            <table className="data">
              <thead>
                <tr>
                  <th>Engine</th>
                  <th>Question</th>
                  <th>Result</th>
                  <th>Named instead</th>
                </tr>
              </thead>
              <tbody>
                {aeo.results.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <b className="small">{r.engine}</b>
                    </td>
                    <td>
                      {r.prompt}
                      <details>
                        <summary className="muted small">Show answer</summary>
                        <pre className="answer">{r.error ? `Error: ${r.error}` : r.answerExcerpt}</pre>
                      </details>
                    </td>
                    <td>
                      {r.error ? (
                        <span className="pill">error</span>
                      ) : r.mentioned ? (
                        <span className="pill good pill-icon">
                          <Check size={12} strokeWidth={3} aria-label="Mentioned" />
                          {r.position ? ` #${r.position}` : ""}
                          {r.cited ? " · cited" : ""}
                        </span>
                      ) : (
                        <span className="pill bad pill-icon">
                          <X size={12} strokeWidth={3} aria-label="Not mentioned" />
                        </span>
                      )}
                    </td>
                    <td className="muted small">{r.competitors.slice(0, 4).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="detail-bottom">
        {events.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h2>Activity</h2>
            </div>
            <ul className="timeline">
              {events.map((e, i) => (
                <li key={i}>
                  <span>{e.type.replace(/_/g, " ")}</span>
                  <small className="muted">{fmt(e.created_at)}</small>
                </li>
              ))}
            </ul>
          </section>
        )}
        <form action={resetLead} className="card">
          <input type="hidden" name="id" value={lead.id} />
          <div className="card-head">
            <h2>Fix and re-process</h2>
          </div>
          <p className="muted small">Correct the website or email if they&apos;re wrong. Drafts are deleted and the lead starts again from “new”.</p>
          <label>Website</label>
          <input name="website" placeholder={lead.website ?? "https://…"} />
          <label>Email</label>
          <input name="email" placeholder={lead.email ?? "name@company.co.uk"} />
          <div className="form-foot">
            <button className="secondary">Reset and re-process</button>
          </div>
        </form>
      </div>
    </>
  );
}
