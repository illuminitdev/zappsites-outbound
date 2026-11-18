import { CalendarCheck, Clock, FileText, MailOpen, MessagesSquare, PenLine, Send, TriangleAlert } from "lucide-react";
import { fmt } from "@/components/ui";
import { db } from "@/lib/db";
import { isScannerHit } from "@/lib/tracking";

/** How far each lead's emails have got, furthest step wins: replied > clicked > viewed > opened > sent > scheduled > draft. */
export interface LeadEmailStatus {
  label: string;
  tone: "hot" | "good" | "info" | "muted" | "bad";
  detail: string;
  icon: "replied" | "clicked" | "viewed" | "opened" | "sent" | "scheduled" | "draft" | "failed";
  /** They opened their audit report (after we emailed it; scanners and our own previews don't count). */
  reportViewed: boolean;
}

type Msg = { lead_id: string; direction: string; status: string; sent_at: string | null; scheduled_for: string | null; received_at: string | null };
type Ev = { lead_id: string; type: string; created_at: string };

/** Every row of a query, 1000 at a time (the database returns at most 1000 per request). */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await page(from, from + 999);
    if (r.error || !Array.isArray(r.data)) break;
    out.push(...(r.data as T[]));
    if (r.data.length < 1000) break;
  }
  return out;
}

/** Email status per lead. Pass the lead ids, or null for every lead (used by the list filters). */
export async function emailStatuses(leadIds: string[] | null): Promise<Map<string, LeadEmailStatus>> {
  const out = new Map<string, LeadEmailStatus>();
  if (leadIds && !leadIds.length) return out;
  const [msgs, evs] = await Promise.all([
    fetchAll<Msg>((from, to) => {
      let q = db().from("messages").select("lead_id,direction,status,sent_at,scheduled_for,received_at").neq("status", "cancelled");
      if (leadIds) q = q.in("lead_id", leadIds);
      return q.order("id").range(from, to);
    }),
    fetchAll<Ev>((from, to) => {
      let q = db().from("events").select("lead_id,type,created_at").in("type", ["email_open", "page_view", "booking_click", "report_sent"]);
      if (leadIds) q = q.in("lead_id", leadIds);
      return q.order("id").range(from, to);
    }),
  ]);

  const ids = leadIds ?? [...new Set([...msgs.map((m) => m.lead_id), ...evs.map((e) => e.lead_id)])];
  for (const id of ids) {
    const m = msgs.filter((x) => x.lead_id === id);
    const outM = m.filter((x) => x.direction === "out");
    const sent = outM.filter((x) => x.status === "sent").sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""));
    const scheduled = outM.filter((x) => x.status === "scheduled").sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
    const drafts = outM.filter((x) => x.status === "draft");
    const failed = outM.filter((x) => x.status === "failed");
    const replies = m.filter((x) => x.direction === "in");
    const e = evs.filter((x) => x.lead_id === id);
    const reportSentAt = e.filter((x) => x.type === "report_sent").map((x) => x.created_at).sort()[0] ?? null;
    const firstSent = [sent[0]?.sent_at, reportSentAt].filter((x): x is string => !!x).sort()[0] ?? null;
    // Only count report views after the first email went out (earlier ones were us previewing it).
    // and ignore mail scanners, which open every link within seconds of an email arriving.
    const sentAts = [...sent.map((x) => x.sent_at), reportSentAt];
    const after = (x: Ev) => (!firstSent || x.created_at >= firstSent) && !isScannerHit(x.created_at, sentAts);
    const opens = e.filter((x) => x.type === "email_open" && !isScannerHit(x.created_at, sentAts));
    const views = e.filter((x) => x.type === "page_view" && after(x));
    const clicks = e.filter((x) => x.type === "booking_click" && after(x));
    const last = (xs: { created_at: string }[]) => xs.map((x) => x.created_at).sort().at(-1) ?? null;
    const progress = `${sent.length} of ${outM.length} sent`;

    let s: Omit<LeadEmailStatus, "reportViewed"> | null = null;
    if (replies.length) s = { label: "Replied", tone: "hot", icon: "replied", detail: fmt(replies.map((r) => r.received_at ?? "").sort().at(-1)) };
    else if (clicks.length && sent.length) s = { label: "Clicked Book a call", tone: "hot", icon: "clicked", detail: `${progress} · ${fmt(last(clicks))}` };
    else if (views.length && sent.length) s = { label: `Viewed report${views.length > 1 ? ` ×${views.length}` : ""}`, tone: "good", icon: "viewed", detail: `${progress} · ${fmt(last(views))}` };
    else if (opens.length) s = { label: `Opened${opens.length > 1 ? ` ×${opens.length}` : ""}`, tone: "good", icon: "opened", detail: `${progress} · ${fmt(last(opens))}` };
    else if (sent.length)
      s = {
        label: "Sent",
        tone: "info",
        icon: "sent",
        detail: `${progress} · last ${fmt(sent.at(-1)!.sent_at)}${scheduled[0]?.scheduled_for ? ` · next ${fmt(scheduled[0].scheduled_for)}` : ""}`,
      };
    else if (failed.length) s = { label: "Failed to send", tone: "bad", icon: "failed", detail: `${failed.length} email${failed.length === 1 ? "" : "s"}` };
    else if (scheduled.length) s = { label: "Scheduled", tone: "muted", icon: "scheduled", detail: `First email ${fmt(scheduled[0].scheduled_for)}` };
    else if (drafts.length) s = { label: "Not sent yet", tone: "muted", icon: "draft", detail: `${drafts.length} written, waiting to be approved` };
    else if (reportSentAt) s = { label: views.length ? "Viewed report" : "Report email sent", tone: views.length ? "good" : "info", icon: views.length ? "viewed" : "sent", detail: fmt(views.length ? last(views) : reportSentAt) };
    if (s) out.set(id, { ...s, reportViewed: !!firstSent && views.length > 0 });
  }
  return out;
}

const ICONS = { replied: MessagesSquare, clicked: CalendarCheck, viewed: FileText, opened: MailOpen, sent: Send, scheduled: Clock, draft: PenLine, failed: TriangleAlert };

export function EmailStatusCell({ s }: { s: LeadEmailStatus | undefined }) {
  if (!s) return <span className="muted">–</span>;
  const Icon = ICONS[s.icon];
  return (
    <div className="lc-email-status">
      <span className={`es-pill ${s.tone}`}>
        <Icon size={13} aria-hidden="true" />
        {s.label}
      </span>
      <div className="muted small">{s.detail}</div>
    </div>
  );
}
