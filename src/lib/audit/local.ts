// Local SEO checks: town in the headline, a page per service, a coverage page, name/address/phone
// on the page (and matching the Google listing), and complete business structured data.
// Pure functions: no network, easy to test.

import type { AuditCheck } from "../types";

export interface Link {
  href: string; // absolute URL
  text: string;
}

const STOP = new Set(["and", "the", "for", "with", "your", "from", "services", "service", "repairs", "local", "near", "domestic", "commercial"]);

/** All same-site links on the page (absolute URL + anchor text). */
export function internalLinks(html: string, pageUrl: string): Link[] {
  const origin = new URL(pageUrl).origin;
  const out: Link[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = new URL(m[1], pageUrl);
      if (u.origin !== origin) continue;
      u.hash = "";
      const key = u.pathname.replace(/\/$/, "") || "/";
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ href: u.toString(), text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    } catch {}
  }
  return out;
}

/** <loc> URLs from a sitemap (or the child sitemap URLs from a sitemap index). */
export function sitemapUrls(xml: string | null): { urls: string[]; children: string[] } {
  if (!xml) return { urls: [], children: [] };
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  return /<sitemapindex/i.test(xml) ? { urls: [], children: locs } : { urls: locs, children: [] };
}

/** Rough stem so "installation"/"installs"/"installer" all match "install". */
function stem(w: string) {
  return w.replace(/(ations?|ers?|ing|ies|es|s)$/, "").slice(0, 7);
}

function keyTokens(service: string): string[] {
  return service
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

/** Does any URL path or link text cover this service (all its key words present)? */
export function hasPageFor(service: string, links: Link[], urls: string[]): boolean {
  const tokens = keyTokens(service);
  if (!tokens.length) return false;
  const hay = [
    ...links.filter((l) => new URL(l.href).pathname.length > 1).map((l) => `${new URL(l.href).pathname} ${l.text}`),
    ...urls.map((u) => {
      try {
        return new URL(u).pathname;
      } catch {
        return u;
      }
    }),
  ].map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " "));
  return hay.some((h) => {
    const words = h.split(" ").map(stem);
    return tokens.every((t) => words.some((w) => w.startsWith(t) || t.startsWith(w) && w.length >= 4));
  });
}

/** UK phone numbers in text, as digits starting 0 (e.g. 02034886301). */
export function ukPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+44\s?\(?0?\)?\s?|\b0)(\d[\d\s\-()]{8,13}\d)/g)) {
    const digits = ("0" + m[1].replace(/\D/g, "")).replace(/^00/, "0");
    if (digits.length === 11 || digits.length === 10) out.add(digits);
  }
  return [...out];
}

export function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "").replace(/^44/, "0").replace(/^00/, "0");
  const n = d.startsWith("0") ? d : `0${d}`;
  return n.length >= 10 ? n : null;
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** JSON-LD objects on the page, flattened through @graph and arrays. */
export function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      out.push(o);
      if (o["@graph"]) walk(o["@graph"]);
    }
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // Malformed JSON-LD: Google ignores it too.
    }
  }
  return out;
}

const BIZ_TYPE = /LocalBusiness|Organization|ProfessionalService|HomeAndConstructionBusiness|Electrician|Plumber|HVACBusiness|RoofingContractor|GeneralContractor|HousePainter|Locksmith|MovingCompany|AutoWash|AutoRepair|BeautySalon|HairSalon|NailSalon|DaySpa|HealthAndBeautyBusiness|ExerciseGym|SportsActivityLocation|AccountingService|LegalService|InsuranceAgency|Store|EmergencyService|CleaningService|Dentist|MedicalBusiness/i;

/** Business structured data: present, and does it carry what Google and AI tools need? */
export function schemaCheck(html: string): AuditCheck {
  const objs = jsonLd(html);
  const typeOf = (o: Record<string, unknown>) => [o["@type"]].flat().map(String).join(" ");
  const biz = objs.find((o) => BIZ_TYPE.test(typeOf(o)));
  if (!biz) {
    return {
      id: "schema",
      label: "Business structured data",
      pass: false,
      impact: "high",
      detail: "Not clearly. The site is missing the behind-the-scenes business details Google and AI tools read, so they have to guess.",
    };
  }
  const has = (k: string) => {
    const v = biz[k];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
  };
  const missing = [
    !has("name") && "business name",
    !has("address") && "address",
    !has("telephone") && "phone number",
    !(has("areaServed") || has("geo") || has("serviceArea")) && "areas you cover",
    !(has("openingHoursSpecification") || has("openingHours")) && "opening hours",
  ].filter(Boolean) as string[];
  const local = /LocalBusiness|HomeAndConstruction|Electrician|Plumber|Salon|Spa|Auto|Cleaning|Contractor|Locksmith|Gym/i.test(typeOf(biz));
  const pass = missing.length <= 1 && local;
  return {
    id: "schema",
    label: "Business structured data",
    pass,
    impact: "high",
    detail: pass
      ? `Yes, it's set up as a ${typeOf(biz).split(" ")[0]}${missing.length ? `, though it's missing your ${missing[0]}` : ""}.`
      : !local
        ? `Partly. It's marked up as a general "${typeOf(biz).split(" ")[0]}", not a local business${missing.length ? `, and it's missing your ${and(missing)}` : ""}, so Google and AI tools can't tell where you work.`
        : `Partly. It's there but missing your ${and(missing)}, which Google and AI tools use to match you to local searches.`,
  };
}

