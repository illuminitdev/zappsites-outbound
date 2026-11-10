"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db, must } from "@/lib/db";
import { createBooking } from "@/lib/booking";
import { createInboundCheck, runInboundAudit } from "@/lib/inbound";
import { parseLeadsCsv } from "@/lib/leads/csv";
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
import type { Step } from "@/lib/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, msg: string) => redirect(`${path}?msg=${encodeURIComponent(msg)}`);

export async function runTick() {
  const r = await tick();
  revalidatePath("/");
  back("/", `Pipeline ran: ${JSON.stringify(r)}`);
}

// ---- campaigns ----

export async function saveCampaign(f: FormData) {
  let steps: Step[];
  try {
    steps = JSON.parse(str(f, "steps") || "[]");
    if (!Array.isArray(steps) || !steps.length || steps.some((s) => typeof s.day !== "number" || !s.instructions)) throw new Error();
  } catch {
    back("/campaigns", 'Steps must be JSON like [{"day":0,"instructions":"..."}]');
    return;
  }
  const row = {
    name: str(f, "name"),
    offer: str(f, "offer"),
    icp: str(f, "icp"),
    proof: str(f, "proof"),
    tone: str(f, "tone") || "plain, direct, British English, no hype",
    booking_url: str(f, "booking_url"),
    signature: str(f, "signature"),
    aeo_category: str(f, "aeo_category"),
    aeo_prompts: str(f, "aeo_prompts").split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    steps,
    send_window_start: Number(str(f, "send_window_start") || 8),
    send_window_end: Number(str(f, "send_window_end") || 17),
    auto_approve: f.get("auto_approve") === "on",
    active: f.get("active") === "on",
  };
  const id = str(f, "id");
  if (id) must(await db().from("campaigns").update(row).eq("id", id));
  else must(await db().from("campaigns").insert(row));
  revalidatePath("/campaigns");
  back("/campaigns", "Campaign saved");
}

// ---- mailboxes ----

export async function saveMailbox(f: FormData) {
  const row = {
    email: str(f, "email").toLowerCase(),
    from_name: str(f, "from_name"),
    smtp_host: str(f, "smtp_host"),
    smtp_port: Number(str(f, "smtp_port") || 465),
    smtp_user: str(f, "smtp_user") || str(f, "email"),
    smtp_pass: str(f, "smtp_pass"),
    imap_host: str(f, "imap_host"),
    imap_port: Number(str(f, "imap_port") || 993),
    daily_limit: Number(str(f, "daily_limit") || 30),
  };
  must(await db().from("mailboxes").upsert(row, { onConflict: "email" }));
  revalidatePath("/mailboxes");
  back("/mailboxes", "Mailbox saved");
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
