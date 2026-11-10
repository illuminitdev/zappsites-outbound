import { describe, expect, it } from "vitest";
import { buildIcs, generateSlots, localToUtc } from "@/lib/booking/slots";

const a = { timezone: "Europe/London", days: [1, 2, 3, 4, 5, 6, 7], startHour: 8, endHour: 20, slotMinutes: 15, minNoticeHours: 2, daysAhead: 14 };

describe("booking slots", () => {
  it("converts UK wall-clock to UTC across GMT and BST", () => {
    expect(localToUtc(2026, 11, 9, 9, 0, "Europe/London").toISOString()).toBe("2026-11-09T09:00:00.000Z");
    expect(localToUtc(2026, 7, 9, 9, 0, "Europe/London").toISOString()).toBe("2026-07-09T08:00:00.000Z");
  });
  it("offers 08:00-20:00 in 15-minute slots every day, respecting notice", () => {
    const now = new Date("2026-11-06T13:01:00Z"); // Fri 13:01 GMT
    const slots = generateSlots(a, now);
    expect(slots[0]).toMatchObject({ dayKey: "2026-11-06", timeLabel: "15:15" });
    const sat = slots.filter((s) => s.dayKey === "2026-11-07");
    expect(sat).toHaveLength(48);
    expect(sat[0].timeLabel).toBe("08:00");
    expect(sat.at(-1)!.timeLabel).toBe("19:45");
    expect(new Set(slots.map((s) => s.dayKey)).size).toBe(15);
  });
  it("removes taken slots and respects weekdays", () => {
    const now = new Date("2026-11-06T13:01:00Z");
    const taken = new Set(["2026-11-07T08:00:00.000Z"]);
    expect(generateSlots(a, now, taken).some((s) => s.iso === "2026-11-07T08:00:00.000Z")).toBe(false);
    const weekdays = generateSlots({ ...a, days: [1, 2, 3, 4, 5] }, now);
    expect(weekdays.some((s) => s.dayKey === "2026-11-07")).toBe(false);
  });
  it("handles the clocks-go-back day without duplicate times", () => {
    const slots = generateSlots(a, new Date("2026-10-24T12:00:00Z")).filter((s) => s.dayKey === "2026-10-25");
    expect(slots).toHaveLength(48);
    expect(new Set(slots.map((s) => s.iso)).size).toBe(48);
    expect(slots[0].iso).toBe("2026-10-25T08:00:00.000Z"); // 08:00 GMT after the change
  });
  it("builds a valid calendar invite", () => {
    const ics = buildIcs({ uid: "x@y", start: new Date("2026-11-09T09:00:00Z"), minutes: 15, summary: "ZappSites call, Brightcover", description: "I'll call you", organizerEmail: "ram@z.test", organizerName: "Ram", attendeeEmail: "jo@b.test" });
    expect(ics).toContain("DTSTART:20261109T090000Z");
    expect(ics).toContain("DTEND:20261109T091500Z");
    expect(ics).toContain("SUMMARY:ZappSites call\\, Brightcover");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});
