// Service-aware AEO prompts. Reads what the business actually offers from its own website,
// then writes the buyer questions around those services, so a boiler engineer is asked about
// "emergency boiler repair in Leeds" rather than a generic "best plumbers in Leeds".

import { fetchText } from "../http";
import { structured } from "../claude";

export interface BusinessProfile {
  category: string; // e.g. "plumbers" (plural, how a buyer says it)
  services: string[]; // e.g. ["boiler repair", "boiler installation", "bathroom fitting"]
  area: string | null; // town/city they serve, if the site says
  prompts: string[]; // buyer questions, never naming the business
  source: "website" | "fallback";
}

const SERVICE_LINK = /(services?|what-?we-?do|treatments?|prices?|pricing|menu|our-?work)/i;

/** Visible text from HTML: title, meta description, headings, nav and body, capped. */
export function pageText(html: string, max = 6000): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/a|\/td)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ");
  const lines = body
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
  const unique = [...new Set(lines)];
  return [`TITLE: ${decode(title)}`, desc && `DESCRIPTION: ${decode(desc)}`, unique.join("\n")].filter(Boolean).join("\n").slice(0, max);
}

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();
}

/** First same-site link that looks like a services/prices page. */
export function findServicesLink(html: string, pageUrl: string): string | null {
  const origin = new URL(pageUrl).origin;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!SERVICE_LINK.test(href) && !SERVICE_LINK.test(label.replace(/<[^>]+>/g, ""))) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.origin === origin && u.pathname !== new URL(pageUrl).pathname) return u.toString();
    } catch {}
  }
  return null;
}

/** Drop prompts that name the business (a mention would then be meaningless) and tidy the rest. */
export function cleanPrompts(prompts: string[], company: string, domain: string | null, max: number): string[] {
  const words = company
    .toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|the|and|&|co|services?|uk)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  const host = domain?.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of prompts) {
    const p = raw.replace(/\s+/g, " ").replace(/^["'\d.\-\s]+|["']+$/g, "").trim();
    const l = p.toLowerCase();
    if (p.length < 12 || p.length > 200) continue;
    if (host.length > 3 && l.includes(host)) continue;
    if (words.length && words.every((w) => l.includes(w))) continue;
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/** Deterministic questions when Claude is unavailable: one per service, then the category. */
export function templatePrompts(p: { services: string[]; category: string; city: string | null }, max: number): string[] {
  const where = p.city ? `in ${p.city}` : "near me in the UK";
  const t = [
    (s: string) => `Who's the best company for ${s} ${where}?`,
    (s: string) => `I need ${s} ${where}. Who would you recommend?`,
    (s: string) => `Can you recommend someone reliable for ${s} ${where}?`,
  ];
  const out = p.services.slice(0, max).map((s, i) => t[i % t.length](s));
  if (out.length < max && p.category) out.push(`Who are the best ${p.category} ${where}?`);
  if (out.length < max && p.category) out.push(`Which ${p.category} ${where} would you shortlist and why?`);
  return out.slice(0, max);
}

/**
 * Work out what this business sells and write buyer questions about it.
 * `html` is the homepage the audit already fetched; a services page is fetched if linked.
 */
export async function profileBusiness(p: {
  company: string;
  domain: string | null;
  city: string | null;
  category: string; // campaign / trade category; may be empty
  html: string | null;
  pageUrl: string | null;
  max: number;
}): Promise<BusinessProfile | null> {
  let text = p.html ? pageText(p.html, 5000) : "";
  if (p.html && p.pageUrl) {
    const link = findServicesLink(p.html, p.pageUrl);
    if (link) {
      const sp = await fetchText(link, { timeoutMs: 8000, maxBytes: 1_500_000 }).catch(() => null);
      if (sp?.ok && sp.text) text += `\n\n--- ${link} ---\n${pageText(sp.text, 4000)}`;
    }
  }

  if (!text.trim()) {
    if (!p.category) return null;
    return { category: p.category, services: [], area: p.city, prompts: templatePrompts({ services: [], category: p.category, city: p.city }, p.max), source: "fallback" };
  }

  try {
    const r = await structured<{ category: string; services: string[]; area: string | null; prompts: string[] }>({
      model: process.env.AEO_PROFILE_MODEL || undefined,
      maxTokens: 900,
      toolName: "business_profile",
      system:
        "You read a small UK business's website and work out what customers would ask an AI assistant when looking for a business like it. Only use services the website actually mentions. British English.",
      prompt: `Business: ${p.company}${p.domain ? ` (${p.domain})` : ""}
Known town/city: ${p.city ?? "unknown"}
Known category: ${p.category || "unknown"}

Website text:
"""
${text}
"""

Return:
- category: what this kind of business is called by customers, plural and lower case (e.g. "plumbers", "mobile car valeters", "beauty salons").
- services: up to 6 specific services from the website that customers search for, most profitable or most prominent first, lower case, as a customer would say them (e.g. "boiler installation", not "Gas Safe registered heating solutions").
- area: the main town or city they serve, if the site says; otherwise null.
- prompts: exactly ${p.max} questions a potential customer would type into ChatGPT to find a business like this. Each must be about one of the services (cover different services), include the area (use "${p.city ?? "their area"}" if known), sound like a real person, and NEVER mention ${p.company}, its domain, or any other business by name.`,
      schema: {
        type: "object",
        properties: {
          category: { type: "string" },
          services: { type: "array", items: { type: "string" }, maxItems: 6 },
          area: { type: ["string", "null"] },
          prompts: { type: "array", items: { type: "string" } },
        },
        required: ["category", "services", "area", "prompts"],
      },
    });
    const services = (r.services ?? []).map((s) => s.trim().toLowerCase()).filter((s) => s && s.length < 60).slice(0, 6);
    const category = (p.category || r.category || "").trim();
    const city = p.city || r.area || null;
    let prompts = cleanPrompts(r.prompts ?? [], p.company, p.domain, p.max);
    if (prompts.length < p.max) {
      prompts = cleanPrompts([...prompts, ...templatePrompts({ services, category, city }, p.max)], p.company, p.domain, p.max);
    }
    if (!prompts.length) return null;
    return { category, services, area: city, prompts, source: "website" };
  } catch {
    if (!p.category) return null;
    return { category: p.category, services: [], area: p.city, prompts: templatePrompts({ services: [], category: p.category, city: p.city }, p.max), source: "fallback" };
  }
}

/** Campaign prompts can use {service}: expand them across the detected services. */
export function expandServiceTemplates(templates: string[], services: string[], max: number): string[] {
  const out: string[] = [];
  let i = 0;
  for (const t of templates) {
    if (!t.includes("{service}")) out.push(t);
    else if (services.length) out.push(t.replaceAll("{service}", services[i++ % services.length]));
  }
  // Add more {service} variants until max, rotating through services.
  const svcTpl = templates.filter((t) => t.includes("{service}"));
  while (out.length < max && svcTpl.length && services.length && i < services.length * svcTpl.length) {
    out.push(svcTpl[i % svcTpl.length].replaceAll("{service}", services[i % services.length]));
    i++;
  }
  return [...new Set(out)].slice(0, max);
}
