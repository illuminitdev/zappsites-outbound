import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Tracked "Book a call" link: records the click, then opens the built-in booking page on our domain. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const { data: lead } = await db().from("leads").select("id,campaign_id").eq("slug", slug).maybeSingle();
  if (!lead) return Response.redirect(new URL("/book", req.url), 302);
  await db().from("events").insert({ lead_id: lead.id, type: "booking_click" });
  const { data: campaign } = await db().from("campaigns").select("booking_url").eq("id", lead.campaign_id).maybeSingle();
  // An external link on the campaign overrides the built-in page (leave it empty to keep everything on your domain).
  const external = campaign?.booking_url?.trim();
  return Response.redirect(external || new URL(`/book/${slug}`, req.url), 302);
}
