import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  MessagesSquare,
  PenLine,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Tag,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import { notFound } from "next/navigation";
import { approveOne, confirmPecr, meetingBooked, resetLead, saveDraft, sendReportAction } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Flash, Pill, fmt } from "@/components/ui";
import { db, must } from "@/lib/db";
import { friendlyError } from "@/lib/errors";
import { reportEmail, reportMailbox } from "@/lib/inbound";
import type { AuditCheck, Lead, Message } from "@/lib/types";

const PROMPT_SOURCE = { website: "from their website", campaign: "campaign", fallback: "generic (couldn't read site)", default: "generic" } as const;
const IMPACT_ORDER = { high: 0, medium: 1, low: 2 } as const;
const ENGINE_NAME = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" } as const;

const tone = (v: number | null | undefined) => (v == null ? "" : v >= 75 ? "good" : v >= 50 ? "warn" : "bad");

/** Collapse runs of the same event ("Page view" ×8) so the timeline stays short. */
function groupEvents(events: { type: string; created_at: string }[]) {
  const out: { type: string; count: number; latest: string; first: string }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.type === e.type) {
      last.count++;
      last.first = e.created_at;
    } else out.push({ type: e.type, count: 1, latest: e.created_at, first: e.created_at });
  }
  return out;
}

function ScoreRing({ v, label }: { v: number | null | undefined; label: string }) {
  const p = v ?? 0;
  return (
    <div className={`ld-ring ${tone(v)}`} style={{ "--p": p } as React.CSSProperties} role="img" aria-label={`${label}: ${v ?? "not available"}`}>
      <div className="ld-ring-inner">
        <b>{v ?? "–"}</b>
        <small>/ 100</small>
      </div>
    </div>
  );
}

