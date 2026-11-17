import Link from "next/link";
import { CalendarCheck, ExternalLink } from "lucide-react";
import { cancelBooking, deleteBooking } from "@/app/actions";
import { ConfirmForm } from "@/components/ConfirmForm";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash } from "@/components/ui";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Booking = {
  id: string;
  lead_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  website?: string | null;
  method: string;
  note: string | null;
  start_at: string;
  status: string;
  created_at: string;
};

const TZ = "Europe/London";
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).format(new Date(d));

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default async function Bookings({ searchParams }: { searchParams: Promise<{ tab?: string; msg?: string }> }) {
  const { tab: rawTab, msg } = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : "upcoming";
  const now = new Date().toISOString();
  const head = { count: "exact" as const, head: true };

  let q = db().from("bookings").select("*");
  if (tab === "upcoming") q = q.eq("status", "confirmed").gte("start_at", now).order("start_at");
  else if (tab === "past") q = q.eq("status", "confirmed").lt("start_at", now).order("start_at", { ascending: false });
  else q = q.eq("status", "cancelled").order("start_at", { ascending: false });

  const [res, up, past, cancelled] = await Promise.all([
    q.limit(200),
    db().from("bookings").select("id", head).eq("status", "confirmed").gte("start_at", now),
    db().from("bookings").select("id", head).eq("status", "confirmed").lt("start_at", now),
    db().from("bookings").select("id", head).eq("status", "cancelled"),
  ]);
  const missing = !!res.error;
  const rows = (res.data ?? []) as Booking[];
  const counts: Record<Tab, number> = { upcoming: up.count ?? 0, past: past.count ?? 0, cancelled: cancelled.count ?? 0 };

  return (
    <>
      <section className="dash-hero">
        <div>
          <h1>Bookings</h1>
          <p>Everyone who booked a call through your booking page. Times are UK time.</p>
        </div>
        <div className="head-actions">
          <a href="/book" target="_blank" rel="noreferrer" className="btn-link btn-outline">
            <ExternalLink size={14} aria-hidden="true" /> Open booking page
          </a>
        </div>
      </section>
      <Flash msg={msg} />

      <nav className="bk-tabs">
        {TABS.map((t) => (
          <Link key={t.id} href={`/bookings?tab=${t.id}`} className={t.id === tab ? "on" : undefined}>
            {t.label} <span>{counts[t.id]}</span>
          </Link>
        ))}
      </nav>

      <div className="card table-card">
        {missing ? (
          <p className="muted small" style={{ padding: 18 }}>
            Bookings aren&apos;t set up yet. Run the database migrations (see Settings).
          </p>
        ) : rows.length === 0 ? (
          <Empty icon={CalendarCheck} title={tab === "upcoming" ? "No upcoming calls" : tab === "past" ? "No past calls yet" : "No cancelled calls"}>
            {tab === "upcoming" ? "When someone books through /book, they show up here." : null}
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Contact</th>
                  <th>Call type</th>
                  <th>Note</th>
                  <th>Booked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <b>{fmt(b.start_at, { weekday: "short", day: "numeric", month: "short" })}</b>
                      <div className="muted small">{fmt(b.start_at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</div>
                    </td>
                    <td>
                      <b>{b.name}</b>
                      <div className="muted small">
                        {b.lead_id ? <Link href={`/leads/${b.lead_id}`}>{b.company ?? "View lead"}</Link> : (b.company ?? "")}
                      </div>
                      {b.website && (
                        <div className="small">
                          <a href={b.website} target="_blank" rel="noreferrer">
                            {b.website.replace(/^https?:\/\//, "")}
                          </a>
                        </div>
                      )}
                    </td>
                    <td>
                      <a href={`mailto:${b.email}`}>{b.email}</a>
                      {b.phone && (
                        <div className="small">
                          <a href={`tel:${b.phone}`}>{b.phone}</a>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="pill info">{b.method === "video" ? "Video" : "Phone"}</span>
                    </td>
                    <td className="small" style={{ maxWidth: 280 }}>
                      {b.note ?? <span className="muted">-</span>}
                    </td>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {fmt(b.created_at, { day: "numeric", month: "short" })}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        {tab === "upcoming" && (
                          <form action={cancelBooking}>
                            <input type="hidden" name="id" value={b.id} />
                            <SubmitButton className="secondary sm" pending="Cancelling...">
                              Cancel
                            </SubmitButton>
                          </form>
                        )}
                        <ConfirmForm action={deleteBooking} message={`Delete the booking for ${b.name} permanently? This can't be undone.`}>
                          <input type="hidden" name="id" value={b.id} />
                          <SubmitButton className="secondary sm danger" pending="Deleting...">
                            Delete
                          </SubmitButton>
                        </ConfirmForm>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
