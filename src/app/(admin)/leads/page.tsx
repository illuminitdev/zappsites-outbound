import Link from "next/link";
import { approveSelected, importCompaniesHouse, importCsv, importPlaces } from "@/app/actions";
import { Flash, Pill } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead } from "@/lib/types";

const FILTERS = ["all", "new", "enriched", "audited", "ready", "sequencing", "replied", "interested", "meeting", "error"];

export default async function Leads({ searchParams }: { searchParams: Promise<{ msg?: string; status?: string; q?: string }> }) {
  const { msg, status = "all", q } = await searchParams;
  let query = db().from("leads").select("*").order("created_at", { ascending: false }).limit(300);
  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.or(`company.ilike.%${q.replace(/[%,()]/g, "")}%,domain.ilike.%${q.replace(/[%,()]/g, "")}%`);
  const leads = must(await query) as Lead[];
  const campaigns = must(await db().from("campaigns").select("id,name").order("created_at", { ascending: false })) as { id: string; name: string }[];
  const CampaignSelect = () => (
    <select name="campaign_id" defaultValue={campaigns[0]?.id}>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value="">(no campaign)</option>
    </select>
  );
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  return (
    <>
      <h1>Leads</h1>
      <Flash msg={msg} />
      <div className="tabs">
        {FILTERS.map((f) => (
          <Link key={f} href={`/leads?status=${f}`} style={{ fontWeight: f === status ? 700 : 400 }}>
            {f}
          </Link>
        ))}
      </div>

      <form action={approveSelected}>
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th />
              <th>Company</th>
              <th>Contact</th>
              <th>Audit</th>
              <th>PECR</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>{l.status === "ready" && <input type="checkbox" name="lead" value={l.id} disabled={!l.pecr_ok} />}</td>
                <td>
                  <Link href={`/leads/${l.id}`}>{l.company}</Link>
                  <div className="muted">{l.domain ?? ""} {l.city ? `· ${l.city}` : ""}</div>
                </td>
                <td>
                  {l.first_name ?? ""} {l.email ?? <span className="muted">no email</span>} <Pill v={l.email_status !== "unknown" ? l.email_status : null} />
                </td>
                <td>{l.audit_score ?? "–"}</td>
                <td>{l.pecr_ok ? <span className="pill good">ok</span> : <span className="pill warn">{l.entity_type}</span>}</td>
                <td>
                  <Pill v={l.status} />
                  {l.last_error && <div className="muted" style={{ fontSize: 12 }}>{l.last_error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {status === "ready" && leads.length > 0 && <button>Approve and schedule selected</button>}
      </form>
      {status === "ready" && <p className="muted">Leads not confirmed as a limited company or LLP can't be selected. Open them to confirm (PECR).</p>}

      <h2>Add leads</h2>
      <div className="row">
        <form action={importPlaces} className="card">
          <b>Google Maps search</b>
          <label>Query</label>
          <input name="query" required placeholder="commercial insurance brokers in Manchester" />
          <label>Max results (≤60)</label>
          <input name="max" type="number" defaultValue={60} max={60} />
          <label>Campaign</label>
          <CampaignSelect />
          <button>Import</button>
        </form>
        <form action={importCompaniesHouse} className="card">
          <b>New companies (Companies House)</b>
          <label>SIC codes</label>
          <input name="sic" required placeholder="66220, 43210" />
          <div className="row">
            <div>
              <label>Incorporated since</label>
              <input name="from" type="date" required defaultValue={monthAgo} />
            </div>
            <div>
              <label>Location (optional)</label>
              <input name="location" placeholder="Leeds" />
            </div>
          </div>
          <label>Campaign</label>
          <CampaignSelect />
          <button>Import</button>
        </form>
      </div>
      <form action={importCsv} className="card">
        <b>CSV upload</b>
        <p className="muted">Columns: company, website, email, first name, last name, city, entity type. Needs company + website or email.</p>
        <div className="row">
          <input type="file" name="file" accept=".csv,text/csv" required />
          <CampaignSelect />
        </div>
        <button>Upload</button>
      </form>
    </>
  );
}
