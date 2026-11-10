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
