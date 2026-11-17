import { env } from "../env";
import { fetchJson, fetchText } from "../http";
import type { AeoAudit, Audit, AuditCheck } from "../types";
import { analyzePage, scoreAudit, topIssues } from "./analyze";
import * as deep from "./deeper";
import { internalLinks, localChecks, sitemapUrls, type Link } from "./local";
import { DEFAULT_AEO_PROMPTS, enabledEngines, runMentionsAudit } from "./mentions";
import { detectPlatform, isBotWall, looksJsRendered, renderHtml, visibleText } from "./platform";
import { expandServiceTemplates, profileBusiness, type BusinessProfile } from "./services";

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
/**
 * Build the buyer questions and run the mentions audit.
 * Default: ask about the services read from their website.
 * Campaign prompts without {service} are used as written; with {service} they're filled from the site.
 */
export async function aeoForLead(ctx: AeoContext, profile: BusinessProfile | null): Promise<AeoAudit | null> {
  if (!enabledEngines().length) return null;
  const max = Number(process.env.AEO_MAX_PROMPTS || 3);
  const custom = customPrompts(ctx.prompts);
  if (custom && !custom.some((t) => t.includes("{service}"))) {
    return runMentionsAudit({ ...ctx, prompts: custom, promptSource: "campaign" });
  }
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
  loadingExperience?: { metrics?: { LARGEST_CONTENTFUL_PAINT_MS?: { percentile?: number } } };
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
    // Real-visitor data (Chrome UX Report) when Google has enough of it; more honest than one lab run.
    const field = r.loadingExperience?.metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    return {
      screenshot: typeof shot === "string" && shot.startsWith("data:image/") ? shot : null,
      mobileScore: typeof score === "number" ? Math.round(score * 100) : null,
      lcpSeconds: typeof lcp === "number" ? Math.round(lcp / 100) / 10 : null,
      cls: typeof cls === "number" ? Math.round(cls * 1000) / 1000 : null,
      fieldLcpSeconds: typeof field === "number" ? Math.round(field / 100) / 10 : null,
    };
  } catch {
    return { mobileScore: null, lcpSeconds: null, cls: null };
  }
}

function perfCheck(p: Audit["performance"]): AuditCheck | null {
  if (p.mobileScore === null) return null;
  // Prefer what real visitors experience; fall back to Google's lab test.
  const lcp = p.fieldLcpSeconds ?? p.lcpSeconds;
  const real = p.fieldLcpSeconds != null;
  const pass = real ? p.fieldLcpSeconds! <= 4 : p.mobileScore >= 50 && (p.lcpSeconds ?? 0) <= 4;
  return {
    id: "mobile_speed",
    label: "Mobile speed",
    pass,
    impact: "high",
    detail: pass
      ? `Fine. Google scores it ${p.mobileScore} out of 100 on mobile.`
      : `Slow. ${lcp ? `${real ? "Real visitors on phones wait" : "It takes"} about ${lcp} seconds before the main content shows${real ? "" : " on a phone"}, and` : "Google scores it " + p.mobileScore + " out of 100 on mobile, and"} a lot of people give up before then.`,
  };
}

export interface LocalContext {
  city: string | null;
  phone: string | null; // from their Google listing or the form
  company: string;
  domain: string | null;
}

// Checks that depend on reading the page body; wrong if all we got was an empty JS shell.
const BODY_CHECKS = new Set([
  "h1", "click_to_call", "cta", "freshness", "alt_text", "schema", "local_headline", "service_pages", "service_areas", "nap",
  "headings", "content_depth", "faq", "blog", "accreditations", "reviews", "contact_form", "online_booking", "whatsapp", "opening_hours",
  "maps_link", "social_links", "privacy_policy", "image_formats", "pricing_signal",
]);

function emptyAudit(url: string, reachable: boolean, checks: AuditCheck[], aeo: AeoAudit | null, extra: Partial<Audit> = {}): Audit {
  return {
    url,
    fetchedAt: new Date().toISOString(),
    reachable,
    performance: { mobileScore: null, lcpSeconds: null, cls: null },
    checks,
    score: 0,
    topIssues: topIssues(checks),
    aeo,
    ...extra,
  };
}

