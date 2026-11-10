import { unsubscribeBySlug } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/** RFC 8058 one-click unsubscribe (mail clients POST here from the List-Unsubscribe header). */
export async function POST(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  await unsubscribeBySlug(slug);
  return new Response("Unsubscribed", { status: 200 });
}
