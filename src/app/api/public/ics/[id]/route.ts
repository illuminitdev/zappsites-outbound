import { buildIcs } from "@/lib/booking/slots";
import { brand } from "@/lib/brand";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Downloadable calendar file for a booking (linked from the confirmation page). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data: b } = await db().from("bookings").select("*").eq("id", id).maybeSingle();
  if (!b) return new Response("Not found", { status: 404 });
  const start = new Date(b.start_at);
  const minutes = Math.round((new Date(b.end_at).getTime() - start.getTime()) / 60000);
  const video = process.env.BOOKING_VIDEO_URL?.trim();
  const ics = buildIcs({
    uid: `${b.id}@${new URL(env.appUrl).hostname}`,
    start,
    minutes,
    summary: `${brand.name} call${b.company ? ` with ${b.company}` : ""}`,
    description: b.method === "video" && video ? `Video call: ${video}` : `${brand.person} will call you on ${b.phone ?? "your number"}`,
    organizerEmail: brand.email,
    organizerName: `${brand.person}, ${brand.name}`,
    attendeeEmail: b.email,
    location: b.method === "video" && video ? video : b.phone ? `Phone: ${b.phone}` : undefined,
  });
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="zappsites-call.ics"` },
  });
}
