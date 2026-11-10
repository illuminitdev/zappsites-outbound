import { cronAuthorized } from "@/lib/cron";
import { sendWeeklyReport } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json({ report: await sendWeeklyReport() });
}
