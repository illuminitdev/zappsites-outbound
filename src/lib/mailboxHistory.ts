// Day-by-day sending history per mailbox, built from the messages table
// (sent emails by sent_at, failed ones by scheduled_for, replies by received_at).

import { db } from "@/lib/db";

export const HISTORY_TZ = "Europe/London";
export const HISTORY_DAYS = 30;

export interface HistoryMessage {
  lead_id?: string | null;
  mailbox_id: string | null;
  direction: "out" | "in";
  status: string;
  sent_at: string | null;
  scheduled_for: string | null;
  received_at: string | null;
}

export interface MailboxDay {
  mailboxId: string;
  sent: number;
  failed: number;
  replies: number;
  first: string | null; // ISO time of the first email sent that day
  last: string | null; // ISO time of the last email sent that day
}

export interface HistoryDay {
  day: string; // YYYY-MM-DD in HISTORY_TZ
  sent: number;
  failed: number;
  replies: number;
  first: string | null;
  last: string | null;
  mailboxes: MailboxDay[];
}

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: HISTORY_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Which event (if any) a message counts as, and when it happened. */
function classify(m: HistoryMessage): { kind: "sent" | "failed" | "replies"; at: string } | null {
  if (m.direction === "out" && m.status === "sent" && m.sent_at) return { kind: "sent", at: m.sent_at };
  if (m.direction === "out" && m.status === "failed" && m.scheduled_for) return { kind: "failed", at: m.scheduled_for };
  if (m.direction === "in" && m.received_at) return { kind: "replies", at: m.received_at };
  return null;
}

const earlier = (a: string | null, b: string) => (!a || b < a ? b : a);
const later = (a: string | null, b: string) => (!a || b > a ? b : a);

/** Group messages into days (newest first), each split by mailbox (busiest first). */
export function buildHistory(messages: HistoryMessage[]): HistoryDay[] {
  const days = new Map<string, Map<string, MailboxDay>>();
  for (const m of messages) {
    const ev = classify(m);
    if (!ev || !m.mailbox_id) continue;
    const day = dayKey.format(new Date(ev.at));
    const boxes = days.get(day) ?? new Map<string, MailboxDay>();
    days.set(day, boxes);
    const box = boxes.get(m.mailbox_id) ?? { mailboxId: m.mailbox_id, sent: 0, failed: 0, replies: 0, first: null, last: null };
    boxes.set(m.mailbox_id, box);
    box[ev.kind]++;
    if (ev.kind === "sent") {
      box.first = earlier(box.first, ev.at);
      box.last = later(box.last, ev.at);
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, boxes]) => {
      const list = [...boxes.values()].sort((a, b) => b.sent - a.sent || b.replies - a.replies);
      return {
        day,
        sent: list.reduce((n, b) => n + b.sent, 0),
        failed: list.reduce((n, b) => n + b.failed, 0),
        replies: list.reduce((n, b) => n + b.replies, 0),
        first: list.reduce<string | null>((t, b) => (b.first ? earlier(t, b.first) : t), null),
        last: list.reduce<string | null>((t, b) => (b.last ? later(t, b.last) : t), null),
        mailboxes: list,
      };
    });
}

/** The last HISTORY_DAYS (+1) days of sends, failures and replies, raw (paged, so large volumes still load). */
async function fetchHistoryRows(since = new Date(Date.now() - (HISTORY_DAYS + 1) * 86400_000).toISOString()): Promise<HistoryMessage[]> {
  const cols = "lead_id, mailbox_id, direction, status, sent_at, scheduled_for, received_at";
  const rows: HistoryMessage[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("messages")
      .select(cols)
      .not("mailbox_id", "is", null)
      .or(`sent_at.gte.${since},received_at.gte.${since},and(status.eq.failed,scheduled_for.gte.${since})`)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("mailbox history failed:", error.message);
      break;
    }
    rows.push(...((data ?? []) as HistoryMessage[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const cutoffDay = () => dayKey.format(new Date(Date.now() - (HISTORY_DAYS - 1) * 86400_000));

/** YYYY-MM-DD (in HISTORY_TZ) for today minus `back` days. */
export const londonDay = (back = 0) => dayKey.format(new Date(Date.now() - back * 86400_000));

/** Load the last HISTORY_DAYS days of sends, failures and replies, grouped by day and mailbox. */
export async function loadMailboxHistory(): Promise<HistoryDay[]> {
  const cutoff = cutoffDay();
  return buildHistory(await fetchHistoryRows()).filter((d) => d.day >= cutoff);
}

export type SendKind = "sent" | "failed" | "replied";

/** One lead's send / fail / reply event on a day: what the Leads page "Sent on" filter is built from. */
export interface SendRow {
  leadId: string;
  mailboxId: string;
  kind: SendKind;
  day: string; // YYYY-MM-DD in HISTORY_TZ
}

/**
 * Every sent / failed email and every reply as (lead, mailbox, kind, day): the last HISTORY_DAYS days,
 * or from `fromDay` (YYYY-MM-DD) if that's earlier, e.g. a date picked in the Leads calendar.
 */
export async function loadSendRows(fromDay?: string): Promise<SendRow[]> {
  const cutoff = fromDay && fromDay < cutoffDay() ? fromDay : cutoffDay();
  const since = new Date(new Date(`${cutoff}T00:00:00Z`).getTime() - 86400_000).toISOString();
  const out: SendRow[] = [];
  for (const m of await fetchHistoryRows(since)) {
    const ev = classify(m);
    if (!ev || !m.lead_id || !m.mailbox_id) continue;
    const day = dayKey.format(new Date(ev.at));
    const kind: SendKind = ev.kind === "replies" ? "replied" : ev.kind;
    if (day >= cutoff) out.push({ leadId: m.lead_id, mailboxId: m.mailbox_id, kind, day });
  }
  return out;
}

/** Leads-page link for "leads sent / failed / replied on this day", optionally from one mailbox. */
export function sentLeadsHref(kind: SendKind, day: string, mailboxId?: string) {
  const u = new URLSearchParams({ sent: `${kind}:${day}` });
  if (mailboxId) u.set("mailbox", mailboxId);
  return `/leads?${u}`;
}
