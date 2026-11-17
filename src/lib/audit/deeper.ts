// The deeper checks: indexability, redirects, broken links, trust signals, conversion paths,
// content depth, email deliverability (SPF/DMARC) and a few technical basics.
// Pure functions take HTML/headers; the network ones live at the bottom and are time-boxed.

import { promises as dns } from "node:dns";
import type { AuditCheck } from "../types";
import { fetchText } from "../http";
import type { Link } from "./local";

type Impact = AuditCheck["impact"];
const mk = (id: string, label: string, pass: boolean, impact: Impact, detail: string): AuditCheck => ({ id, label, pass, impact, detail });

function count(re: RegExp, s: string) {
  return (s.match(re) ?? []).length;
}

// ---------- indexability & technical ----------

/** robots.txt has a "User-agent: *" group with "Disallow: /" and no "Allow: /". */
export function robotsBlocksEveryone(robots: string | null): boolean {
  if (!robots) return false;
  let inStar = false;
  let disallowAll = false;
  let allowRoot = false;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!lastWasAgent) inStar = false;
      if (val === "*") inStar = true;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStar) continue;
    if (key === "disallow" && val === "/") disallowAll = true;
    if (key === "allow" && val === "/") allowRoot = true;
  }
  return disallowAll && !allowRoot;
}

/** Can Google list this page at all? noindex meta, X-Robots-Tag, or robots.txt blocking everyone. */
export function indexable(html: string, headers: Headers | undefined, robotsTxt: string | null): AuditCheck {
  const meta = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
  const xrobots = headers?.get("x-robots-tag") ?? "";
  const noindex = /noindex/i.test(meta) || /noindex/i.test(xrobots);
  const blockedAll = robotsBlocksEveryone(robotsTxt);
  const pass = !noindex && !blockedAll;
  return mk(
    "indexable",
    "Google is allowed to list the site",
    pass,
    "high",
    pass
      ? "Yes."
      : noindex
        ? 'No. The homepage is marked "noindex", which tells Google not to show it in search results at all. Often left over from when the site was built.'
        : "No. Your robots.txt tells every search engine to stay out of the whole site.",
  );
}

/** Canonical tag points somewhere sensible (itself or same site). */
export function canonical(html: string, finalUrl: string): AuditCheck | null {
  const href = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  if (!href) return mk("canonical", "Canonical URL set", false, "low", "No canonical tag. Harmless on a small site, but it helps Google avoid treating www and non-www as two sites.");
  try {
    const c = new URL(href, finalUrl);
    const f = new URL(finalUrl);
    const same = c.hostname.replace(/^www\./, "") === f.hostname.replace(/^www\./, "");
    return mk("canonical", "Canonical URL set", same, same ? "low" : "high", same ? "Yes." : `It points to ${c.hostname}, a different site, which tells Google to credit that site instead of yours.`);
  } catch {
    return mk("canonical", "Canonical URL set", false, "low", "The canonical tag isn't a valid address.");
  }
}

