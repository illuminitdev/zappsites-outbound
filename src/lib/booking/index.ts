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
  website: string | null;
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
  if (!i.company?.trim()) throw new Error("Please add your company name.");
  if (i.method === "video" && !videoUrl()) i.method = "phone";
  if (i.website) {
    const w = /^https?:\/\//i.test(i.website) ? i.website.trim() : `https://${i.website.trim()}`;
    try {
      const u = new URL(w);
      if (!u.hostname.includes(".")) throw new Error();
      i.website = u.href.replace(/\/$/, "");
    } catch {
      throw new Error("Please check your website address (e.g. yourbusiness.co.uk).");
    }
  }

  const lead = i.leadSlug
    ? (must(await db().from("leads").select("*").eq("slug", i.leadSlug).maybeSingle()) as Lead | null)
    : null;
  const start = new Date(i.slot);
  const end = new Date(start.getTime() + availability.slotMinutes * 60000);
  const row = {
    lead_id: lead?.id ?? null,
    name: i.name,
    email: i.email.toLowerCase(),
    phone: i.phone,
    company: i.company ?? lead?.company ?? null,
    website: i.website,
    method: i.method,
    note: i.note,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
  };
  let res = await db().from("bookings").insert(row).select("id").single();
  if (res.error && /website/.test(res.error.message)) {
    // Migration 0009 (bookings.website) not run yet: keep the website in the note instead.
    const { website, ...rest } = row;
    const note = [website ? `Website: ${website}` : "", i.note ?? ""].filter(Boolean).join("\n") || null;
    res = await db().from("bookings").insert({ ...rest, note }).select("id").single();
  }
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
  const how =
    i.method === "video" && video
      ? `Video call: ${video}`
      : i.phone
        ? `${brand.person} will call you on ${i.phone}`
        : `We'll email you before the call with how to join`;
  const company = i.company ?? lead?.company ?? "";
  const auditLink = lead ? `${env.appUrl}/p/${lead.slug}` : null;
  const ics = buildIcs({
    uid: `${id}@${new URL(env.appUrl).hostname}`,
    start,
    minutes,
    summary: `${brand.name} call${company ? ` with ${company}` : ""}`,
    description: [how, i.website ? `Website: ${i.website}` : "", auditLink ? `Audit: ${auditLink}` : "", i.note ? `Note: ${i.note}` : ""].filter(Boolean).join("\n"),
    organizerEmail: box.email,
    organizerName: `${brand.person}, ${brand.name}`,
    attendeeEmail: i.email,
    location: i.method === "video" && video ? video : i.phone ? `Phone: ${i.phone}` : undefined,
  });

  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const endAt = new Date(start.getTime() + minutes * 60000);
  const first = i.name.split(/\s+/)[0];
  await sendMail(box, {
    to: i.email,
    subject: `Confirmed: your ${brand.name} call on ${day} at ${time(start)}`,
    text: `Hi ${first},

Your call is booked and confirmed.

  Date:  ${day}
  Time:  ${time(start)} – ${time(endAt)} (UK time), ${minutes} minutes
  With:  ${brand.person}, ${brand.name}
  How:   ${how}
${company ? `  Company:  ${company}
` : ""}${i.website ? `  Website:  ${i.website}
` : ""}
A calendar invite is attached, so you can add it to your calendar in one click.

Need to change the time? Just reply to this email or call ${brand.phone}.

Speak soon,
${brand.person}
${brand.name} · ${brand.phone} · ${brand.url.replace(/^https?:\/\//, "")}`,
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
        i.phone ? `Phone: ${i.phone}` : "Phone: (not given)",
        i.website ? `Website: ${i.website}` : "",
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
