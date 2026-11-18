// Fill in Google PageSpeed (mobile speed, load time) on audits saved without it:
// `npx tsx scripts/pagespeed-backfill.mts`  (needs PAGESPEED_API_KEY in .env; --dry to preview)
// The overall score and top issues are left as they were, so an email already sent still matches its page.
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");

const { db, must } = await import("../src/lib/db");
const { pageSpeed, perfCheck } = await import("../src/lib/audit");
type Audit = import("../src/lib/types").Audit;
const dry = process.argv.includes("--dry");
if (!process.env.PAGESPEED_API_KEY) {
  console.error("PAGESPEED_API_KEY is not set in .env: Google's shared quota will refuse these calls.");
  process.exit(1);
}

const leads = must(
  await db().from("leads").select("id,company,audit").not("audit", "is", null).is("audit->performance->>mobileScore", null),
) as { id: string; company: string; audit: Audit }[];

let filled = 0;
for (const lead of leads) {
  const a = lead.audit;
  if (!a.reachable || !a.url) continue;
  const perf = await pageSpeed(a.url);
  console.log(`${lead.company}: mobile ${perf.mobileScore ?? "–"}, load ${perf.lcpSeconds ?? "–"}s`);
  if (perf.mobileScore === null) continue;
  const pc = perfCheck(perf);
  const checks = a.checks.filter((c) => c.id !== "mobile_speed");
  const ai = checks.findIndex((c) => c.id === "ai_mentions");
  if (pc) checks.splice(ai === 0 ? 1 : 0, 0, pc);
  filled++;
  if (!dry) must(await db().from("leads").update({ audit: { ...a, performance: perf, checks } }).eq("id", lead.id));
}
console.log(`\n${filled} of ${leads.length} audits filled${dry ? " (dry run, nothing saved)" : ""}`);