export function mixedContent(html: string, finalUrl: string): AuditCheck | null {
  if (!finalUrl.startsWith("https://")) return null;
  const n = count(/\s(?:src|href)=["']http:\/\/(?!www\.w3\.org)/gi, html);
  return mk("mixed_content", "No insecure files on a secure page", n === 0, n ? "medium" : "low", n ? `${n} image${n > 1 ? "s or scripts" : " or script"} still load over plain http, so browsers show a warning or block them.` : "Yes.");
}

export function ogTags(html: string): AuditCheck {
  const t = /<meta[^>]+property=["']og:title["']/i.test(html);
  const i = /<meta[^>]+property=["']og:image["']/i.test(html);
  return mk("og_tags", "Looks right when shared on WhatsApp or Facebook", t && i, "low", t && i ? "Yes, it has a title and picture set for link previews." : "No. When someone shares your link on WhatsApp or Facebook it shows a blank grey box instead of your name and a picture.");
}

export function favicon(html: string): AuditCheck {
  const has = /<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(html) || /<link[^>]+rel=["']apple-touch-icon["']/i.test(html);
  return mk("favicon", "Browser tab icon", has, "low", has ? "Yes." : "No icon in the browser tab or bookmarks, which is a small tell that the site was never finished.");
}

export function headings(html: string): AuditCheck {
  const h1 = count(/<h1\b/gi, html);
  const h2 = count(/<h2\b/gi, html);
  const pass = h1 === 1 && h2 >= 1;
  return mk("headings", "Headings in a clear order", pass, "low", pass ? "Yes." : h1 > 1 ? `There are ${h1} main headings on the page. Google reads one as the title of the page; more than one muddles it.` : h1 === 0 ? "No main heading, so nothing tells Google what the page is about." : "There are no sub-headings, so the page reads as one block. Sub-headings for each service help both people and Google skim.");
}

export function langAttr(html: string): AuditCheck {
  const lang = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1];
  return mk("lang", "Page language declared", !!lang, "low", lang ? `Yes (${lang}).` : "No language set on the page. Screen readers and Google guess.");
}

export function hsts(headers: Headers | undefined, finalUrl: string): AuditCheck | null {
  if (!finalUrl.startsWith("https://")) return null;
  const has = !!headers?.get("strict-transport-security");
  return mk("hsts", "Forces secure connections (HSTS)", has, "low", has ? "Yes." : "Not set. It's one line of config that stops browsers ever loading the insecure version.");
}

// ---------- trust & conversion ----------

const ACCREDITATIONS: [RegExp, string][] = [
  [/gas\s*safe/i, "Gas Safe"],
  [/\bniceic\b/i, "NICEIC"],
  [/\bnapit\b/i, "NAPIT"],
  [/\belecsa\b/i, "ELECSA"],
  [/\bstroma\b/i, "Stroma"],
  [/\boftec\b/i, "OFTEC"],
  [/\bciphe\b/i, "CIPHE"],
  [/\bwater\s*safe\b/i, "WaterSafe"],
  [/checkatrade/i, "Checkatrade"],
  [/trustmark/i, "TrustMark"],
  [/which\?\s*trusted\s*trader/i, "Which? Trusted Trader"],
  [/\bfmb\b|federation of master builders/i, "FMB"],
  [/\bbpca\b/i, "BPCA"],
  [/\bnpta\b/i, "NPTA"],
  [/\bapl\b|association of professional landscapers/i, "APL"],
  [/\bbali\b/i, "BALI"],
  [/\bhabia\b/i, "HABIA"],
  [/\bcimspa\b/i, "CIMSPA"],
  [/\breps\b|register of exercise professionals/i, "REPs"],
  [/\bbiba\b/i, "BIBA"],
  [/\bchas\b/i, "CHAS"],
  [/safe\s*contractor/i, "SafeContractor"],
  [/constructionline/i, "Constructionline"],
  [/city\s*&(?:amp;)?\s*guilds|city and guilds/i, "City & Guilds"],
  [/\bdbs\s*checked\b/i, "DBS checked"],
  [/fully\s*insured|public\s*liability/i, "insurance"],
  [/\btrustpilot\b/i, "Trustpilot"],
  [/\bbark\.com\b|bark\s*verified/i, "Bark"],
  [/\brated\s*people\b/i, "Rated People"],
  [/\bmy\s*builder\b/i, "MyBuilder"],
];

export function accreditations(html: string, text: string): AuditCheck {
  const hay = `${text} ${html.match(/alt=["']([^"']+)["']/gi)?.join(" ") ?? ""}`;
  const found = ACCREDITATIONS.filter(([re]) => re.test(hay)).map(([, n]) => n);
  const pass = found.length > 0;
  return mk("accreditations", "Accreditations and insurance shown", pass, "medium", pass ? `Yes: ${found.slice(0, 4).join(", ")}.` : "None visible on the homepage. Gas Safe, NICEIC, Checkatrade, insurance: whichever apply, people and AI assistants look for them before they ring.");
}

export function socialProof(html: string, text: string): AuditCheck {
  const widget = /trustpilot|reviews\.io|feefo|google\.com\/maps\/embed|elfsight|widget\.reviews|checkatrade\.com\/.*reviews|yotpo|judge\.me/i.test(html);
  const words = /(customer |client )?(reviews?|testimonials?|what (our )?customers say|rated\s*\d(\.\d)?\s*(\/|out of)\s*5|\d+\s*(five|5)[ -]star)/i.test(text);
  const stars = /aggregateRating|ratingValue/i.test(html) || count(/★|⭐/g, text) >= 5;
  const pass = widget || stars || words;
  return mk("reviews", "Reviews or testimonials on the site", pass, "medium", pass ? `Yes${widget ? ", pulled in live" : ""}.` : "None on the homepage. Most people check reviews before they call, and AI assistants weigh them when picking who to recommend.");
}

export function contactForm(html: string): AuditCheck {
  const form = /<form\b[\s\S]*?<\/form>/i.test(html) && /<(input|textarea)[^>]+(type=["'](email|tel)["']|name=["'][^"']*(email|phone|tel|message|enquir)[^"']*["'])/i.test(html);
  const embedded = /typeform|jotform|hubspot\.com\/forms|wufoo|formstack|gravity-?forms|wpforms|contact-form-7|forminator|formspree|getform/i.test(html);
  const pass = form || embedded;
  return mk("contact_form", "A way to send an enquiry", pass, "medium", pass ? "Yes." : "No enquiry form on the homepage, so anyone browsing after hours has to remember to call back tomorrow.");
}

export function onlineBooking(html: string, text: string): AuditCheck {
  const widget = /calendly|acuityscheduling|squareup\.com\/appointments|simplybook|setmore|fresha|treatwell|booksy|timely|phorest|mindbody|zenoti|bookwhen|youcanbook|cal\.com|hubspot\.com\/meetings|tidycal|zcal/i.test(html);
  const words = /book (online|now|an? (appointment|slot|visit|call|consultation))|get an? (instant )?quote online|request a quote/i.test(text);
  const pass = widget || words;
  return mk("online_booking", "Online booking or instant quote", pass, "medium", pass ? `Yes${widget ? ", with a booking tool" : ""}.` : "No way to book or request a quote online. The people who search at 9pm end up booking whoever lets them do it right then.");
}

export function whatsapp(html: string): AuditCheck {
  const has = /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(html);
  return mk("whatsapp", "WhatsApp link", has, "low", has ? "Yes." : "No WhatsApp link. For trades it's often the easiest way for a customer to send a photo of the job.");
}

export function openingHours(html: string, text: string): AuditCheck {
  const schema = /openingHours/i.test(html);
  const words = /(opening|office|business)\s*hours|open(?:ing)?\s*(mon|tue|wed|thu|fri|sat|sun|\d)|mon(day)?\s*(-|to|–)\s*(fri|sat|sun)|24\s*(hours?|\/\s*7|hr)|\b\d{1,2}(:\d{2})?\s*(am|pm)\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)/i.test(text);
  const pass = schema || words;
  return mk("opening_hours", "Opening hours shown", pass, "low", pass ? "Yes." : "No opening hours on the homepage. AI assistants and Google show them when someone asks who's open now.");
}

export function mapsEmbed(html: string): AuditCheck {
  const has = /google\.com\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page\//i.test(html);
  return mk("maps_link", "Links to your Google listing or map", has, "low", has ? "Yes." : "No link to your Google Business Profile or a map. Linking the two helps Google tie the website to the listing.");
}

export function socialLinks(html: string): AuditCheck {
  const nets = [
    [/facebook\.com\//i, "Facebook"],
    [/instagram\.com\//i, "Instagram"],
    [/linkedin\.com\//i, "LinkedIn"],
    [/tiktok\.com\//i, "TikTok"],
    [/youtube\.com\//i, "YouTube"],
  ] as const;
  const found = nets.filter(([re]) => re.test(html)).map(([, n]) => n);
  return mk("social_links", "Links to social profiles", found.length > 0, "low", found.length ? `Yes: ${found.join(", ")}.` : "None. Not essential, but a live Facebook or Instagram page is one more place AI assistants and customers find you.");
}

export function privacyPolicy(links: Link[]): AuditCheck {
  const has = links.some((l) => /privacy|cookie|gdpr/i.test(`${l.href} ${l.text}`));
  return mk("privacy_policy", "Privacy policy", has, "low", has ? "Yes." : "No privacy policy linked. If you have a contact form you're meant to have one under UK GDPR.");
}

// ---------- content ----------

export function contentDepth(text: string): AuditCheck {
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
  const pass = words >= 250;
  return mk("content_depth", "Enough text to be understood", pass, words < 120 ? "high" : "medium", pass ? `Yes, about ${Math.round(words / 50) * 50} words.` : `Only about ${words} words on the homepage. Google and AI assistants have little to go on when deciding what you do and where.`);
}

export function faq(html: string, text: string): AuditCheck {
  const schema = /FAQPage/i.test(html);
  const words = /\bfaqs?\b|frequently asked|common questions/i.test(text);
  const pass = schema || words;
  return mk("faq", "Answers common questions (FAQ)", pass, "medium", pass ? `Yes${schema ? ", and marked up so AI tools can read it" : ""}.` : "No FAQ. AI assistants are built to answer questions, so a page answering the ones customers ask (cost, how long, do you cover my area) is the easiest way to get quoted.");
}

export function blog(links: Link[]): AuditCheck {
  const has = links.some((l) => /\/(blog|news|articles|guides|advice|tips)\b/i.test(new URL(l.href).pathname));
  return mk("blog", "Advice or news section", has, "low", has ? "Yes." : "No advice or news pages. Not essential, but a few short guides are what AI assistants most often quote.");
}

export function imageFormats(html: string): AuditCheck | null {
  const srcs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  if (srcs.length < 3) return null;
  const modern = srcs.filter((s) => /\.(webp|avif)(\?|$)/i.test(s) || /format=(webp|avif)/i.test(s)).length;
  const lazy = count(/<img[^>]+loading=["']lazy["']/gi, html);
  const pass = modern / srcs.length >= 0.5 || lazy >= Math.floor(srcs.length / 2);
  return mk("image_formats", "Images in modern formats", pass, "low", pass ? "Yes, mostly." : `${srcs.length} images and none in a modern format or lazy-loaded. That's usually most of why a page is slow on a phone.`);
}

export function pricingSignal(text: string): AuditCheck {
  const has = /(from|starting at)\s*£\s?\d|£\s?\d+(\.\d{2})?\s*(per|\/|an?)\s*(hour|hr|day|visit|call ?out|job|month)|call[- ]?out (fee|charge)|free (quote|estimate|survey)|no call[- ]?out/i.test(text);
  return mk("pricing_signal", "Says something about price", has, "low", has ? "Yes." : 'Nothing about price, not even "free quotes" or a call-out fee. People shortlist on it, and AI assistants repeat it when they have it.');
}

// ---------- network checks (time-boxed) ----------

/** Does http://, www and non-www all end up on the same final address? */
export async function redirects(finalUrl: string): Promise<AuditCheck | null> {
  let f: URL;
  try {
    f = new URL(finalUrl);
  } catch {
    return null;
  }
  const bare = f.hostname.replace(/^www\./, "");
  const variants = [`http://${bare}/`, `http://www.${bare}/`, `https://${f.hostname.startsWith("www.") ? bare : `www.${bare}`}/`];
  const results = await Promise.all(variants.map((u) => fetchText(u, { timeoutMs: 8000, maxBytes: 50_000 }).catch(() => null)));
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const target = norm(finalUrl);
  const bad = variants.filter((v, i) => {
    const r = results[i];
    if (!r || !r.ok) return /^http:\/\//.test(v) ? false : true; // an insecure variant that doesn't answer is fine; a missing www/non-www isn't
    return norm(r.url) !== target || !r.url.startsWith("https://");
  });
  const pass = bad.length === 0;
  return mk("redirects", "One address for the site", pass, "medium", pass ? "Yes, www, non-www and http all land in the same place." : `${bad.map((b) => b.replace(/\/$/, "")).join(" and ")} ${bad.length > 1 ? "don't" : "doesn't"} end up on ${f.hostname}. Google can treat those as separate, weaker copies of your site.`);
}

/** Try a handful of internal links and report the ones that are broken. */
export async function brokenLinks(links: Link[], finalUrl: string, max = 10): Promise<AuditCheck | null> {
  const home = new URL(finalUrl).pathname.replace(/\/$/, "") || "/";
  const sample = links.filter((l) => !/\.(pdf|jpg|jpeg|png|gif|zip|mp4)(\?|$)/i.test(l.href) && (new URL(l.href).pathname.replace(/\/$/, "") || "/") !== home).slice(0, max);
  if (sample.length < 2) return null;
  const res = await Promise.all(sample.map((l) => fetchText(l.href, { timeoutMs: 8000, maxBytes: 20_000 }).catch(() => null)));
  const broken = sample.filter((_, i) => {
    const r = res[i];
    return r && (r.status === 404 || r.status === 410 || r.status >= 500);
  });
  const pass = broken.length === 0;
  const name = (l: Link) => l.text.slice(0, 30) || new URL(l.href).pathname;
  return mk("broken_links", "Menu links all work", pass, broken.length > 1 ? "high" : "medium", pass ? `Yes, we tried ${sample.length}.` : `${broken.length} of the ${sample.length} links we tried ${broken.length > 1 ? "are" : "is"} broken: ${broken.slice(0, 3).map((l) => `"${name(l)}"`).join(", ")}. Dead ends like that lose the people who were about to call.`);
}

/** Custom 404 page rather than a blank server error or a soft 200. */
export async function notFoundPage(finalUrl: string): Promise<AuditCheck | null> {
  const origin = new URL(finalUrl).origin;
  const r = await fetchText(`${origin}/zs-check-${Date.now().toString(36)}`, { timeoutMs: 8000, maxBytes: 200_000 }).catch(() => null);
  if (!r) return null;
  if (r.status === 200) return mk("not_found", "Missing pages show a proper 'not found'", false, "low", "A made-up address returned a normal page instead of 'not found', which can get Google indexing junk addresses.");
  const helpful = r.status === 404 && /<a\b/i.test(r.text) && /home|back|menu|search|contact/i.test(r.text);
  return mk("not_found", "Missing pages show a proper 'not found'", helpful, "low", helpful ? "Yes, with a way back." : "A dead link lands on a bare error page with no way back to the site.");
}

/** SPF and DMARC on their domain: whether their own emails are likely to reach inboxes. */
export async function emailAuth(domain: string | null): Promise<AuditCheck | null> {
  if (!domain) return null;
  const d = domain.toLowerCase().replace(/^www\./, "");
  const txt = async (name: string) => {
    try {
      return (await dns.resolveTxt(name)).map((r) => r.join(""));
    } catch {
      return [] as string[];
    }
  };
  const [mx, spf, dmarc] = await Promise.all([
    dns.resolveMx(d).catch(() => []),
    txt(d).then((rs) => rs.find((r) => /^v=spf1/i.test(r)) ?? null),
    txt(`_dmarc.${d}`).then((rs) => rs.find((r) => /^v=dmarc1/i.test(r)) ?? null),
  ]);
  if (!mx.length) return null; // no email on this domain (e.g. they use gmail); nothing to judge
  const pass = !!spf && !!dmarc;
  const soft = !!spf && !dmarc;
  return mk(
    "email_auth",
    "Your email is set up to reach inboxes",
    pass,
    soft ? "low" : "medium",
    pass
      ? "Yes, SPF and DMARC are both in place."
      : soft
        ? "Partly. SPF is set but there's no DMARC record, which Gmail and Outlook now use to decide what goes to spam."
        : `No SPF or DMARC records on ${d}. Quotes you send from @${d} addresses are more likely to land in spam, and anyone can send email pretending to be you.`,
  );
}
