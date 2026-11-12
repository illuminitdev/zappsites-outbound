import Link from "next/link";
import { Building2, Check, MapPin, Search, Users } from "lucide-react";
import { approveSelected, importCompaniesHouse, importCsv, importPlaces } from "@/app/actions";
import { ModalButton } from "@/components/Modal";
import { StatusFilter } from "@/components/StatusFilter";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash, Pill, Score } from "@/components/ui";
import { db, must } from "@/lib/db";
import { friendlyError } from "@/lib/errors";
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

  const countOptions = FILTERS.map((f) => ({ value: f, count: countOf.get(f) ?? 0 }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="muted">Businesses you&apos;re prospecting. They move through the pipeline automatically; you approve the emails.</p>
        </div>
        <div className="head-actions">
          <ModalButton label="Upload CSV" title="Upload leads from CSV" icon="upload" variant="secondary" size="md">
            <form action={importCsv} className="modal-form">
              <p className="muted small">Columns: company, website, email, first name, last name, city, entity type. Each row needs a company plus a website or email.</p>
              <label>File</label>
              <input type="file" name="file" accept=".csv,text/csv" required />
              <label>Campaign</label>
              <CampaignSelect />
              <SubmitButton pending="Uploading...">Upload</SubmitButton>
            </form>
          </ModalButton>
          <ModalButton label="Add leads" title="Add leads">
            <div className="add-grid">
              <form action={importPlaces} className="add-card">
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
                <SubmitButton pending="Importing from Google Maps...">Import</SubmitButton>
              </form>

              <form action={importCompaniesHouse} className="add-card">
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
                <SubmitButton pending="Importing from Companies House...">Import</SubmitButton>
              </form>
            </div>
          </ModalButton>
        </div>
      </div>
      <Flash msg={msg} />

      <div className="toolbar">
        <form className="search" action="/leads">
          <input type="hidden" name="status" value={status} />
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Search company or domain…" />
        </form>
        <StatusFilter status={status} q={q} options={countOptions} />
      </div>

      <form action={approveSelected}>
        <div className="card table-card">
          {leads.length === 0 ? (
            <Empty icon={Users} title={q ? "No leads match your search" : status === "all" ? "No leads yet" : `No leads in “${status}”`}>
              {status === "all" && !q ? "Use Add leads or Upload CSV above to import some." : null}
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
                      {l.last_error && (
                        <div className="row-error" title={l.last_error}>
                          {friendlyError(l.last_error)}
                        </div>
                      )}
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

    </>
  );
}
