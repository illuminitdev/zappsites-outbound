import Link from "next/link";
import { bookCall } from "@/app/actions";
import { GoogleTag } from "@/components/GoogleTag";
import { openSlots, videoUrl } from "@/lib/booking";
import { brand } from "@/lib/brand";
import type { Lead } from "@/lib/types";
import s from "./book.module.css";

/** Shared booking page: /book (anyone) and /book/<lead slug> (prefilled from the audit). */
export async function BookingPage({ lead, day, error, base }: { lead: Lead | null; day?: string; error?: string; base: string }) {
  const { slots, availability } = await openSlots();
  const days = [...new Map(slots.map((sl) => [sl.dayKey, sl.dayLabel])).entries()];
  const selectedDay = days.find(([k]) => k === day)?.[0] ?? days[0]?.[0];
  const daySlots = slots.filter((sl) => sl.dayKey === selectedDay);
  const video = videoUrl();
  const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ");

  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <div className={s.brand}>
          <a href={brand.url}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoUrl} alt={brand.name} />
          </a>
          <span>{brand.tagline}</span>
        </div>
        <h1 className={s.title}>Book a 15-minute call</h1>
        <p className={s.lede}>
          With {brand.person} at {brand.name}
          {lead ? ` about the website check for ${lead.company}` : ""}. Pick any time that suits you. Times are UK time.
        </p>
        {error && <div className={s.error}>{error}</div>}

        <form action={bookCall}>
          <input type="hidden" name="lead" value={lead?.slug ?? ""} />
          <input type="hidden" name="back" value={base} />

          <div className={s.card}>
            <h2>1. Pick a day</h2>
            {days.length ? (
              <div className={s.days}>
                {days.map(([k, label]) => {
                  const [wd, ...rest] = label.split(" ");
                  return (
                    <Link key={k} href={`${base}?day=${k}`} className={`${s.day} ${k === selectedDay ? s.dayOn : ""}`} scroll={false}>
                      <b>{wd}</b>
                      {rest.join(" ")}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className={s.empty}>No times available right now. Email {brand.email} and I&apos;ll find one.</p>
            )}
          </div>

          {daySlots.length > 0 && (
            <div className={s.card}>
              <h2>2. Pick a time</h2>
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
            <div className={s.card}>
              <h2>3. Your details</h2>
              <div className={s.row}>
                <label className={s.field}>
                  <span>Name</span>
                  <input name="name" required defaultValue={name} autoComplete="name" />
                </label>
                <label className={s.field}>
                  <span>Company</span>
                  <input name="company" defaultValue={lead?.company ?? ""} autoComplete="organization" />
                </label>
              </div>
              <div className={s.row}>
                <label className={s.field}>
                  <span>Email</span>
                  <input name="email" type="email" required defaultValue={lead?.email ?? ""} autoComplete="email" />
                </label>
                <label className={s.field}>
                  <span>Phone{video ? " (needed for a phone call)" : ""}</span>
                  <input name="phone" type="tel" required={!video} autoComplete="tel" />
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
                <span>Anything you&apos;d like me to look at first? (optional)</span>
                <textarea name="note" />
              </label>
              <button className={s.btn}>Confirm call</button>
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
