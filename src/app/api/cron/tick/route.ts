import { after } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { tick } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  // ?background=1: reply at once and run the tick after the response. For external
  // schedulers (e.g. cron-job.org) whose request timeout is shorter than a tick.
  if (new URL(req.url).searchParams.get("background") === "1") {
    after(async () => {
      const r = await tick();
      console.log("[cron/tick background]", JSON.stringify(r));
    });
    return Response.json({ started: true }, { status: 202 });
  }

  return Response.json(await tick());
}