function and(xs: string[]) {
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

export interface LocalFacts {
  html: string;
  title: string | null;
  h1: string | null;
  visibleText: string;
  city: string | null;
  knownPhone: string | null; // from their Google listing / the form they filled in
  services: string[];
  links: Link[];
  sitemap: string[];
}

export function localChecks(f: LocalFacts): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const town = f.city?.trim();

  if (town) {
    const re = new RegExp(`\\b${town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const inTitle = !!f.title && re.test(f.title);
    const inH1 = !!f.h1 && re.test(f.h1);
    checks.push({
      id: "local_headline",
      label: `${town} in your page title or main heading`,
      pass: inTitle || inH1,
      impact: "high",
      detail:
        inTitle || inH1
          ? `Yes, ${inTitle ? "the page title" : "the main heading"} mentions ${town}.`
          : `No. Neither the page title nor the main heading says ${town}, so Google has less to go on when someone searches "${town}" plus what you do.`,
    });
  }

  if (f.services.length) {
    const svc = f.services.slice(0, 6);
    const covered = svc.filter((s) => hasPageFor(s, f.links, f.sitemap));
    const missing = svc.filter((s) => !covered.includes(s));
    const pass = missing.length === 0 || covered.length / svc.length >= 0.8;
    checks.push({
      id: "service_pages",
      label: "A page for each service",
      pass,
      impact: "high",
      detail: pass
        ? `Yes, ${covered.length === svc.length ? "every service we found" : `${covered.length} of ${svc.length} services`} has its own page.`
        : covered.length === 0
          ? `No. You offer ${and(svc.slice(0, 4))}, but none of them has its own page. A dedicated page is usually what ranks for "${svc[0]}${town ? ` ${town}` : ""}".`
          : `Only ${covered.length} of ${svc.length}. There's no page for ${and(missing.slice(0, 3))}, so you're unlikely to show up when people search for ${missing.length > 1 ? "those" : "that"}.`,
    });
  }

  const areaPage =
    f.links.some((l) => /(areas?[-\s]?(we[-\s]?)?(cover|serve)|coverage|service[-\s]?areas?|locations?)/i.test(`${new URL(l.href).pathname} ${l.text}`)) ||
    f.sitemap.some((u) => /(areas?-(we-)?(cover|serve)|coverage|service-areas?|locations?)/i.test(u));
  checks.push({
    id: "service_areas",
    label: "Areas you cover",
    pass: areaPage,
    impact: "medium",
    detail: areaPage
      ? "Yes, there's a page listing where you work."
      : `No page lists the towns you cover, so you're unlikely to show up in searches for ${town ? `places near ${town}` : "nearby towns"}.`,
  });

  const phones = ukPhones(`${f.visibleText} ${[...f.html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => m[1]).join(" ")}`);
  const postcode = POSTCODE.test(f.visibleText);
  const known = normPhone(f.knownPhone);
  const match = known ? phones.includes(known) : null;
  const napPass = phones.length > 0 && postcode && match !== false;
  const pretty = (p: string) => (p.length === 11 ? `${p.slice(0, p.startsWith("07") ? 5 : 3)} ${p.slice(p.startsWith("07") ? 5 : 3, 7)} ${p.slice(7)}` : p);
  checks.push({
    id: "nap",
    label: "Name, address and phone on the page",
    pass: napPass,
    impact: "medium",
    detail: napPass
      ? `Yes${known ? ", and the number matches your Google listing" : ""}.`
      : match === false && phones.length
        ? `The number on your site (${pretty(phones[0])}) doesn't match the one on your Google listing (${pretty(known!)}). Mismatches like that make Google less sure it's the same business.`
        : !phones.length && !postcode
          ? "There's no phone number or address on the homepage. Google and AI tools use these to confirm where you are."
          : !phones.length
            ? "There's no phone number on the homepage."
            : "There's no address or postcode on the homepage, so Google has to work out where you're based from elsewhere.",
  });

  return checks;
}
