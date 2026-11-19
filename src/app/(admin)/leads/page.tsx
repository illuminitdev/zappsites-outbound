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
  Download,
  Globe,
  Info,
  Mail,
  MapPin,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ThumbsUp,
  UploadCloud,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { approveSelected, createManualAudit, importCompaniesHouse, importCsv, importPlaces } from "@/app/actions";
import { ModalButton } from "@/components/Modal";
import { CsvDrop } from "@/components/CsvDrop";
import { FilterMenu } from "@/components/StatusFilter";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash, Pill, Score } from "@/components/ui";
import { db, must } from "@/lib/db";
import { friendlyError } from "@/lib/errors";
import { leadStatusCounts } from "@/lib/stats";
import { HISTORY_DAYS, loadSendRows, londonDay, type SendKind } from "@/lib/mailboxHistory";
import { TRADES } from "@/lib/inbound";
import type { Lead } from "@/lib/types";
import { EmailStatusCell, emailStatuses, type LeadEmailStatus } from "./emailStatus";
import { SentFilter } from "./SentFilter";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/** Email filter: how far the lead's emails have got (LocalPulse-style). */
const EMAIL_FILTERS: { value: string; label: string; match: (s: LeadEmailStatus | undefined) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "none", label: "No emails yet", match: (s) => !s },
  { value: "draft", label: "Written, not approved", match: (s) => s?.icon === "draft" },
  { value: "scheduled", label: "Scheduled", match: (s) => s?.icon === "scheduled" },
  { value: "sent", label: "Sent (any)", match: (s) => !!s && ["sent", "opened", "viewed", "clicked", "replied"].includes(s.icon) },
  { value: "not_opened", label: "Sent, not opened", match: (s) => s?.icon === "sent" },
  { value: "opened", label: "Opened", match: (s) => !!s && ["opened", "viewed", "clicked"].includes(s.icon) },
  { value: "clicked", label: "Clicked Book a call", match: (s) => s?.icon === "clicked" },
  { value: "replied", label: "Replied", match: (s) => s?.icon === "replied" },
  { value: "failed", label: "Failed to send", match: (s) => s?.icon === "failed" },
];

type LeadLite = { id: string; website: string | null; audited_at: string | null; audit_url: string | null; audit_reachable: boolean | null };

/** Audit filter: has it run, did the site load, and have they read their report. */
const AUDIT_FILTERS: { value: string; label: string; match: (l: LeadLite, s: LeadEmailStatus | undefined) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "done", label: "Audited", match: (l) => !!l.audited_at && l.audit_reachable !== false && !!l.audit_url },
  { value: "pending", label: "Not audited yet", match: (l) => !!l.website && !l.audited_at },
  { value: "unreachable", label: "Site didn't load", match: (l) => !!l.audit_url && l.audit_reachable === false },
  { value: "no_site", label: "No website", match: (l) => !l.website },
  { value: "viewed", label: "Report viewed", match: (_l, s) => !!s?.reportViewed },
  { value: "not_viewed", label: "Report sent, not viewed", match: (l, s) => !!l.audited_at && !!s && !s.reportViewed && ["sent", "opened", "clicked", "replied"].includes(s.icon) },
];

