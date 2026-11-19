
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");

const { db, must } = await import("../src/lib/db");
const { auditSubject, threadSubject } = await import("../src/lib/sequence/render");
const dry = process.argv.includes("--dry");

type Msg = { id: string; lead_id: string; step: number | null; status: string; subject: string | null };
type L = { id: string; company: string; domain: string | null; website: string | null };

const msgs: Msg[] = [];
for (let from = 0; ; from += 1000) {
  const rows = must(
    await db().from("messages").select("id,lead_id,step,status,subject").eq("direction", "out").in("status", ["draft", "scheduled", "sent", "sending"]).order("id").range(from, from + 999),
  ) as Msg[];
  msgs.push(...rows);
  if (rows.length < 1000) break;
}
const byLead = new Map<string, Msg[]>();
for (const m of msgs) byLead.set(m.lead_id, [...(byLead.get(m.lead_id) ?? []), m]);

let changed = 0;
let kept = 0;
for (const [leadId, list] of byLead) {
  const pending = list.filter((m) => ["draft", "scheduled"].includes(m.status));
  if (!pending.length) continue;
  if (list.some((m) => ["sent", "sending"].includes(m.status))) {
    kept++;
    continue;
  }
  const lead = must(await db().from("leads").select("id,company,domain,website").eq("id", leadId).single()) as L;
  const subject = auditSubject(lead);
  const todo = pending.filter((m) => m.subject !== threadSubject(subject, m.step ?? 0));
  if (!todo.length) continue;
  console.log(`${lead.company}: "${todo[0].subject}" -> "${threadSubject(subject, todo[0].step ?? 0)}" (${todo.length} email${todo.length > 1 ? "s" : ""})`);
  if (!dry) for (const m of todo) must(await db().from("messages").update({ subject: threadSubject(subject, m.step ?? 0) }).eq("id", m.id));
  changed += todo.length;
}
console.log(`\n${changed} unsent email(s) updated, ${kept} lead(s) mid-thread left as they are${dry ? " (dry run, nothing saved)" : ""}`);
