import { env } from "../env";
import { fetchJson, fetchText } from "../http";
import type { AeoAudit, Audit, AuditCheck } from "../types";
import { analyzePage, scoreAudit, topIssues } from "./analyze";
import { DEFAULT_AEO_PROMPTS, enabledEngines, runMentionsAudit } from "./mentions";
import { expandServiceTemplates, profileBusiness } from "./services";

export interface AeoContext {
  company: string;
  domain: string | null;
  city: string | null;
  category: string; // campaign/trade category; may be empty (then read from their site)
  prompts?: string[]; // campaign prompts; empty = write them from the services on their site
}

function customPrompts(prompts: string[] | undefined): string[] | null {
  const list = (prompts ?? []).map((p) => p.trim()).filter(Boolean);
  if (!list.length) return null;
  const legacy = list.length === DEFAULT_AEO_PROMPTS.length && list.every((p, i) => p === DEFAULT_AEO_PROMPTS[i]);
  return legacy ? null : list;
}

/**
 * Build the buyer questions and run the mentions audit.
 * Default: read the services from their website and ask about those.
 * Campaign prompts without {service} are used as written; with {service} they're filled from the site.
 */
export async function aeoForLead(ctx: AeoContext, html: string | null, pageUrl: string | null): Promise<AeoAudit | null> {
  if (!enabledEngines().length) return null;
  const max = Number(process.env.AEO_MAX_PROMPTS || 3);
  const custom = customPrompts(ctx.prompts);
  if (custom && !custom.some((t) => t.includes("{service}"))) {
    return runMentionsAudit({ ...ctx, prompts: custom, promptSource: "campaign" });
  }
  const profile = await profileBusiness({ company: ctx.company, domain: ctx.domain, city: ctx.city, category: ctx.category, html, pageUrl, max });
  if (!profile) return null;
  const prompts = custom ? expandServiceTemplates(custom, profile.services, max) : profile.prompts;
  if (!prompts.length) return null;
  return runMentionsAudit({
    company: ctx.company,
    domain: ctx.domain,
    city: ctx.city ?? profile.area,
    category: profile.category || ctx.category || "local businesses",
    prompts,
    services: profile.services,
    promptSource: custom ? "campaign" : profile.source,
  });
}

/** Turn mention results into a scored check. */
export function aeoCheck(aeo: AeoAudit): AuditCheck {
  const engines = [...new Set(aeo.results.filter((r) => r.mentioned).map((r) => r.engine))];
  const names = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" } as const;
  const rivals = aeo.topCompetitors.slice(0, 3).map((c) => c.name);
  const pass = aeo.mentionRate >= 50;
  return {
    id: "ai_mentions",
    label: "Recommended by AI assistants",
    pass,
    impact: "high",
    detail:
      aeo.mentions === 0
        ? `No. I asked ${aeo.answered === 1 ? "an AI assistant" : "AI assistants"} things like "${aeo.prompts[0]}" ${aeo.answered} times and you didn't come up once.${rivals.length ? ` They suggested ${rivals.join(", ")} instead.` : ""}`
        : pass
          ? `Mostly. You came up in ${aeo.mentions} of ${aeo.answered} answers (${engines.map((e) => names[e]).join(", ")}).`
          : `Rarely. You came up in ${aeo.mentions} of ${aeo.answered} answers, only from ${engines.map((e) => names[e]).join(" and ")}.${rivals.length ? ` ${rivals.join(", ")} came up more.` : ""}`,
  };
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number; details?: { data?: string } }>;
  };
}

export async function pageSpeed(url: string): Promise<Audit["performance"]> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance" });
  const key = env.pagespeedKey();
  if (key) q.set("key", key);
  try {
    const r = await fetchJson<PsiResponse>(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {
      timeoutMs: 90000,
    });
    const lh = r.lighthouseResult;
    const score = lh?.categories?.performance?.score;
    const lcp = lh?.audits?.["largest-contentful-paint"]?.numericValue;
    const cls = lh?.audits?.["cumulative-layout-shift"]?.numericValue;
    const shot = lh?.audits?.["final-screenshot"]?.details?.data;
    return {
      screenshot: typeof shot === "string" && shot.startsWith("data:image/") ? shot : null,
      mobileScore: typeof score === "number" ? Math.round(score * 100) : null,
      lcpSeconds: typeof lcp === "number" ? Math.round(lcp / 100) / 10 : null,
      cls: typeof cls === "number" ? Math.round(cls * 1000) / 1000 : null,
    };
  } catch {
    return { mobileScore: null, lcpSeconds: null, cls: null };
  }
}

