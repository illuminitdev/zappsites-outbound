"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db, must } from "@/lib/db";
import { createBooking } from "@/lib/booking";
import { createInboundCheck, runInboundAudit, sendReport, tradeById } from "@/lib/inbound";
import { runAudit } from "@/lib/audit";
import { parseLeadsCsv } from "@/lib/leads/csv";
import { verifySmtp } from "@/lib/mail/send";
import {
  approveLeads,
  importFromCompaniesHouse,
  importFromPlaces,
  importLeads,
  markMeeting,
  sendReply,
  tick,
  unsubscribeBySlug,
} from "@/lib/pipeline";
import type { Lead, Step } from "@/lib/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string) => redirect(`${path}?msg=${encodeURIComponent(msg)}`);

export async function runTick() {
  const r = await tick();
  revalidatePath("/");
  back("/", `Pipeline ran: ${JSON.stringify(r)}`);
}

// ---- campaigns ----

/**
 * The form only shows the fields a campaign needs. Anything it doesn't send (sequence steps,
 * send window, tone, signature, etc.) keeps its current value, or the database default for a new campaign.
 */
export async function saveCampaign(f: FormData) {
  const row: Record<string, unknown> = {
    name: str(f, "name"),
    offer: str(f, "offer"),
    icp: str(f, "icp"),
    proof: str(f, "proof"),
    aeo_category: str(f, "aeo_category"),
  };
  if (f.has("steps")) {
    let steps: Step[];
    try {
      steps = JSON.parse(str(f, "steps") || "[]");
      if (!Array.isArray(steps) || !steps.length || steps.some((s) => typeof s.day !== "number" || !s.instructions)) throw new Error();
    } catch {
      back("/campaigns", 'Steps must be JSON like [{"day":0,"instructions":"..."}]');
      return;
    }
    row.steps = steps;
  }
  for (const k of ["tone", "booking_url", "signature"]) if (f.has(k)) row[k] = str(f, k);
  if (f.has("aeo_prompts")) row.aeo_prompts = str(f, "aeo_prompts").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const k of ["send_window_start", "send_window_end"]) if (f.has(k)) row[k] = Number(str(f, k));

  const id = str(f, "id");
  if (id) must(await db().from("campaigns").update(row).eq("id", id));
  else must(await db().from("campaigns").insert({ ...row, active: true })); // new campaigns start running
  revalidatePath("/campaigns");
  back("/campaigns", "Campaign saved");
}

export async function setCampaignActive(f: FormData) {
  const active = str(f, "active") === "true";
  must(await db().from("campaigns").update({ active }).eq("id", str(f, "id")));
  revalidatePath("/campaigns");
  back("/campaigns", active ? "Campaign resumed" : "Campaign paused");
}

// ---- mailboxes ----

const PROVIDERS: Record<string, { smtp_host: string; smtp_port: number; imap_host: string; imap_port: number }> = {
  google: { smtp_host: "smtp.gmail.com", smtp_port: 465, imap_host: "imap.gmail.com", imap_port: 993 },
  microsoft: { smtp_host: "smtp.office365.com", smtp_port: 587, imap_host: "outlook.office365.com", imap_port: 993 },
};

export async function saveMailbox(f: FormData) {
  let msg: string;
  try {
    const email = str(f, "email").toLowerCase();
    const id = str(f, "id");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address");
    const preset = PROVIDERS[str(f, "provider")];
    const servers = preset ?? {
      smtp_host: str(f, "smtp_host"),
      smtp_port: Number(str(f, "smtp_port") || 465),
      imap_host: str(f, "imap_host"),
      imap_port: Number(str(f, "imap_port") || 993),
    };
    if (!servers.smtp_host || !servers.imap_host) throw new Error("Enter the SMTP and IMAP hosts");

    // Editing: a blank password keeps the saved one.
    let smtp_pass = str(f, "smtp_pass").replace(/\s+/g, "");
    if (!smtp_pass && id) {
      const old = must(await db().from("mailboxes").select("smtp_pass").eq("id", id).maybeSingle()) as { smtp_pass: string } | null;
      smtp_pass = old?.smtp_pass ?? "";
    }
    if (!smtp_pass) throw new Error("Enter the app password");

    const row = {
      email,
      from_name: str(f, "from_name") || email.split("@")[0],
      ...servers,
      smtp_user: str(f, "smtp_user") || email,
      smtp_pass,
      daily_limit: Math.min(200, Math.max(1, Number(str(f, "daily_limit") || 30))),
    };
    await verifySmtp(row);
    if (id) must(await db().from("mailboxes").update(row).eq("id", id));
    else must(await db().from("mailboxes").upsert(row, { onConflict: "email" }));
    revalidatePath("/mailboxes");
    msg = id ? "Mailbox updated" : "Mailbox connected";
  } catch (e) {
    msg = `Couldn't save mailbox: ${(e as Error).message}`;
  }
  back("/mailboxes", msg);
}

