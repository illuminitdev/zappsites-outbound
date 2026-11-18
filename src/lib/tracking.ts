// Per-email tracking: an invisible image to see whether an email was opened, and the email's own id
// on its links so a report view or "Book a call" click is credited to the email that caused it.
// Events land in the `events` table with meta.message_id (types: email_sent, email_open, page_view, booking_click).

import { env } from "./env";

/** Requests from link scanners and previewers, not people. */
export const BOT_UA = /bot|crawler|spider|preview|scanner|safelinks|proofpoint|mimecast|barracuda|headless|curl|wget|python|go-http/i;

/**
 * Opens, report views and booking clicks this soon after an email is sent are mail-security scanners
 * (Safe Links, Mimecast...) checking every link, not the recipient. Seen in practice: 5-55 seconds,
 * with a normal browser user agent, so the user-agent check alone doesn't catch them.
 */
export const SCANNER_GRACE_MS = 120_000;

/** True when an event happened within the scanner window after one of these send times. */
export function isScannerHit(eventAt: string, sentAts: (string | null)[]): boolean {
  const t = new Date(eventAt).getTime();
  return sentAts.some((s) => {
    if (!s) return false;
    const d = t - new Date(s).getTime();
    return d >= 0 && d < SCANNER_GRACE_MS;
  });
}

/** Was an email sent to this lead in the last couple of minutes? (Then a visit now is probably a scanner.) */
export async function justEmailed(leadId: string): Promise<boolean> {
  const { db } = await import("./db");
  const since = new Date(Date.now() - SCANNER_GRACE_MS).toISOString();
  const { data } = await db().from("messages").select("id").eq("lead_id", leadId).eq("direction", "out").eq("status", "sent").gte("sent_at", since).limit(1);
  return !!data?.length;
}

export const pixelUrl = (messageId: string) => `${env.appUrl}/api/public/o/${messageId}`;

/** Add the email's id to one of our links, e.g. ".../p/abc" -> ".../p/abc?m=<id>". */
export function trackedUrl(url: string, messageId: string): string {
  const u = new URL(url);
  u.searchParams.set("m", messageId);
  return u.toString();
}

/** A message id from a link's ?m=, if it looks like one. */
export function messageIdFrom(v: string | null | undefined): string | null {
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The plain-text email as simple HTML: same words, links clickable, plus the open-tracking image.
 * Deliberately plain (no layout, no images besides the 1x1 pixel) so it still reads like a personal email.
 */
export function textToHtml(text: string, pixel: string): string {
  const body = esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}">${u}</a>`)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${body}<img src="${pixel}" width="1" height="1" alt="" style="border:0;width:1px;height:1px"></body></html>`;
}

/** 1x1 transparent GIF. */
export const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
