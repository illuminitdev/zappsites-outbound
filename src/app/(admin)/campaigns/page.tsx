import { saveCampaign } from "@/app/actions";
import { Flash } from "@/components/ui";
import { db, must } from "@/lib/db";
import { DEFAULT_AEO_PROMPTS } from "@/lib/audit/mentions";

const isLegacy = (p?: string[]) => !p?.length || (p.length === DEFAULT_AEO_PROMPTS.length && p.every((x, i) => x === DEFAULT_AEO_PROMPTS[i]));
import type { Campaign } from "@/lib/types";

const DEFAULT_STEPS = JSON.stringify(
  [
    { day: 0, instructions: "Open with the single most costly finding from their audit. Link their audit page. Ask for a 15 minute call." },
    { day: 3, instructions: "Short bump. Add one different finding. Same ask." },
    { day: 7, instructions: "Break-up email. Offer to send the full fix list. No pressure." },
  ],
  null,
  2,
);

function CampaignForm({ c }: { c?: Campaign }) {
  return (
    <form action={saveCampaign} className="card">
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="row">
        <div>
          <label>Name</label>
          <input name="name" required defaultValue={c?.name} placeholder="Trade insurance brokers: AI visibility" />
        </div>
        <div>
          <label>External booking link (optional; leave empty to use your built-in /book page)</label>
          <input name="booking_url" type="url" defaultValue={c?.booking_url} placeholder="Empty = audit.zappsites.com/book" />
        </div>
      </div>
      <label>Offer: what you sell, in one or two sentences</label>
      <textarea name="offer" required defaultValue={c?.offer} placeholder="Fixed-price AEO audit and fix plan: make your firm show up when trades ask ChatGPT or Google for insurance. £X, delivered in 5 days." />
      <label>Who it is for</label>
      <input name="icp" required defaultValue={c?.icp} placeholder="Independent UK commercial insurance brokers specialising in trades, 2-50 staff" />
      <label>Proof Claude may use (only true statements; leave empty if none yet)</label>
      <textarea name="proof" defaultValue={c?.proof} placeholder="Built and run SEO Stack, an SEO data platform used by agencies." />
      <div className="row">
        <div>
          <label>Tone</label>
          <input name="tone" defaultValue={c?.tone ?? "plain, direct, British English, no hype"} />
        </div>
        <div>
          <label>Signature (optional)</label>
          <textarea name="signature" style={{ minHeight: 60 }} defaultValue={c?.signature} placeholder={"Leave empty for: Ram\nZappSites · 020 3488 6301"} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>AEO/GEO category: what buyers ask AI for (empty = skip the AI mentions audit)</label>
          <input name="aeo_category" defaultValue={c?.aeo_category} placeholder="commercial insurance brokers for tradespeople" />
        </div>
        <div>
          <label>AI questions (leave empty to write them from each lead&apos;s own services). One per line; {"{service}"}, {"{category}"}, {"{city}"} work.</label>
          <textarea
            name="aeo_prompts"
            style={{ minHeight: 90 }}
            defaultValue={isLegacy(c?.aeo_prompts) ? "" : c!.aeo_prompts.join("\n")}
            placeholder={"Empty = automatic: we read each lead's website and ask about the services they list.\nOr use {service}, e.g.\nWho's the best company for {service} in {city}?"}
          />
        </div>
      </div>
      <label>Sequence steps (JSON): day = days after the first email</label>
      <textarea name="steps" style={{ minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: 13 }} defaultValue={c ? JSON.stringify(c.steps, null, 2) : DEFAULT_STEPS} />
      <div className="row3">
        <div>
          <label>Send from (hour, UK time)</label>
          <input name="send_window_start" type="number" min={0} max={23} defaultValue={c?.send_window_start ?? 8} />
        </div>
        <div>
          <label>Send until (hour, UK time)</label>
          <input name="send_window_end" type="number" min={1} max={24} defaultValue={c?.send_window_end ?? 17} />
        </div>
        <div>
          <label>&nbsp;</label>
          <span>Mon–Fri only</span>
        </div>
      </div>
      <label>
        <input type="checkbox" name="auto_approve" defaultChecked={c?.auto_approve} /> Auto-approve written sequences (leave off until you trust the output)
      </label>
      <label>
        <input type="checkbox" name="active" defaultChecked={c?.active} /> Active (emails are only written for active campaigns)
      </label>
      <button>{c ? "Save" : "Create campaign"}</button>
    </form>
  );
}

export default async function Campaigns({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const campaigns = must(await db().from("campaigns").select("*").order("created_at", { ascending: false })) as Campaign[];
  return (
    <>
      <h1>Campaigns</h1>
      <Flash msg={msg} />
      {campaigns.map((c) => (
        <details key={c.id} className="card">
          <summary>
            <b>{c.name}</b> {c.active ? <span className="pill good">active</span> : <span className="pill">paused</span>}
          </summary>
          <CampaignForm c={c} />
        </details>
      ))}
      <h2>New campaign</h2>
      <CampaignForm />
    </>
  );
}