export async function runAudit(website: string | null, aeoCtx?: AeoContext, local?: LocalContext): Promise<Audit> {
  const ctx = { company: aeoCtx?.company ?? local?.company ?? "", domain: aeoCtx?.domain ?? local?.domain ?? null, city: aeoCtx?.city ?? local?.city ?? null };
  const max = Number(process.env.AEO_MAX_PROMPTS || 3);
  const page = website ? await fetchText(website) : null;

  // ---- no site, or it didn't load ----
  if (!website || !page || !page.ok || !page.text) {
    const blocked = !!page && isBotWall(page.status, page.text, page.headers);
    const profile = aeoCtx ? await profileBusiness({ ...ctx, category: aeoCtx.category, html: null, pageUrl: null, max }).catch(() => null) : null;
    const aeo = aeoCtx ? await aeoForLead(aeoCtx, profile).catch(() => null) : null;
    if (!website || !page) return emptyAudit("", false, aeo ? [aeoCheck(aeo)] : [], aeo);
    if (blocked) {
      // A bot wall isn't a broken site. Don't tell them it's down.
      const wall: AuditCheck = {
        id: "reachable",
        label: "Website loads",
        pass: false,
        unverified: true,
        impact: "high",
        detail: "Couldn't check. Your site's security settings block automated checks like ours, so we've only reported what we could see from outside.",
      };
      return emptyAudit(page.url, true, aeo ? [aeoCheck(aeo), wall] : [wall], aeo, { content: "blocked" });
    }
    const down: AuditCheck = {
      id: "reachable",
      label: "Website loads",
      pass: false,
      impact: "high",
      detail: page.status ? `No. It returned an error (${page.status}) when we tried it.` : "No. It didn't respond within 15 seconds.",
    };
    return emptyAudit(website, false, aeo ? [down, aeoCheck(aeo)] : [down], aeo);
  }

  // ---- the site loaded ----
  const fetchedAt = new Date().toISOString();
  let html = page.text;
  let content: Audit["content"] = "html";
  const platform = detectPlatform(page.text, page.headers);
  if (isBotWall(page.status, page.text, page.headers)) content = "blocked";
  else if (looksJsRendered(page.text)) {
    const rendered = await renderHtml(page.url);
    if (rendered && !looksJsRendered(rendered)) {
      html = rendered;
      content = "rendered";
    } else content = "js_shell";
  }
  const readable = content === "html" || content === "rendered";

  const origin = new URL(page.url).origin;
  const profilePromise =
    readable && (aeoCtx || process.env.ANTHROPIC_API_KEY)
      ? profileBusiness({ ...ctx, category: aeoCtx?.category ?? "", html, pageUrl: page.url, max }).catch(() => null)
      : Promise.resolve(null);
  const aeoPromise = aeoCtx ? profilePromise.then((p) => aeoForLead(aeoCtx, p)).catch(() => null) : Promise.resolve(null);

  const [robots, sitemap, llms, perf, profile] = await Promise.all([
    fetchText(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 200_000 }),
    fetchText(`${origin}/sitemap.xml`, { timeoutMs: 8000, maxBytes: 2_000_000 }),
    fetchText(`${origin}/llms.txt`, { timeoutMs: 8000, maxBytes: 200_000 }),
    pageSpeed(page.url),
    profilePromise,
  ]);
  const robotsTxt = robots.ok && !/<html/i.test(robots.text) ? robots.text : null;

  // Sitemap URLs: /sitemap.xml, or the one robots.txt points to; follow an index one level.
  let smXml = sitemap.ok && /<(urlset|sitemapindex)/i.test(sitemap.text) ? sitemap.text : null;
  const smFromRobots = robotsTxt?.match(/^\s*sitemap:\s*(\S+)/im)?.[1];
  if (!smXml && smFromRobots) {
    const r = await fetchText(smFromRobots, { timeoutMs: 8000, maxBytes: 2_000_000 });
    if (r.ok && /<(urlset|sitemapindex)/i.test(r.text)) smXml = r.text;
  }
  let sm = sitemapUrls(smXml);
  if (sm.children.length) {
    const pages = sm.children.find((u) => /page|post_type|service/i.test(u)) ?? sm.children[0];
    const r = await fetchText(pages, { timeoutMs: 8000, maxBytes: 2_000_000 });
    sm = { urls: sitemapUrls(r.ok ? r.text : null).urls, children: [] };
  }
  const hasSitemap = !!smXml || /^\s*sitemap:/im.test(robotsTxt ?? "");
  const hasLlmsTxt = llms.ok && !/<html/i.test(llms.text) && llms.text.trim().length > 20;

  let checks = analyzePage({ finalUrl: page.url, html, responseMs: page.ms, bytes: page.bytes, robotsTxt, hasSitemap, hasLlmsTxt });
  const links: Link[] = internalLinks(html, page.url);
  const text = visibleText(html);

  // Deeper checks. The network ones run together and are time-boxed inside.
  const [redir, broken, nf, mail] = await Promise.all([
    deep.redirects(page.url).catch(() => null),
    readable ? deep.brokenLinks(links, page.url).catch(() => null) : Promise.resolve(null),
    deep.notFoundPage(page.url).catch(() => null),
    deep.emailAuth(ctx.domain ?? new URL(page.url).hostname).catch(() => null),
  ]);
  checks.push(
    ...[
      deep.indexable(html, page.headers, robotsTxt),
      deep.canonical(html, page.url),
      redir,
      deep.mixedContent(html, page.url),
      deep.hsts(page.headers, page.url),
      broken,
      nf,
      deep.headings(html),
      deep.langAttr(html),
      deep.contentDepth(text),
      deep.faq(html, text),
      deep.blog(links),
      deep.accreditations(html, text),
      deep.socialProof(html, text),
      deep.contactForm(html),
      deep.onlineBooking(html, text),
      deep.whatsapp(html),
      deep.openingHours(html, text),
      deep.mapsEmbed(html),
      deep.socialLinks(html),
      deep.privacyPolicy(links),
      deep.ogTags(html),
      deep.favicon(html),
      deep.imageFormats(html),
      deep.pricingSignal(text),
      mail,
    ].filter((c): c is AuditCheck => !!c),
  );
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null;
  checks.push(
    ...localChecks({
      html,
      title,
      h1,
      visibleText: text,
      city: ctx.city ?? profile?.area ?? null,
      knownPhone: local?.phone ?? null,
      services: profile?.services ?? [],
      links,
      sitemap: sm.urls,
    }),
  );

  if (!readable) {
    const why =
      content === "blocked"
        ? "Couldn't check. Your site's security settings block automated checks, so we couldn't read the page."
        : `Couldn't check. ${platform && platform !== "JavaScript app" ? `Your ${platform} site` : "Your site"} builds the page with JavaScript after it loads, and our check reads the page as it first arrives. Google mostly copes with this; some AI tools don't.`;
    checks = checks.map((c) => (BODY_CHECKS.has(c.id) ? { ...c, pass: false, unverified: true, detail: why } : c));
  }

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
    platform,
    content,
    services: profile?.services ?? [],
  };
}
