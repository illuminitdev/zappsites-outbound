import { db } from "@/lib/db";
import { BOT_UA, messageIdFrom } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/** Tracked "Book a call" link: records the click, then opens the built-in booking page on our domain. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const { data: lead } = await db().from("leads").select("id,campaign_id").eq("slug", slug).maybeSingle();
  if (!lead) return Response.redirect(new URL("/book", req.url), 302);
  // ?m= is the email the link came from (sequence emails), so the click is credited to that email.
  const m = messageIdFrom(new URL(req.url).searchParams.get("m"));
  // Link scanners (Safe Links, Mimecast...) follow links automatically; only count people.
  if (!BOT_UA.test(req.headers.get("user-agent") ?? "")) {
    await db().from("events").insert({ lead_id: lead.id, type: "booking_click", meta: m ? { message_id: m } : {} });
  }
  const { data: campaign } = await db().from("campaigns").select("booking_url").eq("id", lead.campaign_id).maybeSingle();
  // An external link on the campaign overrides the built-in page (leave it empty to keep everything on your domain).
  const external = campaign?.booking_url?.trim();
  return Response.redirect(external || new URL(`/book/${slug}`, req.url), 302);
}