function perfCheck(p: Audit["performance"]): AuditCheck | null {
  if (p.mobileScore === null) return null;
  const pass = p.mobileScore >= 50 && (p.lcpSeconds ?? 0) <= 4;
  return {
    id: "mobile_speed",
    label: "Mobile speed",
    pass,
    impact: "high",
    detail: pass
      ? `Fine. Google scores it ${p.mobileScore} out of 100 on mobile.`
      : `Slow. ${p.lcpSeconds ? `It takes about ${p.lcpSeconds} seconds before the main content shows on a phone, and` : "Google scores it " + p.mobileScore + " out of 100 on mobile, and"} a lot of people give up before then.`,
  };
}

export async function runAudit(website: string | null, aeoCtx?: AeoContext): Promise<Audit> {
  const page = website ? await fetchText(website) : null;
  const html = page?.ok && page.text ? page.text : null;
  // Questions are written from their own site, so this starts once the homepage is in,
  // then runs alongside PageSpeed and the other checks.
  const aeoPromise = aeoCtx ? aeoForLead(aeoCtx, html, html ? page!.url : null).catch(() => null) : Promise.resolve(null);
  if (!website || !page) {
    const aeo = await aeoPromise;
    const checks = aeo ? [aeoCheck(aeo)] : [];
    return {
      url: "",
      fetchedAt: new Date().toISOString(),
      reachable: false,
      performance: { mobileScore: null, lcpSeconds: null, cls: null },
      checks,
      score: 0,
      topIssues: topIssues(checks),
      aeo,
    };
  }
  const fetchedAt = new Date().toISOString();
  if (!page.ok || !page.text) {
    const down: AuditCheck = {
      id: "reachable",
      label: "Website loads",
      pass: false,
      impact: "high",
      detail: page.status ? `No. It returned an error (${page.status}) when we tried it.` : "No. It didn't respond within 15 seconds.",
    };
    const aeo = await aeoPromise;
    const checks = aeo ? [down, aeoCheck(aeo)] : [down];
    return {
      url: website,
      fetchedAt,
      reachable: false,
      performance: { mobileScore: null, lcpSeconds: null, cls: null },
      checks,
      score: 0,
      topIssues: topIssues(checks),
      aeo,
    };
  }
  const origin = new URL(page.url).origin;
  const [robots, sitemap, llms, perf] = await Promise.all([
    fetchText(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 200_000 }),
    fetchText(`${origin}/sitemap.xml`, { timeoutMs: 8000, maxBytes: 200_000 }),
    fetchText(`${origin}/llms.txt`, { timeoutMs: 8000, maxBytes: 200_000 }),
    pageSpeed(page.url),
  ]);
  const robotsTxt = robots.ok && !/<html/i.test(robots.text) ? robots.text : null;
  const hasSitemap =
    (sitemap.ok && /<(urlset|sitemapindex)/i.test(sitemap.text)) || /^\s*sitemap:/im.test(robotsTxt ?? "");
  const hasLlmsTxt = llms.ok && !/<html/i.test(llms.text) && llms.text.trim().length > 20;

  const checks = analyzePage({
    finalUrl: page.url,
    html: page.text,
    responseMs: page.ms,
    bytes: page.bytes,
    robotsTxt,
    hasSitemap,
    hasLlmsTxt,
  });
  const pc = perfCheck(perf);
  if (pc) checks.unshift(pc);
  const aeo = await aeoPromise;
  if (aeo) checks.unshift(aeoCheck(aeo));

  return {
    url: page.url,
    fetchedAt,
    reachable: true,
    performance: perf,
    checks,
    score: scoreAudit(checks.filter((c) => c.id !== "mobile_speed"), perf.mobileScore),
    topIssues: topIssues(checks),
    aeo,
  };
}
