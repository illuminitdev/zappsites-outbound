// Inbound "free visibility check" (the Google Ads landing page). The visitor asked for the
// report, so they're contacted about it directly; they never enter a cold sequence.

import { runAudit } from "./audit";
import { brand } from "./brand";
import { db, must } from "./db";
import { env } from "./env";
import { toDomain, toUrl } from "./http";
import { sendMail } from "./mail/send";
import type { Lead, Mailbox } from "./types";

export const TRADES = [
  { id: "electrician", label: "Electrician", category: "electricians" },
  { id: "plumber", label: "Plumber / heating engineer", category: "plumbers" },
  { id: "cleaner", label: "Cleaning company", category: "cleaning companies" },
  { id: "valeter", label: "Car valeting / detailing", category: "car valeting services" },
  { id: "pest", label: "Pest control", category: "pest control companies" },
  { id: "gardener", label: "Gardener / landscaper", category: "gardeners and landscapers" },
  { id: "salon", label: "Salon / beauty", category: "beauty salons" },
  { id: "pt", label: "Personal trainer", category: "personal trainers" },
  { id: "other", label: "Other local service", category: "" },
] as const;

export type TradeId = (typeof TRADES)[number]["id"];

export function tradeById(id: string | null | undefined) {
  return TRADES.find((t) => t.id === id) ?? null;
}

export interface CheckInput {
  website: string;
  company: string;
  trade: string;
  town: string;
  name: string;
  email: string;
  phone: string | null;
  gclid: string | null;
}

export async function createInboundCheck(i: CheckInput): Promise<Lead> {
  const website = toUrl(i.website);
  const domain = toDomain(i.website);
  if (!website || !domain || !domain.includes(".")) throw new Error("Please enter your website address, e.g. yourbusiness.co.uk");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email)) throw new Error("Please check your email address.");
  const [first, ...rest] = i.name.trim().split(/\s+/);
  const trade = tradeById(i.trade);
  const res = await db()
    .from("leads")
    .insert({
      company: i.company || domain,
      website,
      domain,
      first_name: first || null,
      last_name: rest.join(" ") || null,
      email: i.email.toLowerCase(),
      email_status: "valid",
      email_source: "inbound",
      city: i.town || null,
      source: "inbound",
      source_ref: i.gclid,
      // They asked for this report, so replying to them about it is consented contact.
      pecr_ok: true,
      status: "enriched",
      notes: [trade ? `Trade: ${trade.label}` : null, i.phone ? `Phone: ${i.phone}` : null].filter(Boolean).join(" · ") || null,
    })
    .select("*")
    .single();
  if (res.error) throw new Error("Something went wrong starting your check. Please try again.");
  const lead = res.data as Lead;
  await db().from("events").insert({ lead_id: lead.id, type: "check_requested", meta: { trade: i.trade, gclid: i.gclid } });
  return lead;
}

/** Runs after the response is sent (next/server `after`). Status: enriched -> audited. */
export async function runInboundAudit(lead: Lead, tradeId: string) {
  const trade = tradeById(tradeId);
  try {
    // Questions are written from the services on their site; the trade is only a fallback.
    const audit = await runAudit(lead.website!, { company: lead.company, domain: lead.domain, city: lead.city, category: trade?.category ?? "" });
    must(
      await db()
        .from("leads")
        .update({ audit, audit_score: audit.score, audited_at: audit.fetchedAt, aeo_mention_rate: audit.aeo?.mentionRate ?? null, status: "audited" })
        .eq("id", lead.id),
    );
    await db().from("events").insert({ lead_id: lead.id, type: "check_completed" });
    await emailReport({ ...lead, audit, audit_score: audit.score });
  } catch (e) {
    await db().from("leads").update({ status: "error", last_error: `Inbound audit: ${(e as Error).message}` }).eq("id", lead.id);
  }
}

/** The email that delivers a lead's audit report. Used as-is for /check, and as the editable preview in the admin. */
export function reportEmail(lead: Lead): { subject: string; text: string } {
  const top = lead.audit?.topIssues?.[0];
  const link = `${env.appUrl}/p/${lead.slug}`;
  return {
    subject: `your website check for ${lead.domain}`,
    text: `Hi ${lead.first_name ?? "there"},

Here's the report for ${lead.domain}:
${link}

${top ? `The first thing I'd look at is "${top.label}". ${top.detail.replace(/^(No|Yes)\.\s*/i, "")}\n\n` : ""}If you want to go through it, grab 15 minutes here: ${env.appUrl}/book/${lead.slug}

${brand.person}
${brand.name} · ${brand.phone}

${brand.identityLine}. You're getting this because you asked for a website check.`,
  };
}

/** The mailbox reports are sent from: the oldest active one. */
export async function reportMailbox(): Promise<Mailbox | null> {
  return (must(await db().from("mailboxes").select("*").eq("active", true).order("created_at").limit(1)) as Mailbox[])[0] ?? null;
}

/** Send a report email and record it on the lead's conversation. */
export async function sendReport(lead: Lead, mail: { to: string; subject: string; text: string }) {
  const box = await reportMailbox();
  if (!box) throw new Error("No active mailbox. Add one under Mailboxes first.");
  const messageId = await sendMail(box, { to: mail.to, subject: mail.subject, text: mail.text });
  await db().from("messages").insert({
    lead_id: lead.id,
    mailbox_id: box.id,
    direction: "out",
    subject: mail.subject,
    body_text: mail.text,
    message_id: messageId,
    status: "sent",
    sent_at: new Date().toISOString(),
  });
  await db().from("events").insert({ lead_id: lead.id, type: "report_sent", meta: { to: mail.to } });
}

async function emailReport(lead: Lead) {
  if (!lead.email || !(await reportMailbox())) return;
  await sendReport(lead, { to: lead.email, ...reportEmail(lead) });
}
