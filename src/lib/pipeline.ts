import { runAudit } from "./audit";
import { analyseReply, BOOKING_TOKEN, writeSequence } from "./claude";
import { db, must } from "./db";
import { brand } from "./brand";
import { env } from "./env";
import { humanise } from "./sequence/humanise";
import { toDomain } from "./http";
import { companyFromSiteText, entityTypeFromCompanyType, firstDirector, isCorporateSubscriber, matchCompany, searchNewCompanies, type ChCompany } from "./leads/companiesHouse";
import type { LeadInput } from "./leads/csv";
import { findEmail, siteLegalText } from "./leads/email";
import { cityFrom, postcodeFrom, searchPlaces } from "./leads/places";
import { fetchNewMail, stripQuoted } from "./mail/inbox";
import { sendMail } from "./mail/send";
import { jitterFor, planSequence } from "./sequence/schedule";
import { auditSubject, renderEmail, threadSubject } from "./sequence/render";
import { pixelUrl, textToHtml, trackedUrl } from "./tracking";
import { writeTemplateSequence } from "./sequence/template";
import type { Campaign, Lead, Mailbox, Message } from "./types";

const log = (...a: unknown[]) => console.log("[outbound]", ...a);

/** "Ram\nZappSites · 020 3488 6301": how a person signs, not a corporate block. */
export const defaultSignature = () => `${brand.person}\n${brand.name} · ${brand.phone}`;

// ---------- helpers ----------

export async function getCampaign(id: string | null): Promise<Campaign | null> {
  if (!id) return null;
  return must(await db().from("campaigns").select("*").eq("id", id).maybeSingle()) as Campaign | null;
}

export async function isSuppressed(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  const d = e.split("@")[1] ?? "";
  const rows = must(await db().from("suppression").select("value").in("value", [e, d])) as { value: string }[];
  return rows.length > 0;
}

export async function suppress(value: string, kind: "email" | "domain", reason: string) {
  must(await db().from("suppression").upsert({ value: value.toLowerCase(), kind, reason }, { onConflict: "value" }));
}

async function cancelPending(leadId: string) {
  must(
    await db()
      .from("messages")
      .update({ status: "cancelled" })
      .eq("lead_id", leadId)
      .eq("direction", "out")
      .in("status", ["draft", "scheduled"]),
  );
}

async function setLead(id: string, patch: Partial<Lead> & Record<string, unknown>) {
  must(await db().from("leads").update(patch).eq("id", id));
}

const auditUrl = (lead: Pick<Lead, "slug">) => `${env.appUrl}/p/${lead.slug}`;
const unsubscribeUrl = (lead: Pick<Lead, "slug">) => `${env.appUrl}/u/${lead.slug}`;
const bookingUrl = (lead: Pick<Lead, "slug">) => `${env.appUrl}/api/public/go/${lead.slug}`;

// ---------- 1. import ----------

export async function importLeads(campaignId: string | null, inputs: LeadInput[]): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  let duplicates = 0;
  for (const l of inputs) {
    const row = {
      campaign_id: campaignId,
      company: l.company,
      website: l.website,
      domain: l.domain ?? toDomain(l.website),
      email: l.email,
      first_name: l.first_name,
      last_name: l.last_name,
      city: l.city,
      ...(l.phone ? { phone: l.phone } : {}),
      ...(l.address ? { address: l.address } : {}),
      entity_type: l.entity_type,
      pecr_ok: isCorporateSubscriber(l.entity_type),
      source: l.source,
      source_ref: l.source_ref,
    };
    // Skip if the same domain is already in this campaign.
    if (row.domain) {
      const q = db().from("leads").select("id").eq("domain", row.domain).limit(1);
      const existing = must(await (campaignId ? q.eq("campaign_id", campaignId) : q.is("campaign_id", null))) as { id: string }[];
      if (existing.length) {
        duplicates++;
        continue;
      }
    }
    const res = await db().from("leads").insert(row);
    if (res.error) {
      if (/duplicate/i.test(res.error.message)) duplicates++;
      else throw new Error(res.error.message);
    } else inserted++;
  }
  return { inserted, duplicates };
}

export async function importFromPlaces(campaignId: string | null, query: string, max = 60) {
  const places = await searchPlaces(query, max);
  const inputs: LeadInput[] = places
    .filter((p) => p.website)
    .map((p) => ({
      company: p.name,
      website: p.website,
      domain: toDomain(p.website),
      email: null,
      first_name: null,
      last_name: null,
      city: cityFrom(p.address),
      phone: p.phone,
      address: p.address,
      entity_type: "unknown",
      source: "places",
      source_ref: p.id,
    }));
  // Places without a website are a pitch for a website, but there's no email to reach them; skip.
  const r = await importLeads(campaignId, inputs);
  return { ...r, found: places.length, noWebsite: places.length - inputs.length };
}