export async function toggleMailbox(f: FormData) {
  must(await db().from("mailboxes").update({ active: f.get("active") === "true" }).eq("id", str(f, "id")));
  revalidatePath("/mailboxes");
}

// ---- leads ----

export async function importCsv(f: FormData) {
  const file = f.get("file") as File | null;
  if (!file || !file.size) return back("/leads", "Choose a CSV file");
  const { leads, skipped } = parseLeadsCsv(await file.text());
  const r = await importLeads(str(f, "campaign_id") || null, leads);
  back("/leads", `Imported ${r.inserted}, ${r.duplicates} duplicates, ${skipped} rows skipped (need company + website or email)`);
}

export async function importPlaces(f: FormData) {
  let msg: string;
  try {
    const r = await importFromPlaces(str(f, "campaign_id") || null, str(f, "query"), Number(str(f, "max") || 60));
    msg = `Places: ${r.found} found, ${r.inserted} imported, ${r.duplicates} duplicates, ${r.noWebsite} had no website`;
  } catch (e) {
    msg = `Places import failed: ${(e as Error).message}`;
  }
  back("/leads", msg);
}

export async function importCompaniesHouse(f: FormData) {
  let msg: string;
  try {
    const r = await importFromCompaniesHouse(str(f, "campaign_id") || null, {
      sicCodes: str(f, "sic").split(/[,\s]+/).filter(Boolean),
      incorporatedFrom: str(f, "from"),
      location: str(f, "location") || undefined,
      size: Number(str(f, "size") || 100),
    });
    msg = `Companies House: ${r.found} found, ${r.inserted} imported`;
  } catch (e) {
    msg = `Companies House import failed: ${(e as Error).message}`;
  }
  back("/leads", msg);
}

export async function approveSelected(f: FormData) {
  const ids = f.getAll("lead").map(String);
  if (!ids.length) return back("/leads?status=ready", "Select leads to approve");
  const r = await approveLeads(ids);
  back("/leads", `Scheduled ${r.scheduled}.${r.blocked.length ? ` Blocked: ${r.blocked.join("; ")}` : ""}`);
}

export async function confirmPecr(f: FormData) {
  const id = str(f, "id");
  must(await db().from("leads").update({ pecr_ok: true, entity_type: str(f, "entity_type") || "company" }).eq("id", id));
  revalidatePath(`/leads/${id}`);
}

export async function resetLead(f: FormData) {
  const id = str(f, "id");
  const patch: Record<string, unknown> = { status: "new", last_error: null };
  if (str(f, "website")) patch.website = str(f, "website");
  if (str(f, "email")) patch.email = str(f, "email").toLowerCase();
  must(await db().from("messages").delete().eq("lead_id", id).eq("status", "draft"));
  must(await db().from("leads").update(patch).eq("id", id));
  back(`/leads/${id}`, "Lead reset; it will be re-processed on the next run");
}

export async function saveDraft(f: FormData) {
  const id = str(f, "id");
  must(await db().from("messages").update({ subject: str(f, "subject"), body_text: str(f, "body") }).eq("id", id).in("status", ["draft", "scheduled"]));
  revalidatePath(`/leads/${str(f, "lead_id")}`);
}

export async function approveOne(f: FormData) {
  const id = str(f, "id");
  const r = await approveLeads([id]);
  back(`/leads/${id}`, r.scheduled ? "Scheduled" : `Not scheduled: ${r.blocked.join("; ") || "lead is not in 'ready' state"}`);
}

