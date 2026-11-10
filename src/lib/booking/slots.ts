// Pure, timezone-safe slot generation for the built-in booking page.

export interface Availability {
  timezone: string; // e.g. Europe/London
  days: number[]; // ISO weekday 1=Mon..7=Sun
  startHour: number; // local, inclusive
  endHour: number; // local, exclusive (last slot ends at endHour)
  slotMinutes: number;
  minNoticeHours: number;
  daysAhead: number;
}

export interface Slot {
  iso: string; // UTC start
  dayKey: string; // local YYYY-MM-DD
  dayLabel: string; // "Mon 9 Nov"
  timeLabel: string; // "14:30"
}

function parts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    y: Number(g("year")),
    m: Number(g("month")),
    d: Number(g("day")),
    h: Number(g("hour")),
    min: Number(g("minute")),
    isoDay: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(g("weekday")) + 1,
  };
}

/** Wall-clock time in `tz` -> UTC Date (handles BST/GMT). */
export function localToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offsetAt = (t: number) => {
    const p = parts(new Date(t), tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass for the hour around a DST change
  return new Date(t);
}

export function generateSlots(a: Availability, now: Date, taken: Set<string> = new Set()): Slot[] {
  const earliest = now.getTime() + a.minNoticeHours * 3600_000;
  const out: Slot[] = [];
  const start = parts(now, a.timezone);
  for (let i = 0; i <= a.daysAhead; i++) {
    // Walk calendar days in local time (noon avoids DST edges).
    const noon = localToUtc(start.y, start.m, start.d, 12, 0, a.timezone).getTime() + i * 86400_000;
    const day = parts(new Date(noon), a.timezone);
    if (!a.days.includes(day.isoDay)) continue;
    const dayKey = `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
    const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: a.timezone, weekday: "short", day: "numeric", month: "short" }).format(new Date(noon));
    for (let mins = a.startHour * 60; mins + a.slotMinutes <= a.endHour * 60; mins += a.slotMinutes) {
      const at = localToUtc(day.y, day.m, day.d, Math.floor(mins / 60), mins % 60, a.timezone);
      if (at.getTime() < earliest) continue;
      const iso = at.toISOString();
      if (taken.has(iso)) continue;
      out.push({ iso, dayKey, dayLabel, timeLabel: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` });
    }
  }
  return out;
}

export function availabilityFromEnv(): Availability {
  const n = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
  return {
    timezone: process.env.BOOKING_TIMEZONE || "Europe/London",
    days: (process.env.BOOKING_DAYS || "1,2,3,4,5,6,7").split(",").map(Number).filter((x) => x >= 1 && x <= 7),
    startHour: n("BOOKING_START_HOUR", 8),
    endHour: n("BOOKING_END_HOUR", 20),
    slotMinutes: n("BOOKING_SLOT_MINUTES", 15),
    minNoticeHours: n("BOOKING_MIN_NOTICE_HOURS", 2),
    daysAhead: n("BOOKING_DAYS_AHEAD", 14),
  };
}

/** Calendar invite (RFC 5545). Lines folded at 75 octets is optional for most clients; kept short anyway. */
export function buildIcs(p: { uid: string; start: Date; minutes: number; summary: string; description: string; organizerEmail: string; organizerName: string; attendeeEmail: string; location?: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const end = new Date(p.start.getTime() + p.minutes * 60000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZappSites//Outbound Engine//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${p.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(p.start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(p.summary)}`,
    `DESCRIPTION:${esc(p.description)}`,
    ...(p.location ? [`LOCATION:${esc(p.location)}`] : []),
    `ORGANIZER;CN=${esc(p.organizerName)}:mailto:${p.organizerEmail}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${p.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