export async function importFromCompaniesHouse(
  campaignId: string | null,
  p: { sicCodes: string[]; incorporatedFrom: string; location?: string; size?: number },
) {
  const companies = await searchNewCompanies(p);
  const inputs: LeadInput[] = [];
  for (const c of companies) {
    const director = await firstDirector(c.company_number).catch(() => null);
    inputs.push({
      company: c.company_name,
      website: null, // brand-new companies rarely have a site; enrichment tries to find one
      domain: null,
      email: null,
      first_name: director?.first ?? null,
      last_name: director?.last ?? null,
      city: c.registered_office_address?.locality ?? null,
      entity_type: entityTypeFromCompanyType(c.company_type),
      source: "companies_house",
      source_ref: c.company_number,
    });
  }
  const r = await importLeads(campaignId, inputs);
  return { ...r, found: companies.length };
}

/**
 * PECR: work out whether a lead is a corporate subscriber. Exact name match on Companies House
 * first, then the company number the website prints (Google listings use trading names).
 */
export async function resolveEntity(lead: Pick<Lead, "company" | "website" | "source_ref"> & { city?: string | null; email?: string | null }): Promise<Record<string, unknown>> {
  if (!env.companiesHouseKey()) return {};
  let match: ChCompany | null = null;
  // Google listings often add the town or "Co" to the name: try those variants too (still an exact match).
  for (const name of nameVariants(lead.company, lead.city ?? null)) {
    match = await matchCompany(name, null).catch(() => null);
    if (match) break;
  }
  // Then the company number printed on the website (and on the email's domain, if that's a different site).
  const sites = [lead.website, lead.email ? `https://${lead.email.split("@")[1]}` : null].filter((s): s is string => !!s);
  for (const site of [...new Set(sites.map((s) => toDomain(s) ?? s))].map((d) => (d.includes("://") ? d : `https://${d}`))) {
    if (match) break;
    match = await companyFromSiteText(await siteLegalText(site)).catch(() => null);
  }
  if (!match) return {};
  const et = entityTypeFromCompanyType(match.company_type);
  return { entity_type: et, pecr_ok: isCorporateSubscriber(et), source_ref: lead.source_ref ?? match.company_number };
}

const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|aol|btinternet|sky|virginmedia|talktalk)\./i;

