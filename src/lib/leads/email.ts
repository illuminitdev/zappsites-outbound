import { promises as dns } from "node:dns";
import { env } from "../env";
import { fetchJson, fetchText, toDomain } from "../http";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const JUNK = /(\.(png|jpe?g|gif|svg|webp)$)|sentry|wixpress|example\.|domain\.com|yourdomain|@2x|email\.com$/i;
const GENERIC = ["info", "hello", "enquiries", "enquiry", "contact", "office", "admin", "sales", "mail", "team", "help", "support"];

export function isValidSyntax(email: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
}

/** Pull plausible addresses out of HTML, decoding simple obfuscation. */
export function extractEmails(html: string, domain: string | null): string[] {
  const decoded = html
    .replace(/&#64;|&#x40;|\s\[at\]\s|\(at\)/gi, "@")
    .replace(/&#46;|\s\[dot\]\s|\(dot\)/gi, ".");
  const found = new Set<string>();
  for (const m of decoded.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/^mailto:/, "").replace(/\.$/, "");
    if (!JUNK.test(e) && isValidSyntax(e)) found.add(e);
  }
  const all = [...found];
  if (!domain) return all;
  // Same-domain first; third-party addresses (gmail etc.) are kept after.
  return all.sort((a, b) => Number(b.endsWith(`@${domain}`)) - Number(a.endsWith(`@${domain}`)));
}

/** Prefer a named person's address, then a generic inbox on the company domain. */
export function pickBest(emails: string[], domain: string | null, firstName?: string | null): string | null {
  if (!emails.length) return null;
  const onDomain = domain ? emails.filter((e) => e.endsWith(`@${domain}`)) : emails;
  const pool = onDomain.length ? onDomain : emails;
  if (firstName) {
    const f = firstName.toLowerCase();
    const named = pool.find((e) => e.split("@")[0].includes(f));
    if (named) return named;
  }
  const personal = pool.find((e) => !GENERIC.includes(e.split("@")[0]));
  if (personal) return personal;
  for (const g of GENERIC) {
    const hit = pool.find((e) => e.split("@")[0] === g);
    if (hit) return hit;
  }
  return pool[0];
}

export async function scrapeSiteEmails(website: string): Promise<string[]> {
  const domain = toDomain(website);
  const base = website.replace(/\/$/, "");
  const paths = ["", "/contact", "/contact-us", "/about", "/about-us"];
  const all = new Set<string>();
  for (const p of paths) {
    const r = await fetchText(base + p, { timeoutMs: 10000, maxBytes: 1_500_000 });
    if (r.ok) extractEmails(r.text, domain).forEach((e) => all.add(e));
    if (all.size >= 5) break;
  }
  return extractEmails([...all].join(" "), domain);
}

export async function hasMx(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    return mx.length > 0;
  } catch {
    return false;
  }
}

interface HunterDomain {
  data?: { emails?: { value: string; confidence: number; type: string; first_name?: string; last_name?: string; seniority?: string; position?: string }[] };
}

async function hunterFind(domain: string): Promise<{ email: string; first?: string; last?: string } | null> {
  const key = env.hunterKey();
  if (!key) return null;
  const r = await fetchJson<HunterDomain>(
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${key}`,
  );
  const list = (r.data?.emails ?? []).filter((e) => e.confidence >= 70);
  const rank = (e: (typeof list)[number]) =>
    (e.type === "personal" ? 2 : 0) +
    (e.seniority === "executive" ? 3 : 0) +
    (/owner|director|founder|managing|partner/i.test(e.position ?? "") ? 3 : 0);
  const best = list.sort((a, b) => rank(b) - rank(a))[0];
  return best ? { email: best.value.toLowerCase(), first: best.first_name, last: best.last_name } : null;
}

async function hunterVerify(email: string): Promise<"valid" | "risky" | "invalid" | null> {
  const key = env.hunterKey();
  if (!key) return null;
  const r = await fetchJson<{ data?: { status?: string } }>(
    `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${key}`,
  );
  const s = r.data?.status;
  if (s === "valid") return "valid";
  if (s === "invalid" || s === "disposable") return "invalid";
  return "risky"; // accept_all, webmail, unknown
}

export interface EmailResult {
  email: string | null;
  status: "valid" | "risky" | "invalid" | "unknown";
  source: string | null;
  firstName?: string;
  lastName?: string;
}

/**
 * Find and verify an address. Never guesses patterns: a guessed address that bounces
 * damages your sending domain more than a missing lead costs you.
 */
export async function findEmail(p: {
  email?: string | null;
  website?: string | null;
  firstName?: string | null;
}): Promise<EmailResult> {
  const domain = toDomain(p.website);
  let email = p.email?.toLowerCase().trim() || null;
  let source: string | null = email ? "csv" : null;
  let firstName: string | undefined;
  let lastName: string | undefined;

  if (!email && p.website) {
    const scraped = await scrapeSiteEmails(p.website);
    email = pickBest(scraped, domain, p.firstName);
    if (email) source = "site";
  }
  if (!email && domain) {
    const h = await hunterFind(domain).catch(() => null);
    if (h) {
      email = h.email;
      source = "hunter";
      firstName = h.first;
      lastName = h.last;
    }
  }
  if (!email) return { email: null, status: "unknown", source: null };
  if (!isValidSyntax(email)) return { email, status: "invalid", source };

  const verified = await hunterVerify(email).catch(() => null);
  if (verified) return { email, status: verified, source, firstName, lastName };

  const mx = await hasMx(email.split("@")[1]);
  // Published on their own site + MX record = good enough to send to.
  const status = !mx ? "invalid" : source === "site" || source === "csv" ? "valid" : "risky";
  return { email, status, source, firstName, lastName };
}
