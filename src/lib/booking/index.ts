import { brand } from "../brand";
import { db, must } from "../db";
import { env } from "../env";
import { sendMail } from "../mail/send";
import { markMeeting } from "../pipeline";
import type { Lead, Mailbox } from "../types";
import { availabilityFromEnv, buildIcs, generateSlots } from "./slots";

export async function openSlots(now = new Date()) {
  const a = availabilityFromEnv();
  const until = new Date(now.getTime() + (a.daysAhead + 1) * 86400_000).toISOString();
  const rows = must(
    await db().from("bookings").select("start_at").eq("status", "confirmed").gte("start_at", now.toISOString()).lte("start_at", until),
  ) as { start_at: string }[];
  const taken = new Set(rows.map((r) => new Date(r.start_at).toISOString()));
  return { slots: generateSlots(a, now, taken), availability: a };
}

export interface BookingInput {
  slot: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  method: "phone" | "video";
  note: string | null;
  leadSlug: string | null;
}

export const videoUrl = () => process.env.BOOKING_VIDEO_URL?.trim() || null;

/** Returns the booking id, or throws a message safe to show the visitor. */
export async function createBooking(i: BookingInput): Promise<string> {
  const { slots, availability } = await openSlots();
  if (!slots.some((s) => s.iso === i.slot)) throw new Error("Sorry, that time has just gone. Please pick another.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email)) throw new Error("Please check your email address.");
  if (i.method === "phone" && !i.phone) throw new Error("Please add a phone number so I can call you.");

  const lead = i.leadSlug
    ? (must(await db().from("leads").select("*").eq("slug", i.leadSlug).maybeSingle()) as Lead | null)
    : null;
  const start = new Date(i.slot);
  const end = new Date(start.getTime() + availability.slotMinutes * 60000);
  const res = await db()
    .from("bookings")
    .insert({
      lead_id: lead?.id ?? null,
      name: i.name,
      email: i.email.toLowerCase(),
      phone: i.phone,
      company: i.company ?? lead?.company ?? null,
      method: i.method,
      note: i.note,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    })
    .select("id")
    .single();
  if (res.error) {
    if (/duplicate|unique/i.test(res.error.message)) throw new Error("Sorry, that time has just gone. Please pick another.");
    throw new Error("Something went wrong saving your booking. Please try again.");
  }
  const id = (res.data as { id: string }).id;
  if (lead) {
    await markMeeting(lead.id); // stops the email sequence
  }
  await notify(id, i, start, availability.slotMinutes, availability.timezone, lead).catch((e) => console.error("[booking] email failed", e));
  return id;
}

async function notify(id: string, i: BookingInput, start: Date, minutes: number, tz: string, lead: Lead | null) {
  const box = (must(await db().from("mailboxes").select("*").eq("active", true).order("created_at").limit(1)) as Mailbox[])[0];
  if (!box) return;
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start);
  const video = videoUrl();
  const how = i.method === "video" && video ? `Video call: ${video}` : `I'll call you on ${i.phone}`;
  const company = i.company ?? lead?.company ?? "";
  const auditLink = lead ? `${env.appUrl}/p/${lead.slug}` : null;
  const ics = buildIcs({
    uid: `${id}@${new URL(env.appUrl).hostname}`,
    start,
    minutes,
    summary: `${brand.name} call${company ? ` with ${company}` : ""}`,
    description: [how, auditLink ? `Audit: ${auditLink}` : "", i.note ? `Note: ${i.note}` : ""].filter(Boolean).join("\n"),
    organizerEmail: box.email,
    organizerName: `${brand.person}, ${brand.name}`,
    attendeeEmail: i.email,
    location: i.method === "video" && video ? video : i.phone ? `Phone: ${i.phone}` : undefined,
  });

  const first = i.name.split(/\s+/)[0];
  await sendMail(box, {
    to: i.email,
    subject: `booked: ${when}`,
    text: `Hi ${first},

Thanks, that's in for ${when} (UK time), 15 minutes.
${how}.

If you need to move it, just reply to this email.

${brand.person}
${brand.name} · ${brand.phone}`,
    icalEvent: ics,
  });

  const notifyTo = process.env.BOOKING_NOTIFY_EMAIL || env.reportTo();
  if (notifyTo) {
    await sendMail(box, {
      to: notifyTo,
      replyTo: i.email,
      subject: `New call booked: ${company || i.name}, ${when}`,
      text: [
        `${i.name}${company ? ` (${company})` : ""} booked ${when}.`,
        `Email: ${i.email}`,
        i.phone ? `Phone: ${i.phone}` : "",
        `Method: ${i.method}`,
        i.note ? `Note: ${i.note}` : "",
        auditLink ? `Their audit: ${auditLink}` : "",
        lead ? `Lead: ${env.appUrl}/leads/${lead.id}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      icalEvent: ics,
    });
  }
}
