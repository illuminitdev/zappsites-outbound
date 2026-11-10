// Pure scheduling helpers. Timezone-aware via Intl, so DST is handled.

export interface SendWindow {
  startHour: number; // inclusive, local
  endHour: number; // exclusive, local
  days: number[]; // ISO weekday 1=Mon .. 7=Sun
  timezone: string;
}

const STEP_MS = 5 * 60 * 1000;

export function localParts(d: Date, tz: string): { hour: number; minute: number; isoDay: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { hour: Number(get("hour")), minute: Number(get("minute")), isoDay: wd };
}

export function inWindow(d: Date, w: SendWindow): boolean {
  const { hour, isoDay } = localParts(d, w.timezone);
  return w.days.includes(isoDay) && hour >= w.startHour && hour < w.endHour;
}

/** Earliest moment at or after `from` that falls inside the window (5-minute resolution). */
export function nextInWindow(from: Date, w: SendWindow): Date {
  if (w.startHour >= w.endHour || !w.days.length) throw new Error("Send window is empty");
  let t = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  const limit = t + 15 * 24 * 3600 * 1000;
  while (t < limit) {
    if (inWindow(new Date(t), w)) return new Date(t);
    t += STEP_MS;
  }
  throw new Error("No send slot found in the next 15 days");
}

/**
 * Plan send times for each step. Step N is `day` days after the first send, snapped forward
 * into the window. `jitterMinutes` spreads sends so mailboxes don't fire on the same minute.
 */
export function planSequence(
  start: Date,
  stepDays: number[],
  w: SendWindow,
  jitterMinutes: number[] = [],
): Date[] {
  const first = nextInWindow(new Date(start.getTime() + (jitterMinutes[0] ?? 0) * 60000), w);
  return stepDays.map((day, i) => {
    if (i === 0) return first;
    const base = new Date(first.getTime() + day * 24 * 3600 * 1000 + (jitterMinutes[i] ?? 0) * 60000);
    return nextInWindow(base, w);
  });
}

/** Deterministic pseudo-random jitter (0..max) from a string, so re-planning is stable. */
export function jitterFor(seed: string, count: number, max = 90): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 2654435761) >>> 0;
    return h % (max + 1);
  });
}
