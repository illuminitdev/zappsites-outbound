import type { Audit, AuditCategory, AuditCheck } from "../types";
import { schemaCheck } from "./local";

/** Pure HTML/robots analysis. No network: easy to test. */
export interface PageFacts {
  finalUrl: string;
  html: string;
  responseMs: number;
  bytes: number;
  robotsTxt: string | null;
  hasSitemap: boolean;
  hasLlmsTxt: boolean;
  now?: Date;
}

const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"];

function first(re: RegExp, s: string): string | null {
  const m = s.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Which AI crawlers robots.txt blocks from the whole site. */
export function blockedAiBots(robots: string | null): string[] {
  if (!robots) return [];
  // Parse into groups: consecutive user-agent lines share the rules that follow them.
  const groups: { agents: string[]; disallowAll: boolean; allowRoot: boolean }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallowAll: false, allowRoot: false };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val === "/") cur.disallowAll = true;
    if (key === "allow" && val === "/") cur.allowRoot = true;
  }
  const blocked: string[] = [];
  for (const bot of AI_BOTS) {
    const specific = groups.filter((g) => g.agents.includes(bot.toLowerCase()));
    const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
    if (applicable.some((g) => g.disallowAll && !g.allowRoot)) blocked.push(bot);
  }
  return blocked;
}

