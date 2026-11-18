const AVATAR_COLORS = ["#fde2c0", "#d9e7ff", "#d5f0e3", "#f9d9e3", "#e6defb", "#fbe9b7"];

export function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** "14:05" today, "Mon" this week, otherwise "12 Nov". */
export function shortTime(d: string | null) {
  if (!d) return "";
  const date = new Date(d);
  const age = Date.now() - date.getTime();
  const o: Intl.DateTimeFormatOptions =
    age < 86400_000 ? { hour: "2-digit", minute: "2-digit" } : age < 6 * 86400_000 ? { weekday: "short" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(date);
}

/** "Wed 18 Nov 2026, 08:01", like a mail client's message header. */
export function longTime(d: string | null) {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

/**
 * Plain text from HTML emails comes with a blank line for every empty paragraph.
 * Display only: trailing spaces go and runs of blank lines become one.
 */
export function cleanBody(text: string | null) {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
