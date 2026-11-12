import Link from "next/link";
import { Building2, Check, FileSpreadsheet, MapPin, Plus, Search, Users } from "lucide-react";
import { approveSelected, importCompaniesHouse, importCsv, importPlaces } from "@/app/actions";
import { Empty, Flash, Pill, Score } from "@/components/ui";
import { db, must } from "@/lib/db";
import type { Lead } from "@/lib/types";

const FILTERS = ["all", "new", "enriched", "audited", "ready", "sequencing", "replied", "interested", "meeting", "error"];

export default async function Leads({ searchParams }: { searchParams: Promise<{ msg?: string; status?: string; q?: string }> }) {
  const { msg, status = "all", q } = await searchParams;
  let query = db().from("leads").select("*").order("created_at", { ascending: false }).limit(300);
  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.or(`company.ilike.%${q.replace(/[%,()]/g, "")}%,domain.ilike.%${q.replace(/[%,()]/g, "")}%`);
  const head = { count: "exact" as const, head: true };
  const [leads, campaigns, counts] = await Promise.all([
    query.then((r) => must(r) as Lead[]),
    db()
      .from("campaigns")
      .select("id,name")
      .order("created_at", { ascending: false })
      .then((r) => must(r) as { id: string; name: string }[]),
    Promise.all(
      FILTERS.map(async (f) => {
        const r = await (f === "all" ? db().from("leads").select("id", head) : db().from("leads").select("id", head).eq("status", f));
        return [f, r.count ?? 0] as const;
      }),
    ),
  ]);
  const countOf = new Map(counts);
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
  const isReady = status === "ready";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="muted">Businesses you&apos;re prospecting. They move through the pipeline automatically; you approve the emails.</p>
        </div>
        <a href="#add" className="btn-link">
          <Plus size={16} aria-hidden="true" />
          Add leads
        </a>
      </div>
      <Flash msg={msg} />

      <div className="toolbar">
        <div className="segmented">
          {FILTERS.map((f) => (
            <Link key={f} href={`/leads?status=${f}`} className={f === status ? "on" : undefined}>
              {f}
              <span>{countOf.get(f) ?? 0}</span>
            </Link>
          ))}
        </div>
        <form className="search" action="/leads">
          <input type="hidden" name="status" value={status} />
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Search company or domain…" />
        </form>
      </div>

      <form action={approveSelected}>
        <div className="card table-card">
          {leads.length === 0 ? (
            <Empty icon={Users} title={q ? "No leads match your search" : status === "all" ? "No leads yet" : `No leads in “${status}”`}>
              {status === "all" && !q ? "Import some from Google Maps, Companies House or a CSV below." : null}
            </Empty>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  {isReady && <th style={{ width: 36 }} />}
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Score</th>
                  <th>PECR</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    {isReady && <td>{l.status === "ready" && <input type="checkbox" name="lead" value={l.id} disabled={!l.pecr_ok} />}</td>}
                    <td>
                      <Link href={`/leads/${l.id}`} className="row-title">
                        {l.company}
                      </Link>
                      <div className="muted small">
                        {l.domain ?? "no website"}
                        {l.city ? ` · ${l.city}` : ""}
                      </div>
                    </td>
                    <td>
                      <div>{[l.first_name, l.last_name].filter(Boolean).join(" ") || <span className="muted">–</span>}</div>
                      <div className="muted small">
                        {l.email ?? "no email"} {l.email_status !== "unknown" && <Pill v={l.email_status} />}
                      </div>
                    </td>
                    <td>
                      <Score v={l.audit_score} />
                    </td>
                    <td>{l.pecr_ok ? <span className="pill good">ok</span> : <span className="pill warn">{l.entity_type.replace(/_/g, " ")}</span>}</td>
                    <td>
                      <Pill v={l.status} />
                      {l.last_error && <div className="row-error">{l.last_error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {isReady && leads.length > 0 && (
          <div className="action-bar">
            <span className="muted small">Leads not confirmed as a limited company or LLP can&apos;t be selected. Open them to confirm (PECR).</span>
            <button className="btn-primary">
              <Check size={16} aria-hidden="true" />
              Approve and schedule selected
            </button>
          </div>
        )}
      </form>

      <h2 id="add" className="section-title">
        Add leads
      </h2>
      <div className="add-grid">
        <form action={importPlaces} className="card add-card">
          <div className="add-icon">
            <MapPin size={20} aria-hidden="true" />
          </div>
          <h3>Google Maps search</h3>
          <p className="muted small">Local businesses with a website, e.g. &quot;electricians in Leeds&quot;.</p>
          <label>Search</label>
          <input name="query" required placeholder="commercial insurance brokers in Manchester" />
          <div className="row">
            <div>
              <label>Max results (≤60)</label>
              <input name="max" type="number" defaultValue={60} max={60} />
            </div>
            <div>
              <label>Campaign</label>
              <CampaignSelect />
            </div>
          </div>
          <button className="btn-primary">Import</button>
        </form>

        <form action={importCompaniesHouse} className="card add-card">
          <div className="add-icon">
            <Building2 size={20} aria-hidden="true" />
          </div>
          <h3>New companies</h3>
          <p className="muted small">Recently registered UK companies from Companies House, by industry code.</p>
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
          <button className="btn-primary">Import</button>
        </form>

        <form action={importCsv} className="card add-card">
          <div className="add-icon">
            <FileSpreadsheet size={20} aria-hidden="true" />
          </div>
          <h3>CSV upload</h3>
          <p className="muted small">Columns: company, website, email, first name, last name, city, entity type. Needs company plus website or email.</p>
          <label>File</label>
          <input type="file" name="file" accept=".csv,text/csv" required />
          <label>Campaign</label>
          <CampaignSelect />
          <button className="btn-primary">Upload</button>
        </form>
      </div>
    </>
  );
}
