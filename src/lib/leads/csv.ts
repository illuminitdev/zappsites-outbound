import Papa from "papaparse";
import { toDomain, toUrl } from "../http";
import type { EntityType } from "../types";

export interface LeadInput {
  company: string;
  website: string | null;
  domain: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
  entity_type: EntityType;
  source: string;
  source_ref: string | null;
}

const ALIASES: Record<keyof Omit<LeadInput, "domain" | "source" | "source_ref">, string[]> = {
  company: ["company", "company name", "business", "business name", "name", "organisation", "organization"],
  website: ["website", "url", "site", "web", "domain"],
  email: ["email", "email address", "e-mail"],
  first_name: ["first name", "first_name", "firstname", "forename", "contact first name"],
  last_name: ["last name", "last_name", "lastname", "surname"],
  city: ["city", "town", "location", "locality"],
  entity_type: ["entity type", "entity_type", "company type", "type"],
};

function normEntity(v: string | undefined): EntityType {
  const s = (v ?? "").toLowerCase();
  if (/\bllp\b/.test(s)) return "llp";
  if (/ltd|limited|plc|company/.test(s)) return "company";
  if (/sole/.test(s)) return "sole_trader";
  if (/partner/.test(s)) return "partnership";
  return "unknown";
}

/** Parse a CSV with flexible headers into lead inputs. Rows without a company or website/email are skipped. */
export function parseLeadsCsv(text: string): { leads: LeadInput[]; skipped: number } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim().toLowerCase());
  const col = (key: keyof typeof ALIASES) => {
    const idx = headers.findIndex((h) => ALIASES[key].includes(h));
    return idx === -1 ? null : parsed.meta.fields![idx];
  };
  const map = Object.fromEntries((Object.keys(ALIASES) as (keyof typeof ALIASES)[]).map((k) => [k, col(k)]));
  const get = (row: Record<string, string>, k: keyof typeof ALIASES) => {
    const c = map[k];
    const v = c ? row[c]?.trim() : "";
    return v ? v : null;
  };

  const leads: LeadInput[] = [];
  let skipped = 0;
  for (const row of parsed.data) {
    const company = get(row, "company");
    const website = toUrl(get(row, "website"));
    const email = get(row, "email")?.toLowerCase() ?? null;
    if (!company || (!website && !email)) {
      skipped++;
      continue;
    }
    leads.push({
      company,
      website,
      domain: toDomain(website) ?? (email ? email.split("@")[1] : null),
      email,
      first_name: get(row, "first_name"),
      last_name: get(row, "last_name"),
      city: get(row, "city"),
      entity_type: normEntity(get(row, "entity_type") ?? company),
      source: "csv",
      source_ref: null,
    });
  }
  return { leads, skipped };
}
