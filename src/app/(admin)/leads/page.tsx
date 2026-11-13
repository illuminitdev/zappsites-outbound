import Link from "next/link";
import { displayScore } from "@/lib/audit/analyze";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Globe,
  Mail,
  MapPin,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ThumbsUp,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { approveSelected, createManualAudit, importCompaniesHouse, importCsv, importPlaces } from "@/app/actions";
import { ModalButton } from "@/components/Modal";
import { StatusFilter } from "@/components/StatusFilter";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash, Pill, Score } from "@/components/ui";
import { db, must } from "@/lib/db";
import { friendlyError } from "@/lib/errors";
import { leadStatusCounts } from "@/lib/stats";
import { TRADES } from "@/lib/inbound";
import type { Lead } from "@/lib/types";

// "Send audit" runs the audit inside the server action, which can take a minute or two.
export const maxDuration = 300;

const PAGE_SIZE = 10;

const AVATAR_COLORS = ["#fde2c0", "#d9e7ff", "#d5f0e3", "#f9d9e3", "#e6defb", "#fbe9b7"];
/** Stable pastel colour per company name. */
function avatarColor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const FILTERS = ["all", "new", "enriched", "audited", "ready", "sequencing", "replied", "interested", "meeting", "error"];

export default async function Leads({ searchParams }: { searchParams: Promise<{ msg?: string; status?: string; q?: string; page?: string }> }) {
  const { msg, status = "all", q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  let query = db()
    .from("leads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status !== "all") query = query.eq("status", status);
  if (q) query = query.or(`company.ilike.%${q.replace(/[%,()]/g, "")}%,domain.ilike.%${q.replace(/[%,()]/g, "")}%`);
  const [{ leads, total }, campaigns, counts] = await Promise.all([
    query.then((r) => ({ leads: must(r) as Lead[], total: r.count ?? 0 })),
    db()
      .from("campaigns")
      .select("id,name")
      .order("created_at", { ascending: false })
      .then((r) => must(r) as { id: string; name: string }[]),
    leadStatusCounts(),
  ]);
  const countOf = new Map(counts.byStatus).set("all", counts.total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (n: number) => `/leads?${new URLSearchParams({ status, ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`;
  // Page numbers to show: first, last, and two either side of the current page.
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);
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

  const quick: { id: string; label: string; icon: LucideIcon; tone: string }[] = [
    { id: "all", label: "All leads", icon: Users, tone: "grey" },
    { id: "ready", label: "Ready to approve", icon: CheckCircle2, tone: "orange" },
    { id: "sequencing", label: "In sequence", icon: Send, tone: "blue" },
    { id: "interested", label: "Interested", icon: ThumbsUp, tone: "green" },
    { id: "error", label: "Need fixing", icon: CircleAlert, tone: "red" },
  ];

  const countOptions = FILTERS.map((f) => ({ value: f, count: countOf.get(f) ?? 0 }));

  return (
    <>
      <section className="dash-hero leads-hero">
        <div>
          <h1>Leads</h1>
          <p>Businesses you&apos;re prospecting. They move through the pipeline automatically; you approve the emails.</p>
        </div>
        <div className="head-actions">
          <ModalButton label="Send audit" title="Send a website audit" icon="audit" variant="secondary" size="md">
            <form action={createManualAudit} className="modal-form am">
              <ol className="am-steps" aria-label="How it works">
                <li className="on">
                  <span>1</span>Audit website
                </li>
                <li>
                  <span>2</span>Review email
                </li>
                <li>
                  <span>3</span>Send
                </li>
              </ol>

              <fieldset className="am-section">
                <legend>
                  <Building2 size={15} aria-hidden="true" />
                  The business
                </legend>
                <label htmlFor="am-website">
                  Website <em>required</em>
                </label>
                <div className="am-input am-input-lg">
                  <Globe size={17} aria-hidden="true" />
                  <input id="am-website" name="website" required placeholder="northernplumbing.co.uk" autoComplete="off" />
                </div>
                <div className="am-grid3">
                  <div>
                    <label htmlFor="am-company">Business name</label>
                    <input id="am-company" name="company" placeholder="Northern Plumbing Ltd" />
                  </div>
                  <div>
                    <label htmlFor="am-trade">Trade</label>
                    <select id="am-trade" name="trade" defaultValue="plumber">
                      {TRADES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="am-town">Town</label>
                    <div className="am-input">
                      <MapPin size={15} aria-hidden="true" />
                      <input id="am-town" name="town" placeholder="Leeds" />
                    </div>
                  </div>
                </div>
              </fieldset>

              <fieldset className="am-section">
                <legend>
                  <Send size={15} aria-hidden="true" />
                  Send the report to
                </legend>
                <div className="am-grid2">
                  <div>
                    <label htmlFor="am-name">
                      Name <em>required</em>
                    </label>
                    <div className="am-input">
                      <UserRound size={15} aria-hidden="true" />
                      <input id="am-name" name="name" required placeholder="Ram Karri" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="am-email">
                      Email <em>required</em>
                    </label>
                    <div className="am-input">
                      <Mail size={15} aria-hidden="true" />
                      <input id="am-email" name="email" type="email" required placeholder="ram@company.co.uk" />
                    </div>
                  </div>
                </div>
              </fieldset>

              <label className="am-fresh">
                <input type="checkbox" name="fresh" />
                <span className="am-fresh-text">
                  <b>
                    <RefreshCw size={14} aria-hidden="true" />
                    Run a fresh audit
                  </b>
                  <small>Off: if this website was audited before, that audit is reused (instant, no cost).</small>
                </span>
              </label>

              <div className="am-foot">
                <span className="am-note">
                  <ShieldCheck size={14} aria-hidden="true" />
                  Nothing is sent yet. You review the email first.
                </span>
                <SubmitButton pending="Preparing audit (up to 2 min)...">
                  Run audit and preview email
                  <ArrowRight size={16} aria-hidden="true" />
                </SubmitButton>
              </div>
            </form>
          </ModalButton>
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
      </section>
      <Flash msg={msg} />

      <div className="leads-stats">
        {quick.map((k) => (
          <Link key={k.id} href={k.id === "all" ? "/leads" : `/leads?status=${k.id}`} className={`card leads-stat ${status === k.id ? "on" : ""}`}>
            <span className={`dash-chip sm ${k.tone}`}>
              <k.icon size={16} aria-hidden="true" />
            </span>
            <span className="leads-stat-text">
              <b>{countOf.get(k.id) ?? 0}</b>
              <span>{k.label}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="toolbar leads-toolbar">
        <form className="search" action="/leads">
          <input type="hidden" name="status" value={status} />
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Search company or domain…" />
        </form>
        <div className="leads-toolbar-right">
          {(q || status !== "all") && (
            <Link href="/leads" className="leads-clear">
              Clear filters
            </Link>
          )}
          <StatusFilter status={status} q={q} options={countOptions} />
        </div>
      </div>

      <form action={approveSelected}>
        <div className="card table-card leads-table">
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
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    {isReady && <td>{l.status === "ready" && <input type="checkbox" name="lead" value={l.id} disabled={!l.pecr_ok} />}</td>}
                    <td>
                      <div className="lead-co">
                        <span className="lead-avatar" style={{ background: avatarColor(l.company) }}>
                          {l.company.charAt(0).toUpperCase()}
                        </span>
                        <div className="lead-co-text">
                          <Link href={`/leads/${l.id}`} className="row-title">
                            {l.company}
                          </Link>
                          <div className="muted small lead-meta">
                            {l.domain ? (
                              <a href={l.website ?? `https://${l.domain}`} target="_blank" rel="noreferrer" className="lead-meta-item lead-link">
                                <Globe size={12} aria-hidden="true" />
                                {l.domain}
                              </a>
                            ) : (
                              <span>no website</span>
                            )}
                            {l.city && (
                              <span className="lead-meta-item">
                                <MapPin size={12} aria-hidden="true" />
                                {l.city}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="lead-contact-name">{[l.first_name, l.last_name].filter(Boolean).join(" ") || <span className="muted">No name</span>}</div>
                      <div className="muted small lead-meta">
                        {l.email ? (
                          <a href={`mailto:${l.email}`} className="lead-meta-item lead-email lead-link">
                            <Mail size={12} aria-hidden="true" />
                            {l.email}
                          </a>
                        ) : (
                          <span>no email</span>
                        )}
                        {l.email_status !== "unknown" && <Pill v={l.email_status} />}
                      </div>
                    </td>
                    <td>
                      <Score v={l.audit?.url && l.audit.reachable ? displayScore(l.audit) : l.audit_score} />
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
                    <td>
                      <Link href={`/leads/${l.id}`} className="lead-open" aria-label={`Open ${l.company}`}>
                        <ChevronRight size={16} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > 0 && (
          <nav className="pager" aria-label="Pages">
            <span className="muted small">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="pager-links">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="pager-btn">
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous
                </Link>
              ) : (
                <span className="pager-btn disabled">
                  <ChevronLeft size={16} aria-hidden="true" />
                  Previous
                </span>
              )}
              {pageNums.map((n, i) => (
                <span key={n} className="pager-nums">
                  {i > 0 && n - pageNums[i - 1] > 1 && <span className="muted">…</span>}
                  {n === page ? (
                    <span className="pager-num on" aria-current="page">
                      {n}
                    </span>
                  ) : (
                    <Link href={pageHref(n)} className="pager-num">
                      {n}
                    </Link>
                  )}
                </span>
              ))}
              {page < pages ? (
                <Link href={pageHref(page + 1)} className="pager-btn">
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              ) : (
                <span className="pager-btn disabled">
                  Next
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              )}
            </div>
          </nav>
        )}
        {isReady && leads.length > 0 && (
          <div className="action-bar">
            <span className="muted small">Leads not confirmed as a limited company or LLP can&apos;t be selected. Open them to confirm (PECR).</span>
            <SubmitButton pending="Scheduling...">
              <Check size={16} aria-hidden="true" />
              Approve and schedule selected
            </SubmitButton>
          </div>
        )}
      </form>

    </>
  );
}
