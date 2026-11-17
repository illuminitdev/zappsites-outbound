"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Globe, Phone } from "lucide-react";
import { bookCall } from "@/app/actions";
import { Conversion } from "@/components/GoogleTag";
import { RedirectSoon } from "./RedirectSoon";
import { SubmitButton } from "@/components/SubmitButton";
import type { Slot } from "@/lib/booking/slots";
import s from "./book.module.css";

const toMins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Read a typed time: "14:30", "2:30pm", "2pm", "1430", "9.15", "10 am".
 * No am/pm and an hour of 1-7 means afternoon (nobody books a 3am call). Returns "HH:MM" or null.
 */
export function parseTime(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");
  const m = t.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (min > 59 || h > 23) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "p" && h !== 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  } else if (h >= 1 && h <= 7) h += 12;
  return `${pad(h)}:${pad(min)}`;
}

const DAYS_PER_PAGE = 5;

const fmt = (dayKey: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(new Date(`${dayKey}T12:00:00Z`));
const addMinutes = (hhmm: string, n: number) => {
  const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + n;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export interface BookingFlowProps {
  slots: Slot[];
  slotMinutes: number;
  initialDay?: string;
  leadSlug: string;
  base: string;
  prefill: { name: string; company: string; email: string; website: string };
  video: boolean;
  error?: string;
  brandName: string;
  brandUrl: string;
  adsLabel?: string;
  company?: string;
  contact: string;
}

/** Split-screen booking: who/what on the left with a live summary, one question at a time on the right. */
export function BookingFlow(p: BookingFlowProps) {
  const days = useMemo(() => [...new Set(p.slots.map((sl) => sl.dayKey))], [p.slots]);
  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const sl of p.slots) m.set(sl.dayKey, [...(m.get(sl.dayKey) ?? []), sl]);
    return m;
  }, [p.slots]);

  const firstDay = p.initialDay && days.includes(p.initialDay) ? p.initialDay : days[0];
  const [day, setDay] = useState<string | undefined>(firstDay);
  const [page, setPage] = useState(() => Math.max(0, Math.floor(days.indexOf(firstDay ?? "") / DAYS_PER_PAGE)));
  const daySlots = useMemo(() => (day ? (byDay.get(day) ?? []) : []), [byDay, day]);
  const [typed, setTyped] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const nativeTime = useRef<HTMLInputElement>(null);
  const [result, formAction] = useActionState(bookCall, null);
  const router = useRouter();
  const booked = result?.ok ? result : null;
  const bookError = result && !result.ok ? result.error : p.error;

  // A failed booking (e.g. someone just took the slot): refresh the open times from the server.
  useEffect(() => {
    if (result && !result.ok) router.refresh();
  }, [result, router]);
  const [screen, setScreen] = useState<"when" | "details">("when");

  const pages = Math.ceil(days.length / DAYS_PER_PAGE);
  const pageDays = days.slice(page * DAYS_PER_PAGE, page * DAYS_PER_PAGE + DAYS_PER_PAGE);

  // Typed time → open slot on the chosen day (or a reason it isn't one, plus the nearest free times).
  const wanted = typed.trim() ? parseTime(typed) : null;
  const chosen = wanted ? daySlots.find((sl) => sl.timeLabel === wanted) : undefined;
  const slot = chosen?.iso;
  let problem = "";
  let nearest: Slot[] = [];
  if (typed.trim() && !chosen && daySlots.length) {
    const first = daySlots[0].timeLabel;
    const last = daySlots[daySlots.length - 1].timeLabel;
    if (!wanted) problem = "Type a time like 10:30, 2pm or 14:45.";
    else {
      const w = toMins(wanted);
      problem =
        w < toMins(first) || w > toMins(last)
          ? `We're free between ${first} and ${last} that day.`
          : w % 15
            ? "Calls start on the quarter hour (:00, :15, :30 or :45)."
            : `Sorry, ${wanted} is already taken.`;
      nearest = [...daySlots]
        .sort((a, b) => Math.abs(toMins(a.timeLabel) - w) - Math.abs(toMins(b.timeLabel) - w))
        .slice(0, 3)
        .sort((a, b) => toMins(a.timeLabel) - toMins(b.timeLabel));
    }
  }

  const pickDay = (d: string) => {
    setDay(d);
    setPage(Math.floor(days.indexOf(d) / DAYS_PER_PAGE));
    setCalOpen(false);
  };

  // Clock button opens the browser's own time picker (hidden native <input type="time">).
  const openPicker = () => {
    const el = nativeTime.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };

  const whenText = chosen ? `${fmt(chosen.dayKey, { weekday: "long", day: "numeric", month: "long" })}` : day ? fmt(day, { weekday: "long", day: "numeric", month: "long" }) : "Pick a day";
  const timeText = chosen ? `${chosen.timeLabel} – ${addMinutes(chosen.timeLabel, p.slotMinutes)} (UK time)` : "Type a time";

  return (
    <div className={s.split}>
      {/* ---------- Left: who, what, live summary ---------- */}
      <aside className={s.side}>
        <a href={p.brandUrl} className={s.sideLogo}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zappsites-logo-light.png" alt={p.brandName} />
        </a>

        <h2 className={s.sideTitle}>Free {p.slotMinutes}-minute website call</h2>
        <ul className={s.meta}>
          <li>
            <Clock size={16} aria-hidden="true" /> {p.slotMinutes} minutes
          </li>
          <li>
            <Phone size={16} aria-hidden="true" /> {p.video ? "Phone or video" : "Phone call"}
          </li>
          <li>
            <Globe size={16} aria-hidden="true" /> UK time
          </li>
        </ul>

        <ul className={s.covers}>
          <li>
            <Check size={16} aria-hidden="true" />
            {p.company ? `What your website check found for ${p.company}` : "A quick look at your website"}
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            The 2–3 fixes that would bring you more enquiries
          </li>
          <li>
            <Check size={16} aria-hidden="true" />
            No hard sell. You decide what happens next
          </li>
        </ul>

        <div className={s.summary}>
          <span className={s.summaryHead}>Your call</span>
          <p className={day ? undefined : s.summaryEmpty}>
            <CalendarDays size={16} aria-hidden="true" /> {whenText}
          </p>
          <p className={chosen ? undefined : s.summaryEmpty}>
            <Clock size={16} aria-hidden="true" /> {timeText}
          </p>
        </div>

        <p className={s.sideFoot}>{p.contact}</p>
      </aside>

      {/* ---------- Right: one question at a time ---------- */}
      <form action={formAction} className={s.main}>
        <input type="hidden" name="lead" value={p.leadSlug} />
        <input type="hidden" name="back" value={p.base} />
        <input type="hidden" name="slot" value={slot ?? ""} />

        <div className={s.mainInner}>
          {bookError && !booked && <div className={s.error} role="alert">{bookError}</div>}

          {/* Screen 1: when */}
          <section hidden={screen !== "when"} className={s.screen}>
            <span className={s.kicker}>Step 1 of 2</span>
            <h1 className={s.h1}>When works for you?</h1>

            {days.length === 0 ? (
              <p className={s.muted}>No times are open right now. Email {p.contact.split(" · ").at(-1)} and we&apos;ll find one.</p>
            ) : (
              <>
                <div className={s.rowHead}>
                  <span className={s.label}>Pick a date</span>
                  <button type="button" className={s.calBtn} onClick={() => setCalOpen(!calOpen)} aria-expanded={calOpen}>
                    <CalendarDays size={16} aria-hidden="true" /> {calOpen ? "Close calendar" : "Full calendar"}
                  </button>
                </div>
                <div className={s.dateArea}>
                  <div className={s.dayBar}>
                    <button type="button" className={s.arrow} disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Earlier days">
                      <ChevronLeft size={18} />
                    </button>
                    <div className={s.days}>
                      {pageDays.map((d) => (
                        <button key={d} type="button" className={`${s.day} ${d === day ? s.dayOn : ""}`} onClick={() => pickDay(d)} aria-pressed={d === day}>
                          <span>{fmt(d, { weekday: "short" })}</span>
                          <b>{fmt(d, { day: "numeric" })}</b>
                          <span>{fmt(d, { month: "short" })}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" className={s.arrow} disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Later days">
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  {calOpen && <MonthPicker available={days} selected={day} onPick={pickDay} />}
                </div>

                {day && daySlots.length > 0 && (
                  <div className={s.timeArea}>
                    <label className={s.label} htmlFor="free-time">
                      What time are you free on {fmt(day, { weekday: "long", day: "numeric", month: "short" })}?
                    </label>
                    <div className={s.timeWrap}>
                    <div className={`${s.timeField} ${chosen ? s.timeFieldOk : problem ? s.timeFieldBad : ""}`}>
                      <button type="button" className={s.clockBtn} onClick={openPicker} aria-label="Open time picker" title="Open time picker">
                        <Clock size={20} aria-hidden="true" />
                      </button>
                      <input
                        ref={nativeTime}
                        type="time"
                        className={s.nativeTime}
                        step={900}
                        min={daySlots[0].timeLabel}
                        max={daySlots[daySlots.length - 1].timeLabel}
                        value={wanted ?? ""}
                        onChange={(e) => e.target.value && setTyped(e.target.value)}
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                      <input
                        id="free-time"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder="e.g. 2:30pm or 14:30"
                        inputMode="text"
                        autoComplete="off"
                        aria-describedby="free-time-help"
                      />
                      {chosen && <Check size={20} className={s.okIcon} aria-hidden="true" />}
                    </div>
                    </div>
                    <p id="free-time-help" className={s.hint} role="status">
                      {chosen ? (
                        <b className={s.okText}>
                          {chosen.timeLabel} is free. Press Continue.
                        </b>
                      ) : problem ? (
                        <>
                          <b className={s.badText}>{problem}</b>
                          {nearest.length > 0 && (
                            <span className={s.suggest}>
                              Try:
                              {nearest.map((sl) => (
                                <button key={sl.iso} type="button" onClick={() => setTyped(sl.timeLabel)}>
                                  {sl.timeLabel}
                                </button>
                              ))}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          Open {daySlots[0].timeLabel} to {daySlots[daySlots.length - 1].timeLabel} (UK time). Calls start every 15 minutes.
                        </>
                      )}
                    </p>
                  </div>
                )}
              </>
            )}

            <div className={s.actions}>
              <span className={s.muted}>{chosen ? `${fmt(chosen.dayKey, { weekday: "short", day: "numeric", month: "short" })} at ${chosen.timeLabel}` : "Type a time to continue"}</span>
              <button type="button" className={s.primary} disabled={!chosen} onClick={() => setScreen("details")}>
                Continue <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </section>

          {/* Screen 2: details (always mounted so typed values survive going back) */}
          <section hidden={screen !== "details"} className={s.screen}>
            <button type="button" className={s.back} onClick={() => setScreen("when")}>
              <ArrowLeft size={16} aria-hidden="true" /> Change time
            </button>
            <span className={s.kicker}>Step 2 of 2</span>
            <h1 className={s.h1}>Your details</h1>
            <p className={s.muted}>So we know who we&apos;re speaking to, and where to send the invite.</p>

            <div className={s.grid2}>
              <label className={s.field}>
                <span>Your name</span>
                <input name="name" required defaultValue={p.prefill.name} autoComplete="name" placeholder="Jane Smith" />
              </label>
              <label className={s.field}>
                <span>Company</span>
                <input name="company" required defaultValue={p.prefill.company} autoComplete="organization" placeholder="Your business" />
              </label>
              <label className={s.field}>
                <span>Email</span>
                <input name="email" type="email" required defaultValue={p.prefill.email} autoComplete="email" placeholder="you@company.com" />
              </label>
              <label className={s.field}>
                <span>
                  Phone <i>optional</i>
                </span>
                <input name="phone" type="tel" autoComplete="tel" placeholder="07..." />
              </label>
            </div>
            <label className={s.field}>
              <span>
                Website <i>if you have one</i>
              </span>
              <input name="website" type="text" inputMode="url" defaultValue={p.prefill.website} autoComplete="url" placeholder="yourbusiness.co.uk" />
            </label>

            {p.video ? (
              <div className={s.methods}>
                <label>
                  <input type="radio" name="method" value="phone" defaultChecked /> Call my phone
                </label>
                <label>
                  <input type="radio" name="method" value="video" /> Video call
                </label>
              </div>
            ) : (
              <input type="hidden" name="method" value="phone" />
            )}

            <label className={s.field}>
              <span>
                Anything we should look at first? <i>optional</i>
              </span>
              <textarea name="note" rows={2} />
            </label>

            <SubmitButton className={s.confirm} pending="Booking...">
              Confirm {chosen ? `${fmt(chosen.dayKey, { weekday: "short", day: "numeric", month: "short" })}, ${chosen.timeLabel}` : "my call"}
            </SubmitButton>
            <p className={s.fine}>You&apos;ll get a confirmation email with a calendar invite straight away.</p>
          </section>
        </div>
      </form>

      {/* Booked: confirmation popup over the page, then off to the main website. */}
      {booked && chosen && (
        <div className={s.overlay}>
          <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="booked-title">
            <div className={s.tick} aria-hidden="true">
              <Check size={30} strokeWidth={3} />
            </div>
            <h2 id="booked-title">You&apos;re booked, {booked.name.split(/\s+/)[0]}!</h2>
            <p className={s.modalWhen}>
              {fmt(chosen.dayKey, { weekday: "long", day: "numeric", month: "long" })} at {chosen.timeLabel} (UK time)
            </p>
            <p className={s.modalText}>
              A confirmation email is on its way to <b>{booked.email}</b>.{" "}
              <a href={`/api/public/ics/${booked.id}`}>Add to calendar</a>
            </p>
            <div className={s.modalFoot}>
              <RedirectSoon to={p.brandUrl} seconds={5} label={p.brandUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} />
            </div>
          </div>
          <Conversion label={p.adsLabel} event="call_booked" />
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month view of open days, for picking a date beyond the 5-day strip. */
function MonthPicker({ available, selected, onPick }: { available: string[]; selected?: string; onPick: (d: string) => void }) {
  const open = useMemo(() => new Set(available), [available]);
  const months = useMemo(() => [...new Set(available.map((d) => d.slice(0, 7)))].sort(), [available]);
  const [shown, setShown] = useState(() => (selected && months.includes(selected.slice(0, 7)) ? selected.slice(0, 7) : months[0]));
  const [y, m] = shown.split("-").map(Number);
  const idx = months.indexOf(shown);
  const blanks = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return (
    <div className={s.month} role="dialog" aria-label="Choose a date">
      <div className={s.monthHead}>
        <button type="button" className={s.arrow} disabled={idx <= 0} onClick={() => setShown(months[idx - 1])} aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <b>{title}</b>
        <button type="button" className={s.arrow} disabled={idx >= months.length - 1} onClick={() => setShown(months[idx + 1])} aria-label="Next month">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className={s.monthGrid}>
        {WEEKDAYS.map((w) => (
          <span key={w} className={s.wd}>
            {w}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const key = `${shown}-${pad(i + 1)}`;
          return open.has(key) ? (
            <button key={key} type="button" className={`${s.md} ${key === selected ? s.mdOn : ""}`} onClick={() => onPick(key)} aria-pressed={key === selected}>
              {i + 1}
            </button>
          ) : (
            <span key={key} className={`${s.md} ${s.mdOff}`}>
              {i + 1}
            </span>
          );
        })}
      </div>
    </div>
  );
}

