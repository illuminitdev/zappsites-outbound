// Fix lead emails saved with junk from mailto: links (e.g. "%20info@site.co.uk"), then put leads whose
// emails failed because of it back in the queue: `npx tsx scripts/email-fix.mts`
// Add --dry to only print what would change.
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");

const { db, must } = await import("../src/lib/db");
const { cleanEmail, isValidSyntax, hasMx } = await import("../src/lib/leads/email");
const { approveLeads } = await import("../src/lib/pipeline");
const dry = process.argv.includes("--dry");

type Row = { id: string; company: string; email: string; email_status: string; status: string };
type Msg = { id: string; step: number | null; status: string; error: string | null };

const leads: Row[] = [];
for (let from = 0; ; from += 1000) {
  const rows = must(
    await db().from("leads").select("id,company,email,email_status,status").not("email", "is", null).order("id").range(from, from + 999),
  ) as Row[];
  leads.push(...rows);
  if (rows.length < 1000) break;
}
const bad = leads.filter((l) => cleanEmail(l.email) !== l.email || !isValidSyntax(l.email));
console.log(`${leads.length} leads with an email, ${bad.length} need fixing${dry ? " (dry run, nothing saved)" : ""}\n`);

let fixed = 0;
let requeued = 0;
for (const lead of bad) {
  const email = cleanEmail(lead.email);
  if (!isValidSyntax(email)) {
    console.log(`SKIP  ${lead.company}: "${lead.email}" -> "${email}" still not a valid address, fix by hand`);
    continue;
  }
  const mx = await hasMx(email.split("@")[1]);
  console.log(`FIX   ${lead.company} [${lead.status}]: "${lead.email}" -> "${email}"${mx ? "" : " (no MX record: marked invalid)"}`);
  if (!dry) must(await db().from("leads").update({ email, email_status: mx ? "valid" : "invalid" }).eq("id", lead.id));
  fixed++;
  if (!mx) continue;

  // Emails that failed to the bad address, with none sent: back to draft and re-scheduled.
  const out = must(
    await db().from("messages").select("id,step,status,error").eq("lead_id", lead.id).eq("direction", "out").order("step"),
  ) as Msg[];
  const failed = out.filter((m) => m.status === "failed");
  if (!failed.length || out.some((m) => m.status === "sent") || !["sequencing", "error", "bounced"].includes(lead.status)) continue;
  for (const m of failed) console.log(`      step ${(m.step ?? 0) + 1} had failed: ${m.error ?? "no error saved"}`);
  const reset = out.filter((m) => ["failed", "scheduled"].includes(m.status));
  console.log(`      -> re-scheduling ${reset.length} email(s)`);
  if (dry) continue;
  must(await db().from("messages").update({ status: "draft", error: null, scheduled_for: null }).in("id", reset.map((m) => m.id)));
  must(await db().from("leads").update({ status: "ready", last_error: null }).eq("id", lead.id));
  const r = await approveLeads([lead.id]);
  if (r.scheduled) {
    const next = must(
      await db().from("messages").select("scheduled_for").eq("lead_id", lead.id).eq("status", "scheduled").order("scheduled_for").limit(1),
    ) as { scheduled_for: string }[];
    console.log(`      scheduled, first email ${next[0]?.scheduled_for ?? "?"}`);
    requeued++;
  } else console.log(`      NOT scheduled: ${r.blocked.join("; ") || "left as ready (approve it from the lead page)"}`);
}
console.log(`\n${fixed} email(s) fixed, ${requeued} lead(s) re-scheduled${dry ? " (dry run)" : ""}`);
