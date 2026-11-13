import Link from "next/link";
import { Mail, Megaphone, Pause, Play, Sparkles, Target } from "lucide-react";
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

  // Per-campaign numbers, all counted on the server in parallel.
  const head = { count: "exact" as const, head: true };
  const leadsQ = () => db().from("leads").select("id", head);
  const msgsQ = () => db().from("messages").select("id", head);
  const stats = await Promise.all(
    campaigns.map(async (c) => {
      const [leads, ready, sent, replies, interested] = await Promise.all([
        leadsQ().eq("campaign_id", c.id),
        leadsQ().eq("campaign_id", c.id).eq("status", "ready"),
        msgsQ().eq("campaign_id", c.id).eq("direction", "out").eq("status", "sent"),
        msgsQ().eq("campaign_id", c.id).eq("direction", "in").neq("classification", "bounce").neq("classification", "out_of_office"),
        msgsQ().eq("campaign_id", c.id).eq("direction", "in").eq("classification", "interested"),
      ]);
      return { leads: leads.count ?? 0, ready: ready.count ?? 0, sent: sent.count ?? 0, replies: replies.count ?? 0, interested: interested.count ?? 0 };
    }),
  );
  const activeCount = campaigns.filter((c) => c.active).length;

  return (
    <>
      <section className="dash-hero">
        <div>
          <h1>Campaigns</h1>
          <p>
            What you sell and who to. Claude writes every email from this. · {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}, {activeCount}{" "}
            active
          </p>
        </div>
        <div className="head-actions">
          <ModalButton label="New campaign" title="New campaign">
            <CampaignForm />
          </ModalButton>
        </div>
      </section>
      <Flash msg={msg} />

      {campaigns.length === 0 ? (
        <div className="card">
          <Empty icon={Megaphone} title="No campaigns yet">
            Click New campaign to create your first one.
          </Empty>
        </div>
      ) : (
        <div className="camp-grid">
          {campaigns.map((c, i) => {
            const st = stats[i];
            const steps = c.steps?.length ?? 0;
            return (
              <article key={c.id} className={`card camp ${c.active ? "" : "paused"}`}>
                <header className="camp-head">
                  <span className="dash-chip orange">
                    <Megaphone size={18} aria-hidden="true" />
                  </span>
                  <div className="camp-title">
                    <h2>{c.name}</h2>
                    <span className="muted small camp-icp">
                      <Target size={12} aria-hidden="true" />
                      {c.icp}
                    </span>
                  </div>
                  {c.active ? (
                    <span className="pill good camp-status">
                      <span className="camp-dot" />
                      Active
                    </span>
                  ) : (
                    <span className="pill camp-status">Paused</span>
                  )}
                </header>

                <p className="camp-offer">{c.offer}</p>

                <div className="camp-stats">
                  <Link href="/leads" className="camp-stat">
                    <b>{st.leads}</b>
                    <span>Leads</span>
                  </Link>
                  <Link href="/leads?status=ready" className={`camp-stat ${st.ready ? "hl" : ""}`}>
                    <b>{st.ready}</b>
                    <span>To approve</span>
                  </Link>
                  <div className="camp-stat">
                    <b>{st.sent}</b>
                    <span>Sent</span>
                  </div>
                  <div className="camp-stat">
                    <b>{st.replies}</b>
                    <span>Replies</span>
                  </div>
                  <div className="camp-stat">
                    <b>{st.interested}</b>
                    <span>Interested</span>
                  </div>
                </div>

                <div className="camp-tags">
                  <span className="chip">
                    <Mail size={12} aria-hidden="true" />
                    {steps} {steps === 1 ? "email" : "emails"} per lead
                  </span>
                  {c.aeo_category ? (
                    <span className="chip">
                      <Sparkles size={12} aria-hidden="true" />
                      AI check: {c.aeo_category}
                    </span>
                  ) : null}
                  {c.auto_approve && <span className="chip">Auto-approve on</span>}
                </div>

                <footer className="camp-foot">
                  <ModalButton label="Edit" title={`Edit ${c.name}`} icon="pencil" variant="small">
                    <CampaignForm c={c} />
                  </ModalButton>
                  <form action={setCampaignActive}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={String(!c.active)} />
                    <SubmitButton className="secondary sm" pending={c.active ? "Pausing..." : "Resuming..."}>
                      {c.active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                      {c.active ? "Pause" : "Resume"}
                    </SubmitButton>
                  </form>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
