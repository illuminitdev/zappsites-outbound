// Long-running alternative to Vercel cron (Railway, Fly, a VPS): `npm run worker`.
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");

const { tick, sendWeeklyReport } = await import("../src/lib/pipeline");
const EVERY_MS = 10 * 60 * 1000;
let lastReportWeek = -1;

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

for (;;) {
  try {
    console.log(new Date().toISOString(), await tick());
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() >= 7 && isoWeek(now) !== lastReportWeek) {
      await sendWeeklyReport();
      lastReportWeek = isoWeek(now);
    }
  } catch (e) {
    console.error(e);
  }
  await new Promise((r) => setTimeout(r, EVERY_MS));
}
