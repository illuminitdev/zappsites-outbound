// Re-run the PECR company check on leads still marked "unknown": `npx tsx scripts/pecr-backfill.mts`
// Add --dry to only print what would change.
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");

const { db, must } = await import("../src/lib/db");
const { resolveEntity } = await import("../src/lib/pipeline");
const dry = process.argv.includes("--dry");

const leads = must(
  await db()
    .from("leads")
    .select("id,company,website,source_ref,status")
    .eq("entity_type", "unknown")
    .in("status", ["enriched", "audited", "ready"]),
) as { id: string; company: string; website: string | null; source_ref: string | null; status: string }[];

let confirmed = 0;
for (const lead of leads) {
  const patch = await resolveEntity(lead);
  const label = patch.entity_type ? `${patch.entity_type} (${patch.source_ref}) pecr_ok=${patch.pecr_ok}` : "not found";
  console.log(`${lead.status.padEnd(8)} ${lead.company} -> ${label}`);
  if (!patch.entity_type) continue;
  if (patch.pecr_ok) confirmed++;
  if (!dry) must(await db().from("leads").update(patch).eq("id", lead.id));
}
console.log(`\n${leads.length} checked, ${confirmed} confirmed as Ltd/LLP${dry ? " (dry run, nothing saved)" : ""}`);
