import { bookCall } from "@/app/actions";
import { GoogleTag } from "@/components/GoogleTag";
import { openSlots, videoUrl } from "@/lib/booking";
import { brand } from "@/lib/brand";
import type { Lead } from "@/lib/types";
import s from "./book.module.css";
import { SubmitButton } from "@/components/SubmitButton";
import { BookHeader } from "./BookHeader";
import { BookCalendar } from "./BookCalendar";

/** Shared booking page: /book (anyone) and /book/<lead slug> (prefilled from the audit). */
export async function BookingPage({ lead, day, month, error, base }: { lead: Lead | null; day?: string; month?: string; error?: string; base: string }) {
  const { slots, availability } = await openSlots();
  const days = [...new Map(slots.map((sl) => [sl.dayKey, sl.dayLabel])).entries()];
  // A chosen day wins; otherwise, when paging months, pre-select that month's first open day.
  const selectedDay = days.find(([k]) => k === day)?.[0] ?? (month ? days.find(([k]) => k.startsWith(month))?.[0] : undefined) ?? days[0]?.[0];
  const selectedLabel = selectedDay
    ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${selectedDay}T12:00:00Z`))
    : "";
  const daySlots = slots.filter((sl) => sl.dayKey === selectedDay);
  const video = videoUrl();
  const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ");

  return (
    <div className={s.page}>
      <BookHeader />
      <div className={s.wrap}>
        <h1 className={s.title}>Book a free 15-minute call</h1>
        <p className={s.lede}>
          With {brand.person} at {brand.name}
          {lead ? ` about the website check for ${lead.company}` : ""}. Pick a day and time, add your details, done.
        </p>
        <ul className={s.chips}>
          <li>15 minutes</li>
          <li>Free, no obligation</li>
          <li>UK time</li>
        </ul>
        {error && <div className={s.error}>{error}</div>}

        <form action={bookCall} className={s.card}>
          <input type="hidden" name="lead" value={lead?.slug ?? ""} />
          <input type="hidden" name="back" value={base} />

          <div className={s.step}>
            <h2 className={s.stepHead}><span className={s.num}>1</span>Pick a day</h2>
            {days.length ? (
              <BookCalendar available={days.map(([k]) => k)} selected={selectedDay} month={month} base={base} timezone={availability.timezone} />
            ) : (
              <p className={s.empty}>No times available right now. Email {brand.email} and I&apos;ll find one.</p>
            )}
          </div>

          {daySlots.length > 0 && (
            <div className={s.step}>
              <h2 className={s.stepHead}>
                <span className={s.num}>2</span>Pick a time <small className={s.stepSub}>{selectedLabel}</small>
              </h2>
              <div className={s.slots}>
                {daySlots.map((sl, i) => (
                  <label key={sl.iso} className={s.slot}>
                    <input type="radio" name="slot" value={sl.iso} required defaultChecked={i === 0} />
                    <span>{sl.timeLabel}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {daySlots.length > 0 && (
            <div className={s.step}>
              <h2 className={s.stepHead}><span className={s.num}>3</span>Your details</h2>
              <div className={s.row}>
                <label className={s.field}>
                  <span>Your name</span>
                  <input name="name" required defaultValue={name} autoComplete="name" placeholder="Jane Smith" />
                </label>
                <label className={s.field}>
                  <span>Company <i>(optional)</i></span>
                  <input name="company" defaultValue={lead?.company ?? ""} autoComplete="organization" placeholder="Your business" />
                </label>
              </div>
              <div className={s.row}>
                <label className={s.field}>
                  <span>Email</span>
                  <input name="email" type="email" required defaultValue={lead?.email ?? ""} autoComplete="email" placeholder="you@company.com" />
                </label>
                <label className={s.field}>
                  <span>Phone{video ? <i> (needed for a phone call)</i> : ""}</span>
                  <input name="phone" type="tel" required={!video} autoComplete="tel" placeholder="07..." />
                </label>
              </div>
              {video ? (
                <div className={s.methods}>
                  <label>
                    <input type="radio" name="method" value="phone" defaultChecked /> I&apos;ll call you
                  </label>
                  <label>
                    <input type="radio" name="method" value="video" /> Video call
                  </label>
                </div>
              ) : (
                <input type="hidden" name="method" value="phone" />
              )}
              <label className={s.field}>
                <span>Anything you&apos;d like me to look at first? <i>(optional)</i></span>
                <textarea name="note" />
              </label>
              <SubmitButton className={s.btn} pending="Booking...">Confirm my call</SubmitButton>
              <p className={s.small}>You&apos;ll get a calendar invite by email straight away.</p>
            </div>
          )}
        </form>

        <p className={s.foot}>
          {brand.identityLine} · {brand.phone} · {brand.email}. Slots are {availability.slotMinutes} minutes.
        </p>
      </div>
      <GoogleTag />
    </div>
  );
}
