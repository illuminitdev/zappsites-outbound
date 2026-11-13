// Inbound "free visibility check" (the Google Ads landing page). The visitor asked for the
// report, so they're contacted about it directly; they never enter a cold sequence.

import { runAudit } from "./audit";
import { displayScore } from "./audit/analyze";
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

const ENGINE_NAME: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" };
const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** "No. On a phone people have to..." -> "On a phone people have to..." (first sentence only, kept short). */
function plainDetail(detail: string) {
  const d = detail.replace(/^(No|Yes|Not yet|Not really|Not clearly|Slow)[.,]\s*/i, "").trim();
  // Split on ". " so numbers like "6.2 seconds" stay whole.
  const sentences = d.split(/(?<=[.?])\s+/).filter(Boolean);
  // One sentence, unless it's too short to say anything on its own.
  const first = sentences[0].length < 40 && sentences[1] ? `${sentences[0]} ${sentences[1]}` : sentences[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** True when the person asked for the report (the /check form or a manual audit), not a cold lead. */
export const askedForReport = (lead: Pick<Lead, "source">) => ["manual", "inbound"].includes(lead.source);

/**
 * The email that delivers a lead's audit report. Used as-is for /check, and as the editable preview in the admin.
 * It says what we checked, the score, the 2-3 things that matter most in plain words, and links the full report.
 */
export function reportEmail(lead: Lead): { subject: string; text: string } {
  const a = lead.audit;
  const site = lead.domain ?? lead.company;
  const link = `${env.appUrl}/p/${lead.slug}`;
  const booking = `${env.appUrl}/book/${lead.slug}`;
  const asked = askedForReport(lead);
  const hasSite = !!a?.url && a.reachable;

  const issues = (a?.topIssues ?? []).slice(0, 3).map((c) => `- ${c.label}: ${plainDetail(c.detail)}`);
  const mobile = a?.performance?.mobileScore;
  const aeo = a?.aeo;
  const aeoLine =
    aeo && aeo.answered > 0
      ? `I also asked ${joinAnd(aeo.engines.map((e) => ENGINE_NAME[e] ?? e))} who they'd recommend${aeo.services?.[0] ? ` for ${aeo.services[0]}` : ""}${lead.city ? ` in ${lead.city}` : ""}. ${
          aeo.mentions === 0
            ? `${lead.company} didn't come up in any of the ${aeo.answered} answers${aeo.topCompetitors[0] ? `, but ${aeo.topCompetitors[0].name} did` : ""}.`
            : `${lead.company} came up in ${aeo.mentions} of ${aeo.answered} answers.`
        }`
      : null;

  let summary: string;
  if (!a?.url) summary = `We couldn't find a website for ${lead.company}, so when people search for you there's nothing to land on.`;
  else if (!a.reachable) summary = `When we tried to load ${site}, it didn't open. Anyone clicking through from Google would see an error.`;
  else
    summary = `Overall it scored ${displayScore(a)} out of 100${mobile != null ? `, and ${mobile}/100 for speed on a phone` : ""}. ${
      issues.length ? `The ${issues.length === 1 ? "thing" : `${issues.length} things`} I'd fix first:` : "It's in good shape, with only small tweaks left."
    }`;

  const opener = asked
    ? `Thanks for asking for a website check. Your report for ${site} is ready:`
    : hasSite
      ? `I ran a free check on ${site} (speed on phones, how Google sees it, and whether AI assistants like ChatGPT recommend you) and put the results on one page:`
      : `I put together a short report on how ${lead.company} shows up online:`;

  const text = [
    `Hi ${lead.first_name ?? "there"},`,
    "",
    opener,
    link,
    "",
    summary,
    ...(hasSite && issues.length ? issues : []),
    ...(aeoLine ? ["", aeoLine] : []),
    "",
    `The report explains each one in plain English. If you'd like me to walk you through the fixes, pick a 15 minute slot here:`,
    booking,
    "",
    asked ? "No pressure either way, the report is yours to keep." : "If it's not useful, no problem, just ignore this.",
    "",
    brand.person,
    `${brand.name} · ${brand.phone}`,
    "",
    asked
      ? `${brand.identityLine}. You're getting this because you asked for a website check.`
      : `${brand.identityLine}. Reply "no" and I won't email again, or unsubscribe: ${env.appUrl}/u/${lead.slug}`,
  ].join("\n");

  return {
    subject: asked ? `Your website report for ${site}` : hasSite ? `Website check for ${site}` : `How ${lead.company} shows up online`,
    text,
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
  const to = mail.to.toLowerCase();
  const blocked = must(await db().from("suppression").select("value").in("value", [to, to.split("@")[1] ?? ""])) as unknown[];
  if (blocked.length) throw new Error(`${to} is on the do-not-contact list`);
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
  // The report is the first touch: drop any unsent cold sequence so they don't get two emails,
  // and move the lead on so the pipeline doesn't write a new sequence for it.
  await db().from("messages").update({ status: "cancelled" }).eq("lead_id", lead.id).eq("direction", "out").in("status", ["draft", "scheduled"]);
  if (["new", "enriched", "audited", "ready", "error"].includes(lead.status)) {
    await db().from("leads").update({ status: "sequencing", last_error: null }).eq("id", lead.id);
  }
}

async function emailReport(lead: Lead) {
  if (!lead.email || !(await reportMailbox())) return;
  await sendReport(lead, { to: lead.email, ...reportEmail(lead) });
}
