import { Ban, CalendarCheck, Check, ClipboardCheck, Eye, Mail, MessagesSquare, PenLine, Send, ShieldCheck, UserSearch, X } from "lucide-react";
import { fmt } from "@/components/ui";
import { displayScore } from "@/lib/audit/analyze";
import type { Lead, Message } from "@/lib/types";

type State = "done" | "now" | "todo" | "stuck";
interface Step {
  key: string;
  label: string;
  state: State;
  detail: string;
  icon: React.ReactNode;
}

const STOPPED: Record<string, string> = {
  unsubscribed: "They asked not to be contacted. Nothing more will be sent.",
  bounced: "The email address bounced. Nothing more will be sent.",
  not_interested: "They replied that they're not interested. The sequence has stopped.",
  error: "Something went wrong. See the error below, then use 'Fix and re-process'.",
};

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

export interface ProgressProps {
  lead: Lead;
  messages: Message[];
  views: number;
  reportSent: boolean;
}

/** Where this lead is in the pipeline, step by step, with what happens next. */
function progressOf({ lead, messages, views, reportSent }: ProgressProps) {
  const audit = lead.audit;
  const out = messages.filter((m) => m.direction === "out" && m.status !== "cancelled").sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const sent = out.filter((m) => m.status === "sent");
  const failed = out.filter((m) => m.status === "failed");
  const scheduled = out.filter((m) => m.status === "scheduled").sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
  const replies = messages.filter((m) => m.direction === "in");
  const lastReply = replies.at(-1);
  const anySent = sent.length > 0 || reportSent;
  const stopped = STOPPED[lead.status];

  const score = audit?.url && audit.reachable ? displayScore(audit) : null;
  const issues = audit?.checks.filter((c) => !c.pass && !c.unverified).length ?? 0;

  const steps: Step[] = [
    {
      key: "found",
      label: "Lead found",
      state: "done",
      detail: `Added ${fmt(lead.created_at)} · ${lead.source.replace(/_/g, " ")}`,
      icon: <UserSearch size={15} />,
    },
    {
      key: "email",
      label: "Email address",
      state: lead.email ? (lead.email_status === "invalid" ? "stuck" : "done") : lead.status === "new" ? "now" : "stuck",
      detail: lead.email
        ? `${lead.email}${lead.email_status !== "unknown" ? ` (${lead.email_status})` : ""}`
        : lead.status === "new"
          ? "Looking for an email on the next run"
          : "No email found. Add one with 'Fix and re-process'.",
      icon: <Mail size={15} />,
    },
    {
      key: "audit",
      label: "Website audit",
      state: audit ? "done" : !lead.website ? "stuck" : lead.email ? "now" : "todo",
      detail: audit
        ? score != null
          ? `Score ${score}/100 · ${n(issues, "issue")} · ${fmt(audit.fetchedAt)}`
          : `Done ${fmt(audit.fetchedAt)} · site didn't load`
        : !lead.website
          ? "No website to audit"
          : "Not run yet. Runs automatically, or use 'Run audit now'.",
      icon: <ClipboardCheck size={15} />,
    },
    {
      key: "written",
      label: "Emails written",
      state: out.length || reportSent ? "done" : audit ? "now" : "todo",
      detail: out.length
        ? `${n(out.length, "email")} in the sequence`
        : reportSent
          ? "Report email used instead of a sequence"
          : audit
            ? "Will be written on the next run"
            : "Written after the audit",
      icon: <PenLine size={15} />,
    },
    {
      key: "approved",
      label: "Approved to send",
      state: scheduled.length || anySent ? "done" : out.length ? (lead.pecr_ok ? "now" : "stuck") : "todo",
      detail:
        scheduled.length || anySent
          ? "Approved automatically"
          : out.length
            ? lead.pecr_ok
              ? "Approves and schedules automatically on the next run"
              : "On hold: not yet confirmed as a Ltd or LLP on Companies House, so UK rules (PECR) don't allow emailing it. Re-checked automatically every 3 days."
            : "Automatic, once the emails are written",
      icon: <ShieldCheck size={15} />,
    },
    {
      key: "sent",
      label: "Emails sent",
      state: failed.length && !sent.length ? "stuck" : anySent ? (scheduled.length ? "now" : "done") : scheduled.length ? "now" : "todo",
      detail: anySent
        ? [
            sent.length ? `${sent.length} of ${out.length} sent, last ${fmt(sent.at(-1)!.sent_at ?? sent.at(-1)!.created_at)}` : "Report email sent",
            scheduled[0]?.scheduled_for ? `next (email ${(scheduled[0].step ?? 0) + 1}) ${fmt(scheduled[0].scheduled_for)}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : scheduled[0]?.scheduled_for
          ? `First email sends ${fmt(scheduled[0].scheduled_for)}`
          : failed.length
            ? `${n(failed.length, "email")} failed to send`
            : "Nothing sent yet",
      icon: <Send size={15} />,
    },
    {
      key: "viewed",
      label: "Opened audit page",
      state: views ? "done" : anySent ? "now" : "todo",
      detail: views ? `Viewed ${n(views, "time")}` : anySent ? "Not opened yet" : "After the first email",
      icon: <Eye size={15} />,
    },
    {
      key: "replied",
      label: "Replied",
      state: replies.length ? "done" : anySent ? "now" : "todo",
      detail: lastReply
        ? `${fmt(lastReply.received_at ?? lastReply.created_at)}${lastReply.classification ? ` · ${lastReply.classification.replace(/_/g, " ")}` : ""}`
        : anySent
          ? "Waiting for a reply"
          : "No reply yet",
      icon: <MessagesSquare size={15} />,
    },
    {
      key: "meeting",
      label: "Meeting booked",
      state: lead.status === "meeting" ? "done" : "todo",
      detail: lead.status === "meeting" ? "Booked" : "Not yet",
      icon: <CalendarCheck size={15} />,
    },
  ];

  // Once a lead has stopped, the step it was on is shown as stuck and the later ones stay grey.
  if (stopped) {
    const at = steps.findIndex((s) => s.state === "now" || s.state === "todo");
    if (at >= 0) steps[at] = { ...steps[at], state: "stuck" };
    for (let i = at + 1; at >= 0 && i < steps.length; i++) if (steps[i].state === "now") steps[i] = { ...steps[i], state: "todo" };
  }
  // Only the first unfinished step is "now"; anything after it is still to come.
  const first = steps.findIndex((s) => s.state === "now" || s.state === "stuck");
  steps.forEach((s, i) => {
    if (first >= 0 && i > first && s.state === "now") s.state = "todo";
  });

  const done = steps.filter((s) => s.state === "done").length;
  const current = first >= 0 ? steps[first] : null;
  const tone: State = stopped ? "stuck" : current?.state ?? "done";
  const title = stopped ? "Stopped" : lead.status === "meeting" ? "Meeting booked" : current ? current.label : "All steps done";
  const text = stopped ?? (lead.status === "meeting" ? "This lead is done." : current ? current.detail : "Nothing left to do.");
  return { steps, done, tone, title, text, stopped: !!stopped };
}

const TAG: Record<State, string> = { done: "Done", now: "Now", todo: "To do", stuck: "Stuck" };
const POPOVER_ID = "lead-status";

/** Header button that opens the full progress window. */
export function LeadStatusButton(p: ProgressProps) {
  const { tone, title, done, steps } = progressOf(p);
  return (
    <button type="button" className={`lp-btn ${tone}`} popoverTarget={POPOVER_ID}>
      <span className="lp-btn-dot" aria-hidden="true" />
      Lead status
      <span className="lp-btn-sub">
        {title} · {done}/{steps.length}
      </span>
    </button>
  );
}

/** Slim "where it is now" strip under the header; clicking opens the same window. */
export function LeadNowStrip(p: ProgressProps) {
  const { tone, title, text, done, steps } = progressOf(p);
  return (
    <button type="button" className={`lp-strip ${tone}`} popoverTarget={POPOVER_ID}>
      <span className="lp-strip-icon" aria-hidden="true">
        {tone === "stuck" ? <Ban size={16} /> : <Check size={16} />}
      </span>
      <span className="lp-strip-text">
        <span className="lp-now-label">{tone === "stuck" ? (p.lead.status in STOPPED ? "Stopped" : "On hold") : "Where it is now"}</span>
        <b>
          {title}: <span>{text}</span>
        </b>
      </span>
      <span className="lp-strip-bar" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </span>
      <span className="lp-strip-more">
        {done}/{steps.length} steps · View all
      </span>
    </button>
  );
}

/** The window itself: a native popover, so it opens and closes without any client code. */
export function LeadStatusWindow(p: ProgressProps) {
  const { steps, done, tone, title, text } = progressOf(p);
  return (
    <div id={POPOVER_ID} popover="auto" className="lp-window">
      <div className="ld-panel-head">
        <span className={`dash-chip sm ${tone === "stuck" ? "red" : "orange"}`}>{tone === "stuck" ? <Ban size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}</span>
        <div className="ld-panel-title">
          <h2>Lead status</h2>
          <span>
            {p.lead.company} · {done} of {steps.length} steps done
          </span>
        </div>
        <button type="button" className="lp-close" popoverTarget={POPOVER_ID} popoverTargetAction="hide" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className={`lp-now ${tone}`}>
        <span className="lp-now-label">{title}</span>
        <p>{text}</p>
      </div>
      <div className="lp-bar" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="lp-steps">
        {steps.map((s, i) => (
          <li key={s.key} className={`lp-step ${s.state}`}>
            <span className="lp-dot" aria-hidden="true">
              {s.state === "done" ? <Check size={13} strokeWidth={3} /> : s.icon}
            </span>
            <div>
              <b>
                <span>
                  <em className="lp-num">{i + 1}.</em> {s.label}
                </span>
                <span className="lp-tag">{TAG[s.state]}</span>
              </b>
              <small>{s.detail}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
