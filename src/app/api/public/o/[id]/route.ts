import { db } from "@/lib/db";
import { BOT_UA, SCANNER_GRACE_MS, TRANSPARENT_GIF, messageIdFrom } from "@/lib/tracking";

export const dynamic = "force-dynamic";

const gif = () =>
  new Response(new Uint8Array(TRANSPARENT_GIF), {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache" },
  });

/** Open-tracking image in sequence emails: records an "email_open" for that email, always returns a 1x1 GIF. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = messageIdFrom((await ctx.params).id.replace(/\.gif$/i, ""));
  const ua = req.headers.get("user-agent") ?? "";
  if (!id || BOT_UA.test(ua)) return gif();
  try {
    const { data: m } = await db().from("messages").select("lead_id,sent_at").eq("id", id).eq("direction", "out").maybeSingle();
    // Mail servers often fetch images the moment an email arrives; that isn't the person opening it.
    if (m?.sent_at && Date.now() - new Date(m.sent_at).getTime() > SCANNER_GRACE_MS) {
      await db().from("events").insert({ lead_id: m.lead_id, type: "email_open", meta: { message_id: id, ua: ua.slice(0, 200) } });
    }
  } catch {
    /* never break the image */
  }
  return gif();
}
