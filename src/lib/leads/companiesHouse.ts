import { env } from "../env";
import { fetchJson } from "../http";
import type { EntityType } from "../types";

const BASE = "https://api.company-information.service.gov.uk";

function auth(): Record<string, string> {
  const key = env.companiesHouseKey();
  if (!key) throw new Error("COMPANIES_HOUSE_API_KEY is not set");
  return { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

export function entityTypeFromCompanyType(t: string | undefined): EntityType {
  if (!t) return "unknown";
  if (t === "llp") return "llp";
  if (["ltd", "plc", "private-unlimited", "private-limited-guarant-nsc", "private-limited-guarant-nsc-limited-exemption", "private-limited-shares-section-30-exemption", "old-public-company", "private-unlimited-nsc"].includes(t))
    return "company";
  if (t === "limited-partnership" || t === "scottish-partnership") return "partnership";
  return "unknown";
}

/** Corporate subscribers under PECR: limited companies, PLCs and LLPs. */
export function isCorporateSubscriber(e: EntityType): boolean {
  return e === "company" || e === "llp";
}

export interface ChCompany {
  company_name: string;
  company_number: string;
  company_type?: string;
  company_status?: string;
  date_of_creation?: string;
  sic_codes?: string[];
  registered_office_address?: { locality?: string; postal_code?: string; address_line_1?: string };
}

/**
 * New-company trigger: active companies in given SIC codes incorporated since a date.
 * SIC examples: 43210 electrical installation, 43220 plumbing/heating, 69201 accountants,
 * 66220 insurance agents and brokers, 68310 estate agents.
 */
export async function searchNewCompanies(p: {
  sicCodes: string[];
  incorporatedFrom: string; // YYYY-MM-DD
  location?: string;
  size?: number;
}): Promise<ChCompany[]> {
  const q = new URLSearchParams({
    company_status: "active",
    incorporated_from: p.incorporatedFrom,
    size: String(Math.min(p.size ?? 100, 5000)),
  });
  if (p.sicCodes.length) q.set("sic_codes", p.sicCodes.join(","));
  if (p.location) q.set("location", p.location);
  const data = await fetchJson<{ items?: ChCompany[] }>(`${BASE}/advanced-search/companies?${q}`, {
    headers: auth(),
  });
  return data.items ?? [];
}

/** First active director's names, for personalisation. */
export async function firstDirector(companyNumber: string): Promise<{ first: string; last: string } | null> {
  const data = await fetchJson<{ items?: { name: string; officer_role: string; resigned_on?: string }[] }>(
    `${BASE}/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=20`,
    { headers: auth() },
  );
  const d = (data.items ?? []).find((o) => o.officer_role === "director" && !o.resigned_on);
  if (!d) return null;
  // Companies House format: "SURNAME, Forename Middle"
  const [surname, rest] = d.name.split(",").map((s) => s.trim());
  const first = (rest ?? "").split(/\s+/)[0] ?? "";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return first ? { first: cap(first), last: cap(surname ?? "") } : null;
}

/** One company by its registration number, or null if it doesn't exist. */
export async function getCompany(companyNumber: string): Promise<ChCompany | null> {
  // The profile endpoint calls it "type"; search results call it "company_type".
  const c = await fetchJson<ChCompany & { type?: string }>(`${BASE}/company/${encodeURIComponent(companyNumber)}`, {
    headers: auth(),
  }).catch(() => null);
  return c?.company_number ? { ...c, company_type: c.company_type ?? c.type } : null;
}

// "Registered in England No. 06012879", "Company Reg Number 02118024", "Company number: SC123456".
// Deliberately not "register number" / "firm reference": that is the FCA number, not Companies House.
const COMPANY_NO_RE =
  /(?:company\s*(?:registration|reg\.?)?\s*(?:no\.?|number|num)|registered\s+(?:in\s+(?:england|scotland|wales|northern\s+ireland)(?:\s*(?:&|and)\s*wales)?[\s,.:-]*(?:(?:company|under)\s*)?(?:no\.?|number)?|(?:company\s*)?(?:no\.?|number))|registration\s*(?:no\.?|number))\s*[.:#-]?\s*((?:SC|NI|OC|SO|NC)\d{6}|\d{6,8})\b/gi;

/** Company numbers a site states about itself, padded to Companies House's 8 characters. */
export function extractCompanyNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(COMPANY_NO_RE)) {
    const n = m[1].toUpperCase();
    out.add(/^\d+$/.test(n) ? n.padStart(8, "0") : n);
  }
  return [...out];
}

/**
 * Confirm the legal entity from the company number printed on the site (UK companies must show it).
 * A number only counts if the company it belongs to is active and its registered name also appears
 * on the site, so an FCA number or a stray number can't be mistaken for the company.
 */
export async function companyFromSiteText(text: string): Promise<ChCompany | null> {
  const page = normaliseCompanyName(text);
  for (const num of extractCompanyNumbers(text).slice(0, 3)) {
    const c = await getCompany(num);
    if (!c || (c.company_status && c.company_status !== "active")) continue;
    const name = normaliseCompanyName(c.company_name ?? "");
    if (name.length >= 3 && page.includes(name)) return c;
  }
  return null;
}

const STRIP = /\b(limited|ltd|llp|plc|the|and|&|uk|services|group)\b|[^a-z0-9 ]/g;
export function normaliseCompanyName(n: string): string {
  return n.toLowerCase().replace(STRIP, " ").replace(/\s+/g, " ").trim();
}

/** Find the registered entity behind a trading name (used to decide PECR status). */
export async function matchCompany(name: string, postcode?: string | null): Promise<ChCompany | null> {
  const data = await fetchJson<{ items?: (ChCompany & { title?: string; address?: { postal_code?: string } })[] }>(
    `${BASE}/search/companies?q=${encodeURIComponent(name)}&items_per_page=10`,
    { headers: auth() },
  );
  const target = normaliseCompanyName(name);
  for (const it of data.items ?? []) {
    const title = it.title ?? it.company_name ?? "";
    if (it.company_status && it.company_status !== "active") continue;
    if (normaliseCompanyName(title) !== target) continue;
    const pc = it.address?.postal_code?.replace(/\s/g, "").toUpperCase();
    if (postcode && pc && pc.slice(0, 3) !== postcode.replace(/\s/g, "").toUpperCase().slice(0, 3)) continue;
    return { ...it, company_name: title };
  }
  return null;
}
