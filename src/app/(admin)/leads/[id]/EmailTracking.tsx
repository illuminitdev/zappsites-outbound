import { CalendarCheck, Eye, FileText, MailOpen } from "lucide-react";
import { fmt } from "@/components/ui";

export interface TrackEvent {
  type: string;
  created_at: string;
  meta: { message_id?: string } | null;
}

export interface EmailStats {
  tracked: boolean;
  opens: number;
  firstOpen: string | null;
  lastOpen: string | null;
  views: number;
  clicks: number;
  lastClick: string | null;
}

/** Opens, report views and booking clicks for each sent email, from the events that carry its id. */
export function statsByEmail(events: TrackEvent[]): Map<string, EmailStats> {
  const out = new Map<string, EmailStats>();
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { tracked: false, opens: 0, firstOpen: null, lastOpen: null, views: 0, clicks: 0, lastClick: null }));
    return s;
  };
  for (const e of [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const id = e.meta?.message_id;
    if (!id) continue;
    const s = get(id);
    if (e.type === "email_sent") s.tracked = true;
    if (e.type === "email_open") {
      s.opens++;
      s.firstOpen ??= e.created_at;
      s.lastOpen = e.created_at;
    }
    if (e.type === "page_view") s.views++;
    if (e.type === "booking_click") {
      s.clicks++;
      s.lastClick = e.created_at;
    }
  }
  return out;
}

const n = (x: number, one: string) => `${x} ${one}${x === 1 ? "" : "s"}`;

/** Three small status chips for one sent email: opened, viewed report, clicked "Book a call". */
export function EmailTrackChips({ s }: { s: EmailStats | undefined }) {
  // A report view or click proves the email was opened, even if the image was blocked.
  const opened = !!s && (s.opens > 0 || s.views > 0 || s.clicks > 0);
  if (!s?.tracked && !opened) {
    return <span className="et-chips"><span className="et-chip muted">Sent before tracking</span></span>;
  }
  return (
    <span className="et-chips">
      <span className={`et-chip ${opened ? "good" : "muted"}`} title={s?.firstOpen ? `First opened ${fmt(s.firstOpen)}` : undefined}>
        <MailOpen size={13} aria-hidden="true" />
        {opened ? (s!.opens > 1 ? `Opened ×${s!.opens}` : "Opened") : "Not opened"}
        {s?.lastOpen ? <em>{fmt(s.lastOpen)}</em> : null}
      </span>
      <span className={`et-chip ${s?.views ? "good" : "muted"}`}>
        <FileText size={13} aria-hidden="true" />
        {s?.views ? `Viewed report${s.views > 1 ? ` ×${s.views}` : ""}` : "Report not viewed"}
      </span>
      <span className={`et-chip ${s?.clicks ? "hot" : "muted"}`} title={s?.lastClick ? fmt(s.lastClick) : undefined}>
        <CalendarCheck size={13} aria-hidden="true" />
        {s?.clicks ? `Clicked Book a call${s.clicks > 1 ? ` ×${s.clicks}` : ""}` : "No booking click"}
      </span>
    </span>
  );
}

/** Lead-wide totals across every email, for the panel header. */
export function TrackingSummary({ stats, sentCount }: { stats: Map<string, EmailStats>; sentCount: number }) {
  const all = [...stats.values()];
  const opened = all.filter((s) => s.opens || s.views || s.clicks).length;
  const views = all.reduce((t, s) => t + s.views, 0);
  const clicks = all.reduce((t, s) => t + s.clicks, 0);
  return (
    <div className="et-summary">
      <span>
        <Eye size={14} aria-hidden="true" /> {opened} of {sentCount} opened
      </span>
      <span>
        <FileText size={14} aria-hidden="true" /> {n(views, "report view")}
      </span>
      <span className={clicks ? "hot" : ""}>
        <CalendarCheck size={14} aria-hidden="true" /> {n(clicks, "booking click")}
      </span>
    </div>
  );
}
