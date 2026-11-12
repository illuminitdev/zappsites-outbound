import { ChevronDown, Megaphone } from "lucide-react";
import { saveCampaign, setCampaignActive } from "@/app/actions";
import { ModalButton } from "@/components/Modal";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Campaign } from "@/lib/types";

// Only what a campaign needs. Sequence steps, send window, tone and signature use sensible defaults
// (3 emails on day 0/3/7, weekdays 08:00-17:00 UK, signature from BRAND_PERSON) and are kept as-is on edit.
function CampaignForm({ c }: { c?: Campaign }) {
  return (
    <form action={saveCampaign} className="form-sections">
      {c && <input type="hidden" name="id" value={c.id} />}

      <label>Campaign name</label>
      <input name="name" required defaultValue={c?.name} placeholder="Leeds plumbers" />

      <label>What you&apos;re selling</label>
      <textarea
        name="offer"
        required
        defaultValue={c?.offer}
        placeholder="We fix the website problems that stop local trades getting calls from Google and AI search."
      />

      <label>Who it&apos;s for</label>
      <input name="icp" required defaultValue={c?.icp} placeholder="Plumbing and heating companies in Leeds, 1-20 staff" />

      <label>Proof (optional, only true facts)</label>
      <textarea name="proof" defaultValue={c?.proof} placeholder="A real result, e.g. a client who got more calls after we fixed their site. Leave empty if none yet." />

      <label>What their customers search for (optional)</label>
      <input name="aeo_category" defaultValue={c?.aeo_category} placeholder="plumbers in Leeds" />
      <p className="muted small">Used to check if the business shows up when people ask ChatGPT or Google AI. Leave empty to skip.</p>

      <div className="form-foot">
        <SubmitButton pending="Saving...">{c ? "Save campaign" : "Create campaign"}</SubmitButton>
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
          <p className="muted">What you sell and who to. Claude writes every email from this.</p>
        </div>
        <ModalButton label="New campaign" title="New campaign">
          <CampaignForm />
        </ModalButton>
      </div>
      <Flash msg={msg} />

      {campaigns.length === 0 ? (
        <div className="card">
          <Empty icon={Megaphone} title="No campaigns yet">Click New campaign to create your first one.</Empty>
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
                  {c.active ? <span className="pill good">active</span> : <span className="pill">paused</span>}
                  <ChevronDown size={18} className="chev" aria-hidden="true" />
                </div>
              </summary>
              <div className="campaign-body">
                <CampaignForm c={c} />
                <form action={setCampaignActive} className="form-foot">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="active" value={String(!c.active)} />
                  <button className="secondary">{c.active ? "Pause campaign" : "Resume campaign"}</button>
                </form>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
