// Pure helpers for the AEO/GEO mentions audit. No network: tested in tests/aeo.test.ts.

import { normaliseCompanyName } from "../leads/companiesHouse";

export interface MentionTarget {
  company: string;
  domain: string | null;
}

export interface MentionHit {
  mentioned: boolean; // brand name or domain appears in the answer text
  cited: boolean; // their domain is among the sources the engine cited
  position: number | null; // 1-based rank if the answer is a list and they're in it
  snippet: string | null; // the sentence that mentions them
}

const GENERIC_WORDS = new Set(["insurance", "brokers", "broker", "electrical", "electricians", "plumbing", "services", "solutions", "consulting", "associates", "partners", "company", "uk", "ltd", "limited"]);

/** Distinctive brand tokens: "Brightcover Insurance Brokers Ltd" -> ["brightcover"]. */
export function brandTokens(company: string): string[] {
  const words = normaliseCompanyName(company).split(" ").filter(Boolean);
  const distinctive = words.filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  return distinctive.length ? distinctive : words;
}

export function domainRoot(domain: string | null): string | null {
  if (!domain) return null;
  return domain.toLowerCase().replace(/^www\./, "");
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lines that look like list entries ("1. Acme", "- **Acme** -", "### Acme"). */
export function listEntries(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:\d+[.)]|[-*•]|#{2,4})\s+(.*)$/);
    if (!m) continue;
    const entry = m[1]
      .replace(/\*\*|__|\[|\]\([^)]*\)/g, "")
      .split(/\s[–—-]\s|:\s|\s\(/)[0]
      .trim();
    if (entry && entry.length <= 80) out.push(entry);
  }
  return out;
}

export function detectMention(text: string, citations: string[], t: MentionTarget): MentionHit {
  const lower = text.toLowerCase();
  const tokens = brandTokens(t.company);
  const root = domainRoot(t.domain);
  // Every distinctive token must appear as a whole word (avoids "Bright" matching "Brightcover").
  const nameRe = tokens.length ? new RegExp(tokens.map((w) => `(?=.*\\b${escapeRe(w)}\\b)`).join(""), "is") : null;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const hitSentence = sentences.find((s) => (nameRe && nameRe.test(s)) || (root && s.toLowerCase().includes(root)));
  const mentioned = !!hitSentence || (!!root && lower.includes(root));
  const cited = !!root && citations.some((u) => {
    try {
      return new URL(u).hostname.toLowerCase().replace(/^www\./, "").endsWith(root);
    } catch {
      return u.toLowerCase().includes(root);
    }
  });
  let position: number | null = null;
  if (mentioned) {
    const entries = listEntries(text);
    const idx = entries.findIndex((e) => (nameRe && nameRe.test(e)) || (root && e.toLowerCase().includes(root)));
    position = idx >= 0 ? idx + 1 : null;
  }
  return { mentioned: mentioned || cited, cited, position, snippet: hitSentence ? hitSentence.trim().slice(0, 240) : null };
}

const NOT_A_BUSINESS = /^(tips?|summary|conclusion|note|why|how|what|key|factors?|considerations?|questions?|step|option|pros|cons|cost|price|look for|check|ask|reviews?|recommendations?|final|bottom line|other|also|here|these|top)\b/i;

/** Businesses the engine recommended instead (list entries that aren't the target or advice headings). */
export function competitorsIn(text: string, t: MentionTarget): string[] {
  const tokens = brandTokens(t.company);
  const root = domainRoot(t.domain);
  return listEntries(text).filter((e) => {
    const l = e.toLowerCase();
    if (NOT_A_BUSINESS.test(e)) return false;
    if (tokens.length && tokens.every((w) => l.includes(w))) return false;
    if (root && l.includes(root)) return false;
    // Business names are short and start with a capital or digit.
    return /^[A-Z0-9]/.test(e) && e.split(/\s+/).length <= 7;
  });
}

/** Cited domains other than the target's, most frequent first. */
export function citedCompetitorDomains(citations: string[], t: MentionTarget): string[] {
  const root = domainRoot(t.domain);
  const counts = new Map<string, number>();
  for (const u of citations) {
    let host: string;
    try {
      host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
    if (root && host.endsWith(root)) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}

/** Fill a prompt template: {category}, {city}, {company}. Missing city becomes "the UK". */
export function fillPrompt(tpl: string, v: { category: string; city: string | null; company: string }): string {
  return tpl
    .replaceAll("{category}", v.category)
    .replaceAll("{company}", v.company)
    .replaceAll("in {city}", v.city ? `in ${v.city}` : "in the UK")
    .replaceAll("{city}", v.city ?? "the UK")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rank names by how many answers mention them (case-insensitive, merged). */
export function tally(names: string[]): { name: string; count: number }[] {
  const m = new Map<string, { name: string; count: number }>();
  for (const n of names) {
    const k = n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!k) continue;
    const cur = m.get(k);
    if (cur) cur.count++;
    else m.set(k, { name: n, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
