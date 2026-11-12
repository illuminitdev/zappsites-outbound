import { ChevronDown, Megaphone, Plus } from "lucide-react";
import { saveCampaign } from "@/app/actions";
import { Empty, Flash } from "@/components/ui";
import { DEFAULT_AEO_PROMPTS } from "@/lib/audit/mentions";
import { db, must } from "@/lib/db";
import type { Campaign } from "@/lib/types";

const isLegacy = (p?: string[]) => !p?.length || (p.length === DEFAULT_AEO_PROMPTS.length && p.every((x, i) => x === DEFAULT_AEO_PROMPTS[i]));

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
    <form action={saveCampaign} className="form-sections">
      {c && <input type="hidden" name="id" value={c.id} />}

      <fieldset>
        <legend>Basics</legend>
        <div className="row">
          <div>
            <label>Campaign name</label>
            <input name="name" required defaultValue={c?.name} placeholder="Trade insurance brokers: AI visibility" />
          </div>
          <div>
            <label>External booking link (optional)</label>
            <input name="booking_url" type="url" defaultValue={c?.booking_url} placeholder="Empty = your built-in /book page" />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>What you&apos;re selling</legend>
        <label>Offer: what you sell, in one or two sentences</label>
        <textarea
          name="offer"
          required
          defaultValue={c?.offer}
          placeholder="Fixed-price AEO audit and fix plan: make your firm show up when trades ask ChatGPT or Google for insurance. £X, delivered in 5 days."
        />
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
      </fieldset>

      <fieldset>
        <legend>AI visibility test</legend>
        <p className="muted small">Asks ChatGPT, Claude, Perplexity and Gemini buyer questions and checks whether the lead is recommended.</p>
        <div className="row">
          <div>
            <label>Category buyers ask AI for (empty = skip this test)</label>
            <input name="aeo_category" defaultValue={c?.aeo_category} placeholder="commercial insurance brokers for tradespeople" />
          </div>
          <div>
            <label>Custom questions, one per line ({"{service}"}, {"{category}"}, {"{city}"} work)</label>
            <textarea
              name="aeo_prompts"
              style={{ minHeight: 90 }}
              defaultValue={isLegacy(c?.aeo_prompts) ? "" : c!.aeo_prompts.join("\n")}
              placeholder={"Empty = automatic: we read each lead's website and ask about the services they list.\nOr use {service}, e.g.\nWho's the best company for {service} in {city}?"}
            />
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Sequence</legend>
        <label>Steps (JSON): day = days after the first email</label>
        <textarea name="steps" className="mono" style={{ minHeight: 170 }} defaultValue={c ? JSON.stringify(c.steps, null, 2) : DEFAULT_STEPS} />
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
            <label>Days</label>
            <div className="static-field">Mon–Fri only</div>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Options</legend>
        <label className="toggle">
          <input type="checkbox" name="active" defaultChecked={c?.active} />
          <span>
            <b>Active</b>
            <small>Emails are only written for active campaigns.</small>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" name="auto_approve" defaultChecked={c?.auto_approve} />
          <span>
            <b>Auto-approve written sequences</b>
            <small>Leave off until you trust the output. Off means you review every email first.</small>
          </span>
        </label>
      </fieldset>

      <div className="form-foot">
        <button className="btn-primary">{c ? "Save campaign" : "Create campaign"}</button>
      </div>
    </form>
  );
}

export default async function Campaigns({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const campaigns = must(await db().from("campaigns").select("*").order("created_at", { ascending: false })) as Campaign[];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p className="muted">What you sell, who to, and how the email sequence runs. Claude writes every email from this.</p>
        </div>
        <a href="#new" className="btn-link">
          <Plus size={16} aria-hidden="true" />
          New campaign
        </a>
      </div>
      <Flash msg={msg} />

      {campaigns.length === 0 ? (
        <div className="card">
          <Empty icon={Megaphone} title="No campaigns yet">Create your first one below, then tick Active.</Empty>
        </div>
      ) : (
        <div className="stack">
          {campaigns.map((c) => (
            <details key={c.id} className="card campaign">
              <summary>
                <div className="campaign-main">
                  <b>{c.name}</b>
                  <span className="muted small clamp">{c.offer}</span>
                </div>
                <div className="campaign-meta">
                  <span className="chip">{c.steps.length} emails</span>
                  {c.aeo_category && <span className="chip">AI test on</span>}
                  {c.auto_approve && <span className="chip">auto-approve</span>}
                  {c.active ? <span className="pill good">active</span> : <span className="pill">paused</span>}
                  <ChevronDown size={18} className="chev" aria-hidden="true" />
                </div>
              </summary>
              <div className="campaign-body">
                <CampaignForm c={c} />
              </div>
            </details>
          ))}
        </div>
      )}

      <h2 id="new" className="section-title">
        New campaign
      </h2>
      <div className="card">
        <CampaignForm />
      </div>
    </>
  );
}