export default async function Leads({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; status?: string; q?: string; page?: string; email?: string; audit?: string; sent?: string; mailbox?: string }>;
}) {
  const { msg, status = "all", q, page: pageParam, email = "all", audit = "all", sent = "all", mailbox } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const term = q?.replace(/[%,()]/g, "");

  // Every lead matching the status and search (light columns only), then the email/audit filters on top.
  const base: LeadLite[] = [];
  for (let from = 0; ; from += 1000) {
    let lq = db()
      .from("leads")
      .select("id,website,audited_at,audit_url:audit->>url,audit_reachable:audit->reachable")
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (status !== "all") lq = lq.eq("status", status);
    if (term) lq = lq.or(`company.ilike.%${term}%,domain.ilike.%${term}%`);
    const rows = must(await lq) as LeadLite[];
    base.push(...rows);
    if (rows.length < 1000) break;
  }
  const [emailStatus, campaigns, counts, sendRows, mailboxes] = await Promise.all([
    emailStatuses(null),
    db()
      .from("campaigns")
      .select("id,name")
      .order("created_at", { ascending: false })
      .then((r) => must(r) as { id: string; name: string }[]),
    leadStatusCounts(),
    loadSendRows(DATE_RE.test(sent.split(":")[1] ?? "") ? sent.split(":")[1] : undefined),
    db()
      .from("mailboxes")
      .select("id,email")
      .then((r) => must(r) as { id: string; email: string }[]),
  ]);
  // "Sent on" filter: leads emailed / failed / replied today, yesterday, in the last 30 days or on a picked date.
  // Value is "<kind>:<range>", e.g. "sent:today", "failed:30d", "replied:2026-11-18" ("all" = no filter).
  const mailboxEmail = mailbox ? (mailboxes.find((m) => m.id === mailbox)?.email ?? "Removed mailbox") : null;
  const today = londonDay(0);
  const yesterday = londonDay(1);
  const monthStart = londonDay(HISTORY_DAYS - 1);
  const [kindRaw, rangeRaw = ""] = sent.split(":");
  const sentKind: SendKind = (["sent", "failed", "replied"] as const).find((k) => k === kindRaw) ?? "sent";
  const sentRange = ["today", "yesterday", "30d"].includes(rangeRaw) || DATE_RE.test(rangeRaw) ? rangeRaw : null;
  const sentActive = sent !== "all" && !!sentRange;
  const dayOf = (range: string) => (range === "today" ? today : range === "yesterday" ? yesterday : range);
  const leadSet = (kind: SendKind, range: string) => {
    const set = new Set<string>();
    for (const r of sendRows) {
      if (r.kind !== kind || (mailbox && r.mailboxId !== mailbox)) continue;
      if (range === "30d" ? r.day < monthStart : r.day !== dayOf(range)) continue;
      set.add(r.leadId);
    }
    return set;
  };
  const activeSet = sentActive ? leadSet(sentKind, sentRange!) : null;
  const sentMatch = (id: string) => !activeSet || activeSet.has(id);
  const emailF = EMAIL_FILTERS.find((f) => f.value === email) ?? EMAIL_FILTERS[0];
  const auditF = AUDIT_FILTERS.find((f) => f.value === audit) ?? AUDIT_FILTERS[0];
  const matching = base.filter((l) => emailF.match(emailStatus.get(l.id)) && auditF.match(l, emailStatus.get(l.id)) && sentMatch(l.id));
  // Counts in each dropdown respect the other filters, so the numbers always add up to what you'd see.
  const emailOptions = EMAIL_FILTERS.map((f) => ({ value: f.value, label: f.label, count: base.filter((l) => auditF.match(l, emailStatus.get(l.id)) && sentMatch(l.id) && f.match(emailStatus.get(l.id))).length }));
  const auditOptions = AUDIT_FILTERS.map((f) => ({ value: f.value, label: f.label, count: base.filter((l) => emailF.match(emailStatus.get(l.id)) && sentMatch(l.id) && f.match(l, emailStatus.get(l.id))).length }));
  // Counts for the "Sent on" menu: every kind x range (plus the picked date), with the other filters applied.
  const others = base.filter((l) => emailF.match(emailStatus.get(l.id)) && auditF.match(l, emailStatus.get(l.id)));
  const sentRanges = ["today", "yesterday", "30d", ...(sentRange && DATE_RE.test(sentRange) ? [sentRange] : [])];
  const sentCounts: Record<string, number> = { all: others.length };
  for (const k of ["sent", "failed", "replied"] as const)
    for (const r of sentRanges) {
      const set = leadSet(k, r);
      sentCounts[`${k}:${r}`] = others.filter((l) => set.has(l.id)).length;
    }

  const total = matching.length;
  const slice = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((l) => l.id);
  const rows = slice.length ? (must(await db().from("leads").select("*").in("id", slice)) as Lead[]) : [];
  const leads = slice.map((id) => rows.find((r) => r.id === id)).filter((l): l is Lead => !!l);

  const countOf = new Map(counts.byStatus).set("all", counts.total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterParams = { status, q, email, audit, sent, mailbox };
  const pageHref = (n: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filterParams, page: n > 1 ? String(n) : undefined })) if (v && v !== "all") u.set(k, v);
    return `/leads${u.size ? `?${u}` : ""}`;
  };
  const filtered = !!q || status !== "all" || email !== "all" || audit !== "all" || sent !== "all" || !!mailbox;
  const withoutMailbox = (() => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filterParams, mailbox: undefined })) if (v && v !== "all") u.set(k, v);
    return `/leads${u.size ? `?${u}` : ""}`;
  })();
  // Page numbers to show: first, last, and two either side of the current page.
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);
  const CampaignSelect = () => (
    <select name="campaign_id" defaultValue={campaigns[0]?.id}>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value="">Automatic (no campaign)</option>
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

  const countOptions = FILTERS.map((f) => ({ value: f, label: f === "all" ? "All statuses" : f.replace(/_/g, " "), count: countOf.get(f) ?? 0 }));

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
          <ModalButton label="Upload Excel / CSV" title="Upload leads (Excel or CSV)" icon="upload" variant="secondary" size="md">
            <form action={importCsv} className="modal-form csv-form">
              <div className="csv-step">
                <span className="csv-num">1</span>
                <b>Choose your file</b>
              </div>
              <CsvDrop />

              <div className="csv-cols">
                <span className="csv-cols-head">
                  Columns
                  <span className="csv-templates">
                    <Download size={13} aria-hidden="true" /> Template:
                    <a href="/leads-template.xlsx" download>
                      Excel
                    </a>
                    ·
                    <a href="/leads-template.csv" download>
                      CSV
                    </a>
                  </span>
                </span>
                <div>
                  <span className="csv-col req">company</span>
                  <span className="csv-col req">website or email</span>
                  <span className="csv-col">first name</span>
                  <span className="csv-col">last name</span>
                  <span className="csv-col">city</span>
                  <span className="csv-col">entity type (Ltd / LLP)</span>
                </div>
                <small className="muted">Orange = required. Rows missing them are skipped.</small>
              </div>

              <div className="csv-step">
                <span className="csv-num">2</span>
                <b>
                  Campaign <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                </b>
              </div>
              <select name="campaign_id" defaultValue="">
                <option value="">Automatic (recommended)</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="csv-hint">
                <Info size={13} aria-hidden="true" /> Emails are written and sent automatically after upload. No campaign needed.
              </p>

              <SubmitButton pending="Uploading...">
                <UploadCloud size={16} aria-hidden="true" /> Upload leads
              </SubmitButton>
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
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          {email !== "all" && <input type="hidden" name="email" value={email} />}
          {audit !== "all" && <input type="hidden" name="audit" value={audit} />}
          {sent !== "all" && <input type="hidden" name="sent" value={sent} />}
          {mailbox && <input type="hidden" name="mailbox" value={mailbox} />}
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Search company or domain…" />
        </form>
        <div className="leads-toolbar-right">
          {filtered && (
            <Link href="/leads" className="leads-clear">
              Clear filters
            </Link>
          )}
          {mailboxEmail && (
            <Link href={withoutMailbox} className="leads-chip" title="Remove the mailbox filter">
              <Mail size={13} aria-hidden="true" />
              {mailboxEmail}
              <X size={13} aria-hidden="true" />
            </Link>
          )}
          <SentFilter value={sentActive ? `${sentKind}:${sentRange}` : "all"} counts={sentCounts} params={filterParams} today={today} />
          <FilterMenu param="email" title="Email" value={email} options={emailOptions} params={filterParams} />
          <FilterMenu param="audit" title="Audit" value={audit} options={auditOptions} params={filterParams} />
          <FilterMenu param="status" title="Status" value={status} options={countOptions} params={filterParams} />
        </div>
      </div>

      <form action={approveSelected}>
        <div className="card table-card leads-table">
          {leads.length === 0 ? (
            <Empty icon={Users} title={q ? "No leads match your search" : !filtered ? "No leads yet" : status !== "all" ? `No leads in “${status}”` : "No leads match these filters"}>
              {!filtered ? "Use Add leads or Upload CSV above to import some." : null}
            </Empty>
          ) : (
            <table className="data leads-grid">
              <thead>
                <tr>
                  {isReady && <th style={{ width: 36 }} />}
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Score</th>
                  <th>PECR</th>
                  <th>Status</th>
                  <th>Email</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    {isReady && <td className="lc-check">{l.status === "ready" && <input type="checkbox" name="lead" value={l.id} disabled={!l.pecr_ok} />}</td>}
                    <td className="lc-co">
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
                    <td className="lc-contact">
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
                    <td className="lc-score">
                      <Score v={l.audit?.url && l.audit.reachable ? displayScore(l.audit) : l.audit_score} />
                    </td>
                    <td className="lc-pecr">{l.pecr_ok ? <span className="pill good">ok</span> : <span className="pill warn">{l.entity_type.replace(/_/g, " ")}</span>}</td>
                    <td className="lc-status">
                      <Pill v={l.status} />
                      {l.last_error && (
                        <div className="row-error" title={l.last_error}>
                          {friendlyError(l.last_error)}
                        </div>
                      )}
                    </td>
                    <td className="lc-email">
                      <EmailStatusCell s={emailStatus.get(l.id)} />
                    </td>
                    <td className="lc-open">
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
