import Link from "next/link";
import s from "./book.module.css";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (y: number, m: number) => `${y}-${pad(m)}`;

/**
 * Month calendar. Days with open times are clickable (?day=YYYY-MM-DD); the rest are greyed out.
 * Arrows move between the months that have open times (?month=YYYY-MM). No JavaScript needed.
 */
export function BookCalendar({ available, selected, month, base, timezone }: { available: string[]; selected?: string; month?: string; base: string; timezone: string }) {
  const open = new Set(available);
  const months = [...new Set(available.map((d) => d.slice(0, 7)))].sort();
  const shown = (month && months.includes(month) ? month : selected?.slice(0, 7)) ?? months[0];
  const [y, m] = shown.split("-").map(Number);
  const idx = months.indexOf(shown);
  const prev = months[idx - 1];
  const next = months[idx + 1];

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // blanks before the 1st (Mon-first week)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));

  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className={s.cal}>
      <div className={s.calHead}>
        {prev ? (
          <Link href={`${base}?month=${prev}`} className={s.calNav} scroll={false} aria-label="Previous month">
            ‹
          </Link>
        ) : (
          <span className={`${s.calNav} ${s.calNavOff}`} aria-hidden="true">‹</span>
        )}
        <b>{title}</b>
        {next ? (
          <Link href={`${base}?month=${next}`} className={s.calNav} scroll={false} aria-label="Next month">
            ›
          </Link>
        ) : (
          <span className={`${s.calNav} ${s.calNavOff}`} aria-hidden="true">›</span>
        )}
      </div>
      <div className={s.calGrid}>
        {WEEKDAYS.map((w) => (
          <span key={w} className={s.calWd}>
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} />;
          const key = `${monthKey(y, m)}-${pad(d)}`;
          const cls = [s.calDay, key === today ? s.calToday : ""].join(" ");
          if (!open.has(key)) {
            return (
              <span key={key} className={`${cls} ${s.calOff}`}>
                {d}
              </span>
            );
          }
          return (
            <Link key={key} href={`${base}?day=${key}`} className={`${cls} ${s.calOpen} ${key === selected ? s.calOn : ""}`} scroll={false} aria-current={key === selected ? "date" : undefined}>
              {d}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