export function analyzePage(f: PageFacts): AuditCheck[] {
  const html = f.html;
  const lower = html.toLowerCase();
  const now = f.now ?? new Date();
  const checks: AuditCheck[] = [];
  const add = (c: AuditCheck) => checks.push(c);

  const https = f.finalUrl.startsWith("https://");
  add({
    id: "https",
    label: "Secure connection (HTTPS)",
    pass: https,
    impact: "high",
    detail: https ? "Yes, it loads securely." : "No. Browsers show a 'Not secure' warning next to your address, which puts people off.",
  });

  const title = first(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const titleOk = !!title && title.length >= 10 && title.length <= 65;
  add({
    id: "title",
    label: "Page title",
    pass: titleOk,
    impact: "high",
    detail: !title
      ? "There isn't one, so Google has to make up the headline for your listing."
      : titleOk
        ? `"${title}"`
        : `It's "${title.slice(0, 70)}". ${title.length < 10 ? "That doesn't tell searchers what you do or where." : "That's too long, so Google cuts it off."}`,
  });

  const desc =
    first(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i, html) ??
    first(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i, html);
  add({
    id: "meta_description",
    label: "Meta description",
    pass: !!desc && desc.length >= 50,
    impact: "medium",
    detail: desc ? "Yes, there's one set." : "There isn't one, so Google picks a random bit of text from the page.",
  });

  const h1s = (html.match(/<h1[\s>]/gi) ?? []).length;
  add({
    id: "h1",
    label: "Main heading (H1)",
    pass: h1s === 1,
    impact: "medium",
    detail: h1s === 0 ? "No. The homepage doesn't have a main heading saying what you do." : h1s === 1 ? "Yes." : `There are ${h1s} competing main headings. One clear one works better.`,
  });

  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  add({
    id: "mobile",
    label: "Mobile-friendly setup",
    pass: viewport,
    impact: "high",
    detail: viewport ? "Yes." : "No. On a phone it probably shows as a shrunk-down desktop page that people have to pinch and zoom.",
  });

  add(schemaCheck(html));

  const blocked = blockedAiBots(f.robotsTxt);
  add({
    id: "ai_crawlers",
    label: "AI assistants can read the site",
    pass: blocked.length === 0,
    impact: "high",
    detail: blocked.length
      ? `No. Your site settings block ${blocked.join(", ")}, so those assistants can't use your site when answering.`
      : "Yes, nothing is blocking them.",
  });

  add({
    id: "llms_txt",
    label: "llms.txt guide for AI",
    pass: f.hasLlmsTxt,
    impact: "low",
    detail: f.hasLlmsTxt ? "Yes." : "Not yet. It's a small file that tells AI tools what you do. Quick to add.",
  });

  add({
    id: "sitemap",
    label: "XML sitemap",
    pass: f.hasSitemap,
    impact: "medium",
    detail: f.hasSitemap ? "Yes." : "No, so Google may be missing some of your pages.",
  });

  const telLink = /href=["']tel:/i.test(html);
  add({
    id: "click_to_call",
    label: "Click-to-call phone link",
    pass: telLink,
    impact: "medium",
    detail: telLink ? "Yes." : "No. On a phone people have to copy your number out by hand, and many won't bother.",
  });

  const cta = /(get a quote|free quote|request a quote|book (a|an|your)|contact us|get in touch|call (us|now)|enquire)/i.test(html);
  const form = /<form[\s>]/i.test(html);
  add({
    id: "cta",
    label: "Clear call to action",
    pass: cta || form,
    impact: "medium",
    detail: cta || form ? "Yes." : "Not really. There's no obvious 'get a quote' or 'call us' on the homepage.",
  });

  const years = [...lower.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/g)].map((m) => Number(m[1]));
  const latest = years.length ? Math.max(...years) : null;
  const stale = latest !== null && latest < now.getFullYear() - 1;
  if (latest !== null) {
    add({
      id: "freshness",
      label: "Site looks maintained",
      pass: !stale,
      impact: "low",
      detail: stale ? `The footer still says © ${latest}. Small thing, but people notice and wonder if you're still trading.` : "Yes.",
    });
  }

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  if (imgs.length >= 3) {
    const withAlt = imgs.filter((i) => /\balt=["'][^"']+["']/i.test(i)).length;
    const ratio = withAlt / imgs.length;
    add({
      id: "alt_text",
      label: "Image descriptions (alt text)",
      pass: ratio >= 0.8,
      impact: "low",
      detail: `${withAlt} of ${imgs.length} images have descriptions.`,
    });
  }

  const slow = f.responseMs > 1500;
  add({
    id: "response_time",
    label: "Server response time",
    pass: !slow,
    impact: "medium",
    detail: slow ? `Your server took ${(f.responseMs / 1000).toFixed(1)} seconds just to start sending the page. Under 1 second is normal.` : "Yes.",
  });

  return checks;
}

const WEIGHT = { high: 3, medium: 2, low: 1 } as const;

/** Highest score a site can get while any high-impact problem is still open. */
export const HIGH_ISSUE_CEILING = 69;

/** True when a high-impact check fails or Google rates mobile speed below 50. */
export function hasHighImpactIssue(checks: AuditCheck[], mobileScore: number | null): boolean {
  return checks.some((c) => !c.pass && !c.unverified && c.impact === "high") || (mobileScore !== null && mobileScore < 50);
}

/**
 * 0-100 from checks plus optional Lighthouse mobile score (weighted as a high-impact check x2).
 * A site with any high-impact problem (not recommended by AI, slow on phones, no HTTPS...) can't score
 * above HIGH_ISSUE_CEILING: a high number should mean there's nothing serious left to fix.
 */
export function scoreAudit(checks: AuditCheck[], mobileScore: number | null): number {
  let total = 0;
  let got = 0;
  for (const c of checks) {
    if (c.unverified) continue;
    total += WEIGHT[c.impact];
    if (c.pass) got += WEIGHT[c.impact];
  }
  if (mobileScore !== null) {
    total += 6;
    got += (mobileScore / 100) * 6;
  }
  const raw = total ? Math.round((got / total) * 100) : 0;
  return hasHighImpactIssue(checks, mobileScore) ? Math.min(raw, HIGH_ISSUE_CEILING) : raw;
}

/** The score to show for a saved audit (applies the ceiling to audits saved before it existed). */
export function displayScore(a: Pick<Audit, "score" | "checks" | "performance">): number {
  return hasHighImpactIssue(a.checks, a.performance?.mobileScore ?? null) ? Math.min(a.score, HIGH_ISSUE_CEILING) : a.score;
}

export function topIssues(checks: AuditCheck[], n = 3): AuditCheck[] {
  return checks
    .filter((c) => !c.pass && !c.unverified)
    .sort((a, b) => WEIGHT[b.impact] - WEIGHT[a.impact])
    .slice(0, n);
}

/** Which section of the report each check belongs to. */
export const CATEGORY: Record<string, AuditCategory> = {
  ai_mentions: "ai", ai_crawlers: "ai", llms_txt: "ai", faq: "ai", blog: "ai",
  indexable: "google", title: "google", meta_description: "google", h1: "google", headings: "google", sitemap: "google", canonical: "google", redirects: "google", content_depth: "google",
  local_headline: "local", service_pages: "local", service_areas: "local", nap: "local", schema: "local", maps_link: "local", opening_hours: "local",
  mobile_speed: "speed", mobile: "speed", response_time: "speed", image_formats: "speed",
  reviews: "trust", accreditations: "trust", freshness: "trust", og_tags: "trust", favicon: "trust", social_links: "trust", privacy_policy: "trust", pricing_signal: "trust",
  cta: "content", click_to_call: "content", contact_form: "content", online_booking: "content", whatsapp: "content",
  reachable: "technical", https: "technical", mixed_content: "technical", hsts: "technical", broken_links: "technical", not_found: "technical", alt_text: "technical", lang: "technical", email_auth: "technical",
};

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  ai: "AI assistants",
  google: "Showing up on Google",
  local: "Local search",
  speed: "Speed on a phone",
  trust: "Trust and first impressions",
  content: "Turning visitors into enquiries",
  technical: "Behind the scenes",
};

const CATEGORY_ORDER: AuditCategory[] = ["ai", "google", "local", "speed", "content", "trust", "technical"];

export function groupChecks(checks: AuditCheck[]): { category: AuditCategory; label: string; checks: AuditCheck[]; passed: number; total: number }[] {
  return CATEGORY_ORDER.map((category) => {
    const cs = checks.filter((c) => (CATEGORY[c.id] ?? "technical") === category);
    const counted = cs.filter((c) => !c.unverified);
    return { category, label: CATEGORY_LABEL[category], checks: cs, passed: counted.filter((c) => c.pass).length, total: counted.length };
  }).filter((g) => g.checks.length);
}