function CheckRow({ c }: { c: AuditCheck }) {
  return (
    <li className={`ld-check ${c.pass ? "pass" : "fail"}`}>
      <span className={`check ${c.pass ? "pass" : "fail"}`}>
        {c.pass ? <Check size={13} strokeWidth={3} aria-label="Pass" /> : <X size={13} strokeWidth={3} aria-label="Fail" />}
      </span>
      <div className="ld-check-text">
        <b>{c.label}</b>
        <span>{c.detail}</span>
      </div>
      <span className={`impact ${c.impact}`}>{c.impact}</span>
    </li>
  );
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  // One parallel round trip: the lead, its messages, its events and the sending mailbox.
  const [lead, messages, events, box] = await Promise.all([
    db()
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then((r) => must(r) as Lead | null),
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
    reportMailbox(),
  ]);
  if (!lead) notFound();
  const editable = messages.filter((m) => m.direction === "out" && ["draft", "scheduled"].includes(m.status));
  const history = messages.filter((m) => !editable.includes(m));
  const hasReplies = history.some((m) => m.direction === "in");
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  const audit = lead.audit;
  const aeo = audit?.aeo;
  // Leads who asked for (or were sent) a report get a reviewable report email. Cold leads use the sequence instead.
  const canSendReport = !!audit && ["manual", "inbound"].includes(lead.source);
  const report = canSendReport ? reportEmail(lead) : null;
  const fromBox = canSendReport ? box : null;
  const reportSent = events.some((e) => e.type === "report_sent");

  const checks = audit?.checks ?? [];
  const failing = checks.filter((c) => !c.pass).sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);
  const passing = checks.filter((c) => c.pass);
  const perf = audit?.performance;
  const timeline = groupEvents(events);
  const initial = (lead.company || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      <Link href="/leads" className="back">
        <ArrowLeft size={14} aria-hidden="true" />
        All leads
      </Link>

      {/* ---------- Header ---------- */}
      <header className="ld-hero">
        <div className="ld-hero-main">
          <span className="ld-avatar" aria-hidden="true">
            {initial}
          </span>
          <div className="ld-hero-text">
            <h1 className="with-pill">
              {lead.company} <Pill v={lead.status} />
            </h1>
            <div className="ld-meta">
              <span>
                <Globe size={14} aria-hidden="true" />
                {lead.domain ?? "No website"}
              </span>
              {lead.city && (
                <span>
                  <MapPin size={14} aria-hidden="true" />
                  {lead.city}
                </span>
              )}
              <span>
                <Tag size={14} aria-hidden="true" />
                {lead.source.replace(/_/g, " ")} lead
              </span>
              <span>
                <Clock size={14} aria-hidden="true" />
                added {fmt(lead.created_at)}
              </span>
            </div>
          </div>
        </div>
        <div className="head-actions">
          <a href={`/p/${lead.slug}`} target="_blank" rel="noreferrer" className="btn-link btn-outline">
            <ExternalLink size={15} aria-hidden="true" />
            Audit page
          </a>
          <form action={meetingBooked}>
            <input type="hidden" name="id" value={lead.id} />
            <SubmitButton className="secondary" pending="Saving...">
              Mark meeting booked
            </SubmitButton>
          </form>
          {lead.status === "ready" && (
            <form action={approveOne}>
              <input type="hidden" name="id" value={lead.id} />
              <SubmitButton pending="Scheduling...">Approve and schedule</SubmitButton>
            </form>
          )}
        </div>
      </header>
      <Flash msg={msg} />

      {lead.last_error && (
        <div className="card callout bad">
          <b className="icon-title">
            <TriangleAlert size={16} aria-hidden="true" />
            Something went wrong with this lead
          </b>
          <p className="small">{friendlyError(lead.last_error)}</p>
          <details className="muted small">
            <summary>Technical details</summary>
            <code className="mono">{lead.last_error}</code>
          </details>
        </div>
      )}

      {!lead.pecr_ok && (
        <form action={confirmPecr} className="card callout warn">
          <input type="hidden" name="id" value={lead.id} />
          <b className="icon-title">
            <ShieldAlert size={16} aria-hidden="true" />
            PECR check needed before sending
          </b>
          <p className="small">
            Unsolicited marketing email in the UK is only allowed to corporate subscribers (limited companies, LLPs, PLCs) unless they have consented.
            Sole traders and partnerships need consent. Confirm only if you have checked Companies House.
          </p>
          <div className="inline-form">
            <select name="entity_type" defaultValue="company">
              <option value="company">Limited company / PLC</option>
              <option value="llp">LLP</option>
            </select>
            <SubmitButton className="" pending="Saving...">
              I&apos;ve checked: it&apos;s a corporate subscriber
            </SubmitButton>
          </div>
        </form>
      )}

      <div className="ld-layout">
        {/* ---------- Main column ---------- */}
        <div className="ld-main">
          {lead.notes && (
            <div className="ld-latest">
              <MessagesSquare size={18} aria-hidden="true" />
              <div>
                <span className="ld-label">Latest reply</span>
                <p>{lead.notes}</p>
              </div>
            </div>
          )}

          {report && (
            <form id="send-report" action={sendReportAction} className="card ld-panel send-report">
              <input type="hidden" name="id" value={lead.id} />
              <div className="ld-panel-head">
                <span className="dash-chip sm orange">
                  <Send size={16} aria-hidden="true" />
                </span>
                <div className="ld-panel-title">
                  <h2>Report email</h2>
                  {fromBox ? (
                    <span>
                      From <b>{fromBox.from_name}</b> &lt;{fromBox.email}&gt;
                    </span>
                  ) : (
                    <span className="row-error">No active mailbox. Add one under Mailboxes before sending.</span>
                  )}
                </div>
                {reportSent ? <span className="pill good">sent before</span> : <span className="pill warn">not sent yet</span>}
              </div>
              <div className="ld-fields">
                <div>
                  <label>To</label>
                  <input name="to" type="email" required defaultValue={lead.email ?? ""} />
                </div>
                <div>
                  <label>Subject</label>
                  <input name="subject" required defaultValue={report.subject} />
                </div>
              </div>
              <label>Message</label>
              <textarea name="body" required className="ld-body" style={{ minHeight: 260 }} defaultValue={report.text} />
              <div className="form-foot ld-foot">
                <a href={`/p/${lead.slug}`} target="_blank" rel="noreferrer" className="small icon-link">
                  Preview the report page
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
                <SubmitButton pending="Sending...">
                  <Send size={15} aria-hidden="true" />
                  {reportSent ? "Send again" : "Send email"}
                </SubmitButton>
              </div>
            </form>
          )}

          {editable.length > 0 && (
            <section className="card ld-panel">
              <div className="ld-panel-head">
                <span className="dash-chip sm orange">
                  <PenLine size={16} aria-hidden="true" />
                </span>
                <div className="ld-panel-title">
                  <h2>Email sequence</h2>
                  <span>Editable until sent. [AUDIT_LINK] and [BOOKING_LINK] are filled in when each email goes out.</span>
                </div>
              </div>
              <ol className="ld-steps">
                {editable.map((m) => (
                  <li key={m.id}>
                    <span className="ld-step-num">{(m.step ?? 0) + 1}</span>
                    <form action={saveDraft} className="ld-step-card">
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="lead_id" value={lead.id} />
                      <div className="email-head">
                        <b className="small">Step {(m.step ?? 0) + 1}</b>
                        <Pill v={m.status} />
                        {m.scheduled_for && (
                          <span className="muted small icon-link">
                            <Clock size={13} aria-hidden="true" />
                            sends {fmt(m.scheduled_for)}
                          </span>
                        )}
                      </div>
                      <label>Subject</label>
                      <input name="subject" defaultValue={m.subject ?? ""} />
                      <label>Body</label>
                      <textarea name="body" className="ld-body" style={{ minHeight: 170 }} defaultValue={m.body_text ?? ""} />
                      <div className="form-foot">
                        <SubmitButton className="secondary" pending="Saving...">
                          Save changes
                        </SubmitButton>
                      </div>
                    </form>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Only your own sent emails so far: a compact, collapsed list instead of a full chat. */}
          {history.length > 0 && !hasReplies && (
            <section className="card ld-panel">
              <div className="ld-panel-head" style={{ marginBottom: 10 }}>
                <span className="dash-chip sm grey">
                  <Mail size={16} aria-hidden="true" />
                </span>
                <div className="ld-panel-title">
                  <h2>Sent emails</h2>
                  <span>No reply yet</span>
                </div>
              </div>
              <ul className="ld-sent">
                {history.map((m) => (
                  <li key={m.id}>
                    <details>
                      <summary>
                        <ChevronDown size={15} aria-hidden="true" className="ld-sent-chev" />
                        <b>{m.subject ?? "(no subject)"}</b>
                        <span className="muted small">{fmt(m.sent_at ?? m.created_at)}</span>
                        <Pill v={m.status} />
                      </summary>
                      <pre>{m.body_text}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasReplies && (
            <section className="card ld-panel">
              <div className="ld-panel-head">
                <span className="dash-chip sm blue">
                  <MessagesSquare size={16} aria-hidden="true" />
                </span>
                <div className="ld-panel-title">
                  <h2>Conversation</h2>
                  <span>
                    {history.length} message{history.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="thread">
                {history.map((m) => {
                  const out = m.direction === "out";
                  return (
                    <div key={m.id} className={`ld-msg ${out ? "out" : "in"}`}>
                      <span className="ld-msg-avatar" aria-hidden="true">
                        {out ? "Y" : (lead.first_name || lead.company).charAt(0).toUpperCase()}
                      </span>
                      <div className={`bubble ${out ? "out" : "in"}`}>
                        <div className="bubble-head">
                          <b>{out ? "You" : lead.first_name || lead.company}</b>
                          <span className="muted small">{fmt(m.sent_at ?? m.received_at ?? m.created_at)}</span>
                          <Pill v={m.classification ?? m.status} />
                        </div>
                        {m.subject && <div className="bubble-subject">{m.subject}</div>}
                        <pre>{m.body_text}</pre>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {checks.length > 0 && (
            <section className="card ld-panel">
              <div className="ld-panel-head">
                <span className="dash-chip sm green">
                  <Globe size={16} aria-hidden="true" />
                </span>
                <div className="ld-panel-title">
                  <h2>Website audit</h2>
                  <span>
                    {passing.length} of {checks.length} checks passed
                  </span>
                </div>
                <div className="ld-tally">
                  <span className="pill bad">{failing.length} to fix</span>
                  <span className="pill good">{passing.length} passed</span>
                </div>
              </div>
              <div className="ld-progress" aria-hidden="true">
                <span style={{ width: `${(passing.length / checks.length) * 100}%` }} />
              </div>
              {failing.length > 0 ? (
                <>
                  <h3 className="ld-sub">Needs fixing</h3>
                  <ul className="ld-checks">
                    {failing.map((c) => (
                      <CheckRow key={c.id} c={c} />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="dash-allclear">
                  <Check size={14} aria-hidden="true" /> Every check passed.
                </p>
              )}
              {passing.length > 0 && (
                <details className="ld-more">
                  <summary>
                    <ChevronDown size={15} aria-hidden="true" />
                    Show {passing.length} passing checks
                  </summary>
                  <ul className="ld-checks">
                    {passing.map((c) => (
                      <CheckRow key={c.id} c={c} />
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          {aeo && (
            <section className="card ld-panel">
              <div className="ld-panel-head">
                <span className="dash-chip sm orange">
                  <Bot size={16} aria-hidden="true" />
                </span>
                <div className="ld-panel-title">
                  <h2>AI mentions</h2>
                  <span>
                    Mentioned in {aeo.mentions} of {aeo.answered} AI answers
                  </span>
                </div>
                <span className={`ld-rate ${aeo.mentionRate >= 50 ? "good" : aeo.mentionRate > 0 ? "warn" : "bad"}`}>{aeo.mentionRate}%</span>
              </div>

              <div className="ld-aeo-facts">
                <div>
                  <span className="ld-label">Category</span>
                  <span>{aeo.category}</span>
                </div>
                {aeo.promptSource && (
                  <div>
                    <span className="ld-label">Questions</span>
                    <span>{PROMPT_SOURCE[aeo.promptSource]}</span>
                  </div>
                )}
              </div>
              {aeo.services?.length ? (
                <>
                  <span className="ld-label">Services found on their site</span>
                  <div className="chips-row">
                    {aeo.services.map((s) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
              <span className="ld-label">Recommended instead</span>
              <div className="chips-row">
                {aeo.topCompetitors.length ? (
                  aeo.topCompetitors.map((c) => (
                    <span key={c.name} className="chip chip-comp">
                      {c.name} <b>×{c.count}</b>
                    </span>
                  ))
                ) : (
                  <span className="muted small">none detected</span>
                )}
              </div>

              <ul className="ld-aeo">
                {aeo.results.map((r, i) => (
                  <li key={i}>
                    <div className="ld-aeo-top">
                      <span className="ld-engine">{ENGINE_NAME[r.engine] ?? r.engine}</span>
                      {r.error ? (
                        <span className="pill">error</span>
                      ) : r.mentioned ? (
                        <span className="pill good pill-icon">
                          <Check size={12} strokeWidth={3} aria-hidden="true" />
                          Mentioned{r.position ? ` #${r.position}` : ""}
                          {r.cited ? " · cited" : ""}
                        </span>
                      ) : (
                        <span className="pill bad pill-icon">
                          <X size={12} strokeWidth={3} aria-hidden="true" />
                          Not mentioned
                        </span>
                      )}
                    </div>
                    <p className="ld-q">&ldquo;{r.prompt}&rdquo;</p>
                    {r.competitors.length > 0 && (
                      <p className="muted small">
                        <b>Named instead:</b> {r.competitors.slice(0, 4).join(", ")}
                      </p>
                    )}
                    <details className="ld-more">
                      <summary>
                        <ChevronDown size={15} aria-hidden="true" />
                        Show answer
                      </summary>
                      <pre className="answer">{r.error ? `Error: ${r.error}` : r.answerExcerpt}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ---------- Sidebar ---------- */}
        <aside className="ld-side">
          <section className="card ld-side-card">
            <h2 className="ld-side-title">
              <User size={15} aria-hidden="true" />
              Contact
            </h2>
            <b className="ld-contact-name">{name || "No name yet"}</b>
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="ld-contact-line">
                <Mail size={14} aria-hidden="true" />
                <span>{lead.email}</span>
                <Pill v={lead.email_status} />
              </a>
            ) : (
              <span className="ld-contact-line muted">
                <Mail size={14} aria-hidden="true" /> no email
              </span>
            )}
            {lead.website && (
              <a href={lead.website} target="_blank" rel="noreferrer" className="ld-contact-line">
                <Globe size={14} aria-hidden="true" />
                <span>{lead.domain}</span>
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </section>

          <section className="card ld-side-card">
            <h2 className="ld-side-title">
              <Activity size={15} aria-hidden="true" />
              Audit score
            </h2>
            <div className="ld-score">
              <ScoreRing v={lead.audit_score} label="Audit score" />
              <div className="ld-score-stats">
                <div>
                  <span>Mobile speed</span>
                  <b className={tone(perf?.mobileScore)}>{perf?.mobileScore ?? "–"}</b>
                </div>
                <div>
                  <span>Load time (LCP)</span>
                  <b>{perf?.lcpSeconds != null ? `${perf.lcpSeconds.toFixed(1)}s` : "–"}</b>
                </div>
                <div>
                  <span>Issues</span>
                  <b className={failing.length ? "bad" : "good"}>{audit ? failing.length : "–"}</b>
                </div>
              </div>
            </div>
            {perf?.screenshot && (
              <div className="ld-phone">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={perf.screenshot} alt={`${lead.company} homepage on a phone`} />
              </div>
            )}
            <a href={`/p/${lead.slug}`} target="_blank" rel="noreferrer" className="btn-link btn-outline ld-full">
              Open their audit page
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </section>

          <section className="card ld-side-card">
            <h2 className="ld-side-title">
              {lead.pecr_ok ? <ShieldCheck size={15} aria-hidden="true" /> : <ShieldAlert size={15} aria-hidden="true" />}
              Compliance (PECR)
            </h2>
            <div className={`ld-pecr ${lead.pecr_ok ? "good" : "warn"}`}>
              {lead.pecr_ok ? <ShieldCheck size={18} aria-hidden="true" /> : <ShieldAlert size={18} aria-hidden="true" />}
              <div>
                <b>{lead.pecr_ok ? "Corporate subscriber" : "Not confirmed"}</b>
                <span>Entity: {lead.entity_type.replace(/_/g, " ")}</span>
              </div>
            </div>
          </section>

          {timeline.length > 0 && (
            <section className="card ld-side-card">
              <h2 className="ld-side-title">
                <Clock size={15} aria-hidden="true" />
                Activity
              </h2>
              <ul className="timeline">
                {timeline.map((e, i) => (
                  <li key={i}>
                    <span>
                      {e.type.replace(/_/g, " ")}
                      {e.count > 1 && <span className="ld-count">×{e.count}</span>}
                    </span>
                    <small className="muted">{e.count > 1 ? `${fmt(e.first)} – ${fmt(e.latest)}` : fmt(e.latest)}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form action={resetLead} className="card ld-side-card">
            <input type="hidden" name="id" value={lead.id} />
            <h2 className="ld-side-title">
              <RotateCcw size={15} aria-hidden="true" />
              Fix and re-process
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              Correct the website or email if they&apos;re wrong. Drafts are deleted and the lead starts again from “new”.
            </p>
            <label>Website</label>
            <input name="website" placeholder={lead.website ?? "https://…"} />
            <label>Email</label>
            <input name="email" placeholder={lead.email ?? "name@company.co.uk"} />
            <div className="form-foot">
              <SubmitButton className="secondary" pending="Resetting...">
                Reset and re-process
              </SubmitButton>
            </div>
          </form>
        </aside>
      </div>
    </>
  );
}
