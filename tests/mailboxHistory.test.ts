import { describe, expect, it } from "vitest";
import { buildHistory, type HistoryMessage } from "@/lib/mailboxHistory";

const out = (mailbox_id: string, sent_at: string, status = "sent"): HistoryMessage => ({
  mailbox_id, direction: "out", status, sent_at: status === "sent" ? sent_at : null, scheduled_for: sent_at, received_at: null,
});
const reply = (mailbox_id: string, received_at: string): HistoryMessage => ({
  mailbox_id, direction: "in", status: "received", sent_at: null, scheduled_for: null, received_at,
});

describe("buildHistory", () => {
  it("groups by London day, per mailbox, newest day first", () => {
    const days = buildHistory([
      out("a", "2026-11-15T09:00:00Z"),
      out("a", "2026-11-15T16:30:00Z"),
      out("b", "2026-11-15T10:00:00Z"),
      out("b", "2026-11-15T11:00:00Z", "failed"),
      reply("a", "2026-11-15T12:00:00Z"),
      out("a", "2026-11-16T08:00:00Z"),
      out("a", "2026-11-16T09:00:00Z", "draft"), // ignored
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-11-16", "2026-11-15"]);
    const d = days[1];
    expect([d.sent, d.failed, d.replies]).toEqual([3, 1, 1]);
    expect([d.first, d.last]).toEqual(["2026-11-15T09:00:00Z", "2026-11-15T16:30:00Z"]);
    expect(d.mailboxes.map((m) => [m.mailboxId, m.sent, m.failed])).toEqual([["a", 2, 0], ["b", 1, 1]]);
  });

  it("uses the UK day, not UTC (BST)", () => {
    // 23:30 UTC on 1 July is 00:30 on 2 July in London.
    expect(buildHistory([out("a", "2026-07-01T23:30:00Z")])[0].day).toBe("2026-07-02");
  });
});