/** The listed name, plus the same name without the town or a trailing "Co"/"Company". */
function nameVariants(company: string, city: string | null): string[] {
  const out = [company];
  const town = (city ?? "").replace(/[^\w\s'-]/g, "").trim();
  const noCity = town ? company.replace(new RegExp(`\\b${town}\\b`, "i"), " ") : company;
  for (const n of [noCity, noCity.replace(/\b(co|company)\.?\s*$/i, " ")]) {
    const clean = n.replace(/[\s,-]+$/, "").replace(/\s+/g, " ").trim();
    if (clean.length >= 3 && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/**
 * Leads that couldn't be confirmed as a Ltd/LLP when they were found get re-checked automatically,
 * at most once every 3 days each. Once confirmed, autoApproveReady schedules them on the same run.
 */
export async function recheckPecr(limit = 5) {
  const leads = must(
    await db()
      .from("leads")
      .select("id,company,website,source_ref,city,email")
      .eq("pecr_ok", false)
      .eq("entity_type", "unknown")
      .in("status", ["enriched", "audited", "ready"])
      .order("created_at")
      .limit(50),
  ) as (Pick<Lead, "id" | "company" | "website" | "source_ref" | "city" | "email">)[];
  if (!leads.length) return 0;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const recent = new Set(
    (must(await db().from("events").select("lead_id").eq("type", "pecr_checked").gte("created_at", since).in("lead_id", leads.map((l) => l.id))) as { lead_id: string }[]).map(
      (e) => e.lead_id,
    ),
  );
  let confirmed = 0;
  for (const lead of leads.filter((l) => !recent.has(l.id)).slice(0, limit)) {
    const email = lead.email && !FREE_MAIL.test(lead.email.split("@")[1] ?? "") ? lead.email : null;
    const patch = await resolveEntity({ ...lead, email }).catch(() => ({}) as Record<string, unknown>);
    if (Object.keys(patch).length) await setLead(lead.id, patch);
    if (patch.pecr_ok) confirmed++;
    await db().from("events").insert({ lead_id: lead.id, type: "pecr_checked", meta: { confirmed: !!patch.pecr_ok } });
  }
  return confirmed;
}

// ---------- 2. enrich ----------

export async function enrichLeads(limit = 10) {
  const leads = must(await db().from("leads").select("*").eq("status", "new").order("created_at").limit(limit)) as Lead[];
  for (const lead of leads) {
    try {
      const patch: Record<string, unknown> = {};

      // PECR: work out whether this is a corporate subscriber.
      if (lead.entity_type === "unknown") Object.assign(patch, await resolveEntity(lead));

      if (!lead.website && !lead.email) {
        await setLead(lead.id, { ...patch, status: "error", last_error: "No website or email. Add one manually, then reset to 'new'." });
        continue;
      }
      const r = await findEmail({ email: lead.email, website: lead.website, firstName: lead.first_name });
      if (!r.email || r.status === "invalid") {
        await setLead(lead.id, {
          ...patch,
          email: r.email,
          email_status: r.status,
          status: "error",
          last_error: r.email ? "Email failed verification" : "No email found on site",
        });
        continue;
      }
      // One address per campaign (unique index leads_campaign_email_uniq): if another lead already has it, this one is a duplicate.
      if (lead.campaign_id) {
        const twin = must(
          await db().from("leads").select("id,company").eq("campaign_id", lead.campaign_id).ilike("email", likeExact(r.email)).neq("id", lead.id).limit(1),
        ) as { id: string; company: string }[];
        if (twin.length) {
          await setLead(lead.id, { ...patch, status: "error", last_error: `Duplicate: ${r.email} already belongs to another lead (${twin[0].company}).` });
          continue;
        }
      }
      await setLead(lead.id, {
        ...patch,
        email: r.email,
        email_status: r.status,
        email_source: r.source,
        first_name: lead.first_name ?? r.firstName ?? null,
        last_name: lead.last_name ?? r.lastName ?? null,
        domain: lead.domain ?? toDomain(lead.website) ?? r.email.split("@")[1],
        status: "enriched",
        last_error: null,
      });
    } catch (e) {
      await setLead(lead.id, { status: "error", last_error: `Enrich: ${(e as Error).message}` });
    }
  }
  return leads.length;
}

// ---------- 3. audit ----------

export async function auditLeads(limit = 3) {
  const leads = must(await db().from("leads").select("*").eq("status", "enriched").order("created_at").limit(limit)) as Lead[];
  for (const lead of leads) {
    try {
      const campaign = await getCampaign(lead.campaign_id);
      const aeoCtx = campaign?.aeo_category?.trim()
        ? { company: lead.company, domain: lead.domain, city: lead.city, category: campaign.aeo_category, prompts: campaign.aeo_prompts }
        : undefined;
      if (!lead.website && !aeoCtx) {
        // No site to audit (e.g. new company). Leave it for a "you need a website" campaign.
        await setLead(lead.id, { status: "audited", audit: null, audit_score: null, audited_at: new Date().toISOString() });
        continue;
      }
      // Site checks and AEO/GEO mentions run in parallel; a lead with no website still gets the mentions audit.
      const audit = await runAudit(lead.website, aeoCtx, { city: lead.city, phone: lead.phone ?? null, company: lead.company, domain: lead.domain });
      await setLead(lead.id, {
        status: "audited",
        audit,
        audit_score: lead.website ? audit.score : null,
        audited_at: audit.fetchedAt,
        aeo_mention_rate: audit.aeo?.mentionRate ?? null,
      });
    } catch (e) {
      await setLead(lead.id, { status: "error", last_error: `Audit: ${(e as Error).message}` });
    }
  }
  return leads.length;
}

// ---------- 4. write ----------

const DEFAULT_CAMPAIGN = "General (automatic)";

/**
 * Leads uploaded without a campaign go into this one, so every upload gets emailed.
 * Created on first use with "Send automatically" on; edit or pause it on the Campaigns page like any other.
 */
export async function defaultCampaignId(): Promise<string> {
  const found = must(await db().from("campaigns").select("id").eq("name", DEFAULT_CAMPAIGN).limit(1)) as { id: string }[];
  if (found[0]) return found[0].id;
  const created = must(
    await db()
      .from("campaigns")
      .insert({
        name: DEFAULT_CAMPAIGN,
        offer: `${brand.name} fixes the website problems that stop small businesses getting enquiries: slow pages, poor mobile layout, weak Google and AI search visibility, and unclear contact details.`,
        icp: "UK small and medium businesses with a website",
        booking_url: "",
        active: true,
        auto_approve: true,
      })
      .select("id")
      .single(),
  ) as { id: string };
  return created.id;
}

/** Case-insensitive exact match for ilike: "_" and "%" in an address are literal, not wildcards. */
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Marker on a lead while a run is writing its emails (see writeEmails). */
const WRITING = "writing";

export async function writeEmails(limit = 5) {
  const leads = must(await db().from("leads").select("*").eq("status", "audited").order("created_at").limit(limit)) as Lead[];
  let fallback: string | null = null;
  for (const lead of leads) {
    if (!lead.campaign_id) {
      fallback ??= await defaultCampaignId();
      lead.campaign_id = fallback;
      await setLead(lead.id, { campaign_id: fallback });
    }
    const campaign = await getCampaign(lead.campaign_id);
    if (!campaign?.active) continue;
    // Claim the lead first, so two overlapping runs can't both write (and later send) a sequence for it.
    const claimed = must(
      await db().from("leads").update({ last_error: WRITING }).eq("id", lead.id).eq("status", "audited").or(`last_error.is.null,last_error.neq.${WRITING}`).select("id"),
    ) as { id: string }[];
    if (!claimed.length) continue;
    // Already has emails (e.g. written by an earlier run that didn't finish updating the lead): don't write again.
    const existing = must(await db().from("messages").select("id").eq("lead_id", lead.id).eq("direction", "out").neq("status", "cancelled").limit(1)) as unknown[];
    if (existing.length) {
      await setLead(lead.id, { status: "ready", last_error: null });
      continue;
    }
    try {
      // Templates by default (no AI cost); EMAIL_WRITER=ai uses Claude to write each email instead.
      const { emails, pageNote } = process.env.EMAIL_WRITER === "ai" ? await writeSequence(campaign, lead) : writeTemplateSequence(campaign, lead);
      const rows = emails.map((e, i) => ({
        lead_id: lead.id,
        campaign_id: campaign.id,
        direction: "out",
        step: i,
        subject: threadSubject(auditSubject(lead), i),
        body_text: e.body,
        status: "draft",
      }));
      must(await db().from("messages").insert(rows));
      await setLead(lead.id, { status: "ready", audit_note: pageNote || null, last_error: null });
      if (campaign.auto_approve && lead.pecr_ok) await approveLeads([lead.id]);
    } catch (e) {
      await setLead(lead.id, { status: "error", last_error: `Write: ${(e as Error).message}` });
    }
  }
  return leads.length;
}

// ---------- 5. approve + schedule ----------

/**
 * Leads already sitting at "ready" in a campaign that sends automatically (e.g. written before
 * "Send automatically" was switched on). PECR and suppression checks still apply in approveLeads.
 */
export async function autoApproveReady(limit = 20) {
  const campaigns = must(await db().from("campaigns").select("id").eq("active", true).eq("auto_approve", true)) as { id: string }[];
  if (!campaigns.length) return 0;
  const leads = must(
    await db().from("leads").select("id").eq("status", "ready").eq("pecr_ok", true).in("campaign_id", campaigns.map((c) => c.id)).limit(limit),
  ) as { id: string }[];
  if (!leads.length) return 0;
  return (await approveLeads(leads.map((l) => l.id))).scheduled;
}

export async function approveLeads(leadIds: string[]): Promise<{ scheduled: number; blocked: string[] }> {
  const blocked: string[] = [];
  let scheduled = 0;
  for (const id of leadIds) {
    const lead = must(await db().from("leads").select("*").eq("id", id).single()) as Lead;
    if (lead.status !== "ready") continue;
    if (!lead.pecr_ok) {
      blocked.push(`${lead.company}: not confirmed as a limited company/LLP (PECR)`);
      continue;
    }
    if (!lead.email || (await isSuppressed(lead.email))) {
      blocked.push(`${lead.company}: no email or suppressed`);
      continue;
    }
    // The same address imported twice (two leads): only the first one gets a sequence.
    const twin = must(
      await db().from("leads").select("id,company").ilike("email", likeExact(lead.email)).neq("id", lead.id).not("status", "in", "(new,enriched,audited,ready,error)").limit(1),
    ) as { id: string; company: string }[];
    if (twin.length) {
      await setLead(id, { status: "error", last_error: `Duplicate: ${lead.email} is already being contacted as another lead (${twin[0].company}).` });
      blocked.push(`${lead.company}: same email as another lead already being contacted`);
      continue;
    }
    const campaign = await getCampaign(lead.campaign_id);
    if (!campaign) continue;
    const drafts = must(
      await db().from("messages").select("*").eq("lead_id", id).eq("status", "draft").order("step"),
    ) as Message[];
    if (!drafts.length) continue;
    const window = {
      startHour: campaign.send_window_start,
      endHour: campaign.send_window_end,
      days: campaign.send_days,
      timezone: campaign.timezone,
    };
    const stepDays = drafts.map((d) => campaign.steps[d.step ?? 0]?.day ?? 0);
    const times = planSequence(new Date(), stepDays, window, jitterFor(lead.id, drafts.length));
    for (let i = 0; i < drafts.length; i++) {
      must(
        await db()
          .from("messages")
          .update({ status: "scheduled", scheduled_for: times[i].toISOString() })
          .eq("id", drafts[i].id),
      );
    }
    await setLead(id, { status: "sequencing" });
    scheduled++;
  }
  return { scheduled, blocked };
}

/**
 * After a lead's email address is corrected: emails that failed to the old address (with none sent)
 * go back to draft and are scheduled again from now. Leads with emails already sent are left alone;
 * their remaining scheduled emails simply go to the new address.
 */
export async function requeueFailed(leadId: string): Promise<{ requeued: boolean; note: string }> {
  const lead = must(await db().from("leads").select("*").eq("id", leadId).single()) as Lead;
  const out = must(
    await db().from("messages").select("id,status").eq("lead_id", leadId).eq("direction", "out"),
  ) as Pick<Message, "id" | "status">[];
  const failed = out.filter((m) => m.status === "failed");
  if (!failed.length) return { requeued: false, note: "" };
  if (out.some((m) => m.status === "sent")) return { requeued: false, note: "Earlier emails were already sent, so the failed one was not re-sent." };
  if (!["sequencing", "error", "bounced"].includes(lead.status)) return { requeued: false, note: `Lead is "${lead.status}", so nothing was re-sent.` };
  const reset = out.filter((m) => ["failed", "scheduled"].includes(m.status)).map((m) => m.id);
  must(await db().from("messages").update({ status: "draft", error: null, scheduled_for: null }).in("id", reset));
  await setLead(leadId, { status: "ready", last_error: null });
  const r = await approveLeads([leadId]);
  if (r.scheduled) return { requeued: true, note: "Emails re-scheduled to the new address." };
  return { requeued: false, note: `Emails are back to draft but not scheduled: ${r.blocked.join("; ") || "approve them from this page"}.` };
}

// ---------- 6. send ----------

async function activeMailboxes(): Promise<(Mailbox & { sentToday: number })[]> {
  const boxes = must(await db().from("mailboxes").select("*").eq("active", true)) as Mailbox[];
  const out = [];
  for (const b of boxes) {
    const n = must(await db().rpc("mailbox_sent_today", { mb: b.id })) as number;
    out.push({ ...b, sentToday: n });
  }
  return out;
}

export async function sendDue(maxPerMailboxPerRun = 6) {
  const due = must(
    await db()
      .from("messages")
      .select("*")
      .eq("direction", "out")
      .eq("status", "scheduled")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for")
      .limit(50),
  ) as Message[];
  if (!due.length) return 0;
  const boxes = await activeMailboxes();
  const usedThisRun = new Map<string, number>();
  let sent = 0;

  for (const m of due) {
    const lead = must(await db().from("leads").select("*").eq("id", m.lead_id).single()) as Lead;
    if (lead.status !== "sequencing" || !lead.email || (await isSuppressed(lead.email))) {
      must(await db().from("messages").update({ status: "cancelled" }).eq("id", m.id));
      continue;
    }
    // Earlier steps must have gone first (keeps threads in order). Cancelled copies don't count either way.
    if ((m.step ?? 0) > 0) {
      const prev = must(
        await db().from("messages").select("id,status,message_id,mailbox_id,step").eq("lead_id", lead.id).eq("direction", "out").lt("step", m.step!),
      ) as Pick<Message, "id" | "status" | "message_id" | "mailbox_id" | "step">[];
      if (prev.some((p) => ["draft", "scheduled", "sending"].includes(p.status))) continue;
      if (!prev.some((p) => p.status === "sent")) continue;
    }
    // Never send the same step twice to one address (duplicate rows, or the same email on two leads).
    const already = must(
      await db().from("messages").select("id,leads!inner(email)").eq("direction", "out").eq("step", m.step ?? 0).in("status", ["sent", "sending"]).neq("id", m.id).ilike("leads.email", likeExact(lead.email)),
    ) as unknown[];
    if (already.length) {
      must(await db().from("messages").update({ status: "cancelled", error: "Duplicate: this step was already sent to this address" }).eq("id", m.id).eq("status", "scheduled"));
      continue;
    }
    const thread = must(
      await db().from("messages").select("message_id,mailbox_id").eq("lead_id", lead.id).eq("direction", "out").eq("status", "sent").order("step"),
    ) as { message_id: string; mailbox_id: string }[];

    // Sticky mailbox per lead; otherwise the least-used mailbox with capacity.
    const sticky = thread[0]?.mailbox_id;
    const capacity = (b: (typeof boxes)[number]) =>
      b.sentToday < b.daily_limit && (usedThisRun.get(b.id) ?? 0) < maxPerMailboxPerRun;
    const box = sticky
      ? boxes.find((b) => b.id === sticky && capacity(b))
      : boxes.filter(capacity).sort((a, b) => a.sentToday - b.sentToday)[0];
    if (!box) continue;
    // Claim the email before sending, so an overlapping run can't send it too.
    const claimed = must(await db().from("messages").update({ status: "sending" }).eq("id", m.id).eq("status", "scheduled").select("id")) as unknown[];
    if (!claimed.length) continue;

    const campaign = await getCampaign(m.campaign_id);
    const text = renderEmail({
      body: m.body_text ?? "",
      // The email's own id on its links, so a report view or booking click is credited to this email.
      auditUrl: trackedUrl(auditUrl(lead), m.id),
      bookingUrl: trackedUrl(bookingUrl(lead), m.id),
      signature: campaign?.signature || defaultSignature(),
      unsubscribeUrl: unsubscribeUrl(lead),
      identity: brand.identityLine,
    });
    try {
      const refs = thread.map((t) => t.message_id).filter(Boolean);
      const messageId = await sendMail(box, {
        to: lead.email,
        subject: m.subject ?? "",
        text,
        html: textToHtml(text, pixelUrl(m.id)),
        inReplyTo: refs.at(-1) ?? null,
        references: refs,
        unsubscribeUrl: `${env.appUrl}/api/public/unsubscribe/${lead.slug}`, // RFC 8058 one-click target
      });
      must(
        await db()
          .from("messages")
          .update({ status: "sent", sent_at: new Date().toISOString(), mailbox_id: box.id, message_id: messageId, body_text: text })
          .eq("id", m.id),
      );
      // Marks this email as tracked (emails sent before tracking existed have no opens to show).
      await db().from("events").insert({ lead_id: lead.id, type: "email_sent", meta: { message_id: m.id, step: m.step } });
      box.sentToday++;
      usedThisRun.set(box.id, (usedThisRun.get(box.id) ?? 0) + 1);
      sent++;
    } catch (e) {
      must(await db().from("messages").update({ status: "failed", error: (e as Error).message, mailbox_id: box.id }).eq("id", m.id));
      log("send failed", lead.email, (e as Error).message);
    }
  }
  return sent;
}

// ---------- 7. inbox ----------

export async function pollInboxes() {
  const boxes = must(await db().from("mailboxes").select("*").eq("active", true)) as Mailbox[];
  let stored = 0;
  for (const box of boxes) {
    let mails;
    try {
      mails = await fetchNewMail(box, box.imap_last_uid);
    } catch (e) {
      log("imap failed", box.email, (e as Error).message);
      continue;
    }
    let maxUid = box.imap_last_uid;
    for (const mail of mails) {
      maxUid = Math.max(maxUid, mail.uid);
      // Match to a lead: thread headers first, then sender address, then bounced recipient.
      const ids = [mail.inReplyTo, ...mail.references].filter(Boolean) as string[];
      let leadId: string | null = null;
      let campaignId: string | null = null;
      if (ids.length) {
        const hit = must(
          await db().from("messages").select("lead_id,campaign_id").in("message_id", ids).limit(1),
        ) as { lead_id: string; campaign_id: string | null }[];
        if (hit[0]) ({ lead_id: leadId, campaign_id: campaignId } = hit[0]);
      }
      const lookupEmail = mail.isBounce ? mail.bouncedRecipient : mail.from;
      if (!leadId && lookupEmail) {
        const l = must(await db().from("leads").select("id,campaign_id").ilike("email", lookupEmail).limit(1)) as {
          id: string;
          campaign_id: string | null;
        }[];
        if (l[0]) ({ id: leadId, campaign_id: campaignId } = l[0]);
      }
      if (!leadId) continue; // not a reply to outbound
      const auto = !mail.isBounce && isAutoReply(mail.subject, mail.text);
      must(
        await db().from("messages").insert({
          lead_id: leadId,
          campaign_id: campaignId,
          mailbox_id: box.id,
          direction: "in",
          subject: mail.subject,
          body_text: mail.isBounce ? mail.text.slice(0, 4000) : stripQuoted(mail.text),
          message_id: mail.messageId,
          in_reply_to: mail.inReplyTo,
          status: "received",
          received_at: mail.date.toISOString(),
          // Auto-replies ("we've received your email", out of office) are recognised here, without the AI,
          // and don't need answering; the sequence carries on.
          classification: mail.isBounce ? "bounce" : auto ? "out_of_office" : null,
          handled: auto ? true : undefined,
        }),
      );
      if (mail.isBounce) {
        await cancelPending(leadId);
        await setLead(leadId, { status: "bounced" });
        if (mail.bouncedRecipient) await suppress(mail.bouncedRecipient, "email", "bounced");
      } else if (!auto) {
        await alertNewReply(box, leadId, mail.subject, stripQuoted(mail.text)).catch((e) => log("reply alert failed", (e as Error).message));
      }
      stored++;
    }
    if (maxUid !== box.imap_last_uid) must(await db().from("mailboxes").update({ imap_last_uid: maxUid }).eq("id", box.id));
  }
  return stored;
}

/** Automatic acknowledgements and out-of-office replies, recognised from the subject and opening lines. */
export function isAutoReply(subject: string | null | undefined, body: string | null | undefined): boolean {
  const s = (subject ?? "").trim();
  if (/^(automatic reply|automated reply|auto[- ]?reply|autoreply|auto:|out of (the )?office|ooo\b|away from the office|on annual leave)/i.test(s)) return true;
  const head = (body ?? "").slice(0, 600).toLowerCase();
  return [
    "this is an automated",
    "this is an automatic",
    "automated response",
    "automatic reply",
    "your email has been delivered successfully",
    "please do not reply to this email",
    "i am currently out of the office",
    "i'm currently out of the office",
    "i am out of the office",
  ].some((p) => head.includes(p));
}

/** Email the team when a real reply lands (REPLY_NOTIFY_EMAIL, else REPORT_TO). */
async function alertNewReply(box: Mailbox, leadId: string, subject: string | null, text: string) {
  const to = process.env.REPLY_NOTIFY_EMAIL || env.reportTo();
  if (!to) return;
  const lead = must(await db().from("leads").select("company,email,first_name").eq("id", leadId).single()) as Pick<Lead, "company" | "email" | "first_name">;
  await sendMail(box, {
    to,
    replyTo: lead.email ?? undefined,
    subject: `New reply: ${lead.company}${subject ? ` (${subject.replace(/^(re:\s*)+/i, "")})` : ""}`,
    text: [
      `${lead.first_name ?? lead.company}${lead.email ? ` <${lead.email}>` : ""} replied:`,
      "",
      text.trim().slice(0, 2000),
      "",
      `Answer it in the inbox: ${env.appUrl}/inbox`,
      `Lead: ${env.appUrl}/leads/${leadId}`,
    ].join("\n"),
  });
}

// ---------- 8. triage replies ----------

export async function triageReplies(limit = 10) {
  const inbound = must(
    await db().from("messages").select("*").eq("direction", "in").is("classification", null).order("received_at").limit(limit),
  ) as Message[];
  for (const msg of inbound) {
    // Auto-replies need no AI and no answer, and don't stop the sequence.
    if (isAutoReply(msg.subject, msg.body_text)) {
      must(await db().from("messages").update({ classification: "out_of_office", handled: true }).eq("id", msg.id));
      continue;
    }
    const lead = must(await db().from("leads").select("*").eq("id", msg.lead_id).single()) as Lead;
    const campaign = await getCampaign(lead.campaign_id);
    const last = must(
      await db().from("messages").select("body_text").eq("lead_id", lead.id).eq("direction", "out").eq("status", "sent").order("sent_at", { ascending: false }).limit(1),
    ) as { body_text: string }[];
    try {
      const a = await analyseReply({ campaign, lead, ourLastEmail: last[0]?.body_text ?? null, reply: msg.body_text ?? "" });
      must(
        await db()
          .from("messages")
          .update({ classification: a.classification, draft_reply: a.draft_reply, handled: !a.draft_reply })
          .eq("id", msg.id),
      );
      // Any human reply stops the sequence. Auto-replies don't.
      if (a.classification !== "out_of_office") await cancelPending(lead.id);
      const next: Record<string, string> = {
        interested: "interested",
        question: "replied",
        not_now: "replied",
        not_interested: "not_interested",
        unsubscribe: "unsubscribed",
        bounce: "bounced",
        other: "replied",
      };
      if (next[a.classification] && !["meeting"].includes(lead.status)) {
        await setLead(lead.id, { status: next[a.classification] as Lead["status"], notes: a.summary });
      }
      if (a.classification === "unsubscribe" && lead.email) await suppress(lead.email, "email", "asked to stop");
      if (a.classification === "not_interested" && lead.email) await suppress(lead.email, "email", "not interested");
    } catch (e) {
      log("triage failed", msg.id, (e as Error).message);
    }
  }
  return inbound.length;
}

/** Send your (edited) answer to an inbound reply, in-thread, from the mailbox it arrived on. */
export async function sendReply(inboundId: string, text: string) {
  const msg = must(await db().from("messages").select("*").eq("id", inboundId).single()) as Message;
  const lead = must(await db().from("leads").select("*").eq("id", msg.lead_id).single()) as Lead;
  const box = must(await db().from("mailboxes").select("*").eq("id", msg.mailbox_id!).single()) as Mailbox;
  const campaign = await getCampaign(lead.campaign_id);
  if (!lead.email) throw new Error("Lead has no email");
  const thread = must(
    await db().from("messages").select("message_id").eq("lead_id", lead.id).not("message_id", "is", null).order("created_at"),
  ) as { message_id: string }[];
  const body = [humanise(text.replaceAll(BOOKING_TOKEN, bookingUrl(lead))), "", campaign?.signature || defaultSignature()].join("\n");
  const subject = msg.subject ? (/^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`) : "Re:";
  const messageId = await sendMail(box, {
    to: lead.email,
    subject,
    text: body,
    inReplyTo: msg.message_id,
    references: thread.map((t) => t.message_id),
  });
  must(
    await db().from("messages").insert({
      lead_id: lead.id,
      campaign_id: lead.campaign_id,
      mailbox_id: box.id,
      direction: "out",
      subject,
      body_text: body,
      message_id: messageId,
      in_reply_to: msg.message_id,
      status: "sent",
      sent_at: new Date().toISOString(),
    }),
  );
  must(await db().from("messages").update({ handled: true }).eq("id", inboundId));
}

export async function markMeeting(leadId: string) {
  await cancelPending(leadId);
  await setLead(leadId, { status: "meeting" });
  must(await db().from("events").insert({ lead_id: leadId, type: "meeting_booked" }));
}

export async function unsubscribeBySlug(slug: string): Promise<boolean> {
  const lead = must(await db().from("leads").select("*").eq("slug", slug).maybeSingle()) as Lead | null;
  if (!lead) return false;
  await cancelPending(lead.id);
  await setLead(lead.id, { status: "unsubscribed" });
  if (lead.email) await suppress(lead.email, "email", "unsubscribe link");
  return true;
}

// ---------- 9. weekly report ----------

export async function weeklyStats(days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  };
  const m = () => db().from("messages").select("id", { count: "exact", head: true });
  const [sent, replies, interested, meetings, views, clicks, bounces] = await Promise.all([
    // Every email that went out: sequence steps, inbox replies and audit report emails.
    count(m().eq("direction", "out").eq("status", "sent").gte("sent_at", since)),
    count(m().eq("direction", "in").neq("classification", "bounce").neq("classification", "out_of_office").gte("received_at", since)),
    count(m().eq("direction", "in").eq("classification", "interested").gte("received_at", since)),
    count(db().from("events").select("id", { count: "exact", head: true }).eq("type", "meeting_booked").gte("created_at", since)),
    count(db().from("events").select("id", { count: "exact", head: true }).eq("type", "page_view").gte("created_at", since)),
    count(db().from("events").select("id", { count: "exact", head: true }).eq("type", "booking_click").gte("created_at", since)),
    count(m().eq("direction", "in").eq("classification", "bounce").gte("received_at", since)),
  ]);
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
  return { sent, replies, interested, meetings, views, clicks, bounces, replyRate: pct(replies, sent), bounceRate: pct(bounces, sent) };
}

export async function sendWeeklyReport() {
  const to = env.reportTo();
  if (!to) return null;
  const s = await weeklyStats();
  const waiting = must(
    await db().from("messages").select("id", { count: "exact", head: false }).eq("direction", "in").eq("handled", false),
  ) as unknown[];
  const box = (must(await db().from("mailboxes").select("*").eq("active", true).limit(1)) as Mailbox[])[0];
  if (!box) return null;
  const text = `Outbound, last 7 days

Sent: ${s.sent}
Replies: ${s.replies} (${s.replyRate})
Interested: ${s.interested}
Meetings booked: ${s.meetings}
Audit page views: ${s.views}
Booking link clicks: ${s.clicks}
Bounces: ${s.bounces} (${s.bounceRate})${s.sent && s.bounces / s.sent > 0.03 ? "  <-- over 3%: pause and clean your list" : ""}

Replies waiting for you: ${waiting.length}
${env.appUrl}/inbox`;
  await sendMail(box, { to, subject: `Outbound weekly: ${s.sent} sent, ${s.replies} replies, ${s.meetings} meetings`, text });
  return s;
}

// ---------- tick ----------

/** One bounded pass of the whole pipeline. Called by cron every ~10 minutes. */
export async function tick() {
  const started = Date.now();
  const result: Record<string, number | string> = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      result[name] = await fn();
    } catch (e) {
      result[name] = `error: ${(e as Error).message}`;
      log(name, e);
    }
  };
  await step("polled", pollInboxes);
  await step("triaged", () => triageReplies());
  await step("sent", () => sendDue());
  await step("enriched", () => enrichLeads());
  await step("audited", () => auditLeads());
  await step("written", () => writeEmails());
  await step("pecrRechecked", () => recheckPecr());
  await step("autoApproved", () => autoApproveReady());
  result.ms = Date.now() - started;
  return result;
}