export async function meetingBooked(f: FormData) {
  const id = str(f, "id");
  await markMeeting(id);
  back(`/leads/${id}`, "Marked as meeting booked; sequence stopped");
}

// ---- manual audit (admin): run it, preview the email, then send ----

export async function createManualAudit(f: FormData) {
  let target: string;
  try {
    const lead = await createInboundCheck({
      website: str(f, "website"),
      company: str(f, "company"),
      trade: str(f, "trade"),
      town: str(f, "town"),
      name: str(f, "name"),
      email: str(f, "email"),
      phone: null,
      gclid: null,
    });
    must(await db().from("leads").update({ source: "manual" }).eq("id", lead.id));
    const trade = tradeById(str(f, "trade"));
    try {
      const audit = await runAudit(lead.website!, { company: lead.company, domain: lead.domain, city: lead.city, category: trade?.category ?? "" });
      must(
        await db()
          .from("leads")
          .update({ audit, audit_score: audit.score, audited_at: audit.fetchedAt, aeo_mention_rate: audit.aeo?.mentionRate ?? null, status: "audited" })
          .eq("id", lead.id),
      );
      target = `/leads/${lead.id}?msg=${encodeURIComponent("Audit ready. Check the email below, then send it.")}#send-report`;
    } catch (e) {
      await db().from("leads").update({ status: "error", last_error: `Audit: ${(e as Error).message}` }).eq("id", lead.id);
      target = `/leads/${lead.id}?msg=${encodeURIComponent("The audit failed. See the error on this page.")}`;
    }
  } catch (e) {
    return back("/leads", `Couldn't start the audit: ${(e as Error).message}`);
  }
  redirect(target);
}

export async function sendReportAction(f: FormData) {
  const id = str(f, "id");
  try {
    const to = str(f, "to").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error("Enter a valid recipient email");
    if (!str(f, "subject") || !str(f, "body")) throw new Error("Subject and message can't be empty");
    const lead = must(await db().from("leads").select("*").eq("id", id).single()) as Lead;
    await sendReport(lead, { to, subject: str(f, "subject"), text: String(f.get("body") ?? "") });
  } catch (e) {
    return back(`/leads/${id}`, `Not sent: ${(e as Error).message}`);
  }
  revalidatePath(`/leads/${id}`);
  back(`/leads/${id}`, "Report email sent");
}

// ---- inbox ----

export async function replyAction(f: FormData) {
  try {
    await sendReply(str(f, "id"), str(f, "body"));
  } catch (e) {
    return back("/inbox", `Send failed: ${(e as Error).message}`);
  }
  back("/inbox", "Reply sent");
}

export async function markHandled(f: FormData) {
  must(await db().from("messages").update({ handled: true }).eq("id", str(f, "id")));
  revalidatePath("/inbox");
}

// ---- public ----

export async function startCheck(f: FormData) {
  let slug: string;
  try {
    const lead = await createInboundCheck({
      website: str(f, "website"),
      company: str(f, "company"),
      trade: str(f, "trade"),
      town: str(f, "town"),
      name: str(f, "name"),
      email: str(f, "email"),
      phone: str(f, "phone") || null,
      gclid: str(f, "gclid") || null,
    });
    slug = lead.slug;
    // Audit runs after the response is sent; the holding page polls until it's done.
    after(() => runInboundAudit(lead, str(f, "trade")));
  } catch (e) {
    const trade = str(f, "trade");
    redirect(`/check?${new URLSearchParams({ error: (e as Error).message, ...(trade ? { trade } : {}) })}`);
  }
  redirect(`/check/${slug}`);
}

export async function bookCall(f: FormData) {
  const back = str(f, "back") || "/book";
  let id: string;
  try {
    id = await createBooking({
      slot: str(f, "slot"),
      name: str(f, "name"),
      email: str(f, "email"),
      phone: str(f, "phone") || null,
      company: str(f, "company") || null,
      method: str(f, "method") === "video" ? "video" : "phone",
      note: str(f, "note") || null,
      leadSlug: str(f, "lead") || null,
    });
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/book/done?b=${id}`);
}

export async function confirmUnsubscribe(f: FormData) {
  const slug = str(f, "slug");
  await unsubscribeBySlug(slug);
  redirect(`/u/${slug}?done=1`);
}
