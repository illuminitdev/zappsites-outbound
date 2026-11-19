import Link from "next/link";
import { History } from "lucide-react";
import { Empty } from "@/components/ui";
import { HISTORY_DAYS, HISTORY_TZ, sentLeadsHref, type HistoryDay } from "@/lib/mailboxHistory";

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: HISTORY_TZ, ...o }).format(new Date(iso));
const time = (iso: string | null) => (iso ? fmt(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "–");
const dayLabel = (day: string) => fmt(`${day}T12:00:00Z`, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const range = (a: string | null, b: string | null) => (a && b ? (time(a) === time(b) ? time(a) : `${time(a)} – ${time(b)}`) : "–");

/** Day-by-day send history: one block per day, a row per mailbox. Server-rendered inside the History dialog. */
export function MailboxHistory({ days, emails }: { days: HistoryDay[]; emails: Record<string, string> }) {
  if (days.length === 0) {
    return (
      <Empty icon={History} title="No sending history yet">
        Emails sent in the last {HISTORY_DAYS} days will show up here, day by day.
      </Empty>
    );
  }
  const totalSent = days.reduce((n, d) => n + d.sent, 0);
  const activeDays = days.filter((d) => d.sent > 0).length;
  const totalReplies = days.reduce((n, d) => n + d.replies, 0);
  const totalFailed = days.reduce((n, d) => n + d.failed, 0);
  const best = days.reduce((a, d) => (d.sent > a.sent ? d : a), days[0]);

  return (
    <div className="hist">
      <div className="hist-summary">
        <div>
          <b>{totalSent}</b>
          <span>Sent · last {HISTORY_DAYS} days</span>
        </div>
        <div>
          <b>{activeDays ? Math.round(totalSent / activeDays) : 0}</b>
          <span>Avg per sending day</span>
        </div>
        <div>
          <b>{best.sent}</b>
          <span>Busiest day{best.sent ? ` · ${dayLabel(best.day)}` : ""}</span>
        </div>
        <div>
          <b>{totalReplies}</b>
          <span>
            Replies{totalSent ? ` · ${((totalReplies / totalSent) * 100).toFixed(1)}%` : ""}
            {totalFailed ? ` · ${totalFailed} failed` : ""}
          </span>
        </div>
      </div>

      {days.map((d) => (
        <section key={d.day} className="hist-day">
          <header className="hist-day-head">
            <b>{dayLabel(d.day)}</b>
            <span className="muted small">
              {d.sent ? (
                <Link href={sentLeadsHref("sent", d.day)} className="hist-link" title="Show these leads">
                  {d.sent} sent
                </Link>
              ) : (
                "0 sent"
              )}
              {d.failed ? (
                <>
                  {" · "}
                  <Link href={sentLeadsHref("failed", d.day)} className="hist-link bad" title="Show these leads">
                    {d.failed} failed
                  </Link>
                </>
              ) : null}
              {d.replies ? (
                <>
                  {" · "}
                  <Link href={sentLeadsHref("replied", d.day)} className="hist-link" title="Show these leads">
                    {d.replies} repl{d.replies === 1 ? "y" : "ies"}
                  </Link>
                </>
              ) : null}
              {d.sent ? ` · ${range(d.first, d.last)}` : ""}
            </span>
          </header>
          <table className="plain hist-table">
            <thead>
              <tr>
                <th>Mailbox</th>
                <th className="num">Sent</th>
                <th className="num">Failed</th>
                <th className="num">Replies</th>
                <th>Sending time</th>
              </tr>
            </thead>
            <tbody>
              {d.mailboxes.map((m) => (
                <tr key={m.mailboxId}>
                  <td>{emails[m.mailboxId] ?? "Removed mailbox"}</td>
                  <td className="num">
                    {m.sent ? (
                      <Link href={sentLeadsHref("sent", d.day, m.mailboxId)} className="hist-num" title="Show the leads sent to">
                        {m.sent}
                      </Link>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td className="num">
                    {m.failed ? (
                      <Link href={sentLeadsHref("failed", d.day, m.mailboxId)} className="hist-num bad" title="Show the leads that failed">
                        {m.failed}
                      </Link>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td className="num">
                    {m.replies ? (
                      <Link href={sentLeadsHref("replied", d.day, m.mailboxId)} className="hist-num" title="Show the leads that replied">
                        {m.replies}
                      </Link>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td className="muted">{range(m.first, m.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
