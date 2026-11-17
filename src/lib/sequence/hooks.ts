// Picks the concrete things worth opening an email with, in order of how much they'd make
// the owner stop and read. Each hook carries the fact, why it matters, and subject ideas
// built from the lead's own details, so every email in a sequence leads on something different.

import type { Audit, AuditCheck, Lead } from "../types";

export interface Hook {
  id: string;
  fact: string; // what we saw, in plain words, with the specific number/name
  why: string; // what it costs them
  subjects: string[]; // specific, lowercase, 2-6 words
}

const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" };

const pretty = (p: string) => (p.length === 11 ? `${p.slice(0, p.startsWith("07") ? 5 : 4)} ${p.slice(p.startsWith("07") ? 5 : 4)}` : p);

export function pickHooks(lead: Lead, a: Audit | null): Hook[] {
  const hooks: Hook[] = [];
  const town = lead.city?.trim() || null;
  const dom = lead.domain ?? "your site";
  const get = (id: string): AuditCheck | undefined => a?.checks.find((c) => c.id === id && !c.pass && !c.unverified);
  const short = (s: string) => s.replace(/\s+/g, " ").trim();

  // 1. AI assistants: the strongest opener when a competitor was named instead.
  if (a?.aeo && a.aeo.answered > 0 && a.aeo.mentionRate < 50) {
    const miss = a.aeo.results.find((r) => !r.error && !r.mentioned && r.competitors.length) ?? a.aeo.results.find((r) => !r.error && !r.mentioned);
    if (miss) {
      const eng = ENGINE[miss.engine] ?? miss.engine;
      const comp = miss.competitors[0];
      const svc = a.aeo.services?.[0];
      hooks.push({
        id: "ai_miss",
        fact: `I asked ${eng}: "${miss.prompt}". It ${comp ? `named ${comp}${miss.competitors[1] ? ` and ${miss.competitors[1]}` : ""}` : "gave a list"} and didn't mention ${lead.company}. Across all four assistants you came up in ${a.aeo.mentions} of ${a.aeo.answered} answers.`,
        why: "More people now ask an AI assistant for a recommendation than scroll past page one of Google, and it only recommends what it can read about.",
        subjects: [
          `asked ${eng.toLowerCase()} about ${svc ?? "you"}${town ? ` in ${town.toLowerCase()}` : ""}`,
          comp ? `${eng.toLowerCase()} recommended ${comp.toLowerCase()} instead` : `${eng.toLowerCase()} didn't mention you`,
          `${a.aeo.mentions} of ${a.aeo.answered} ai answers`,
        ],
      });
    }
  }

  // 2. Things that are plainly broken, with a number attached.
  const nap = get("nap");
  if (nap && /doesn't match/.test(nap.detail)) {
    const nums = nap.detail.match(/\((\d[\d ]+)\)/g)?.map((x) => x.replace(/[()]/g, "")) ?? [];
    hooks.push({
      id: "phone_mismatch",
      fact: `The phone number on ${dom} (${nums[0] ?? "the site"}) isn't the one on your Google listing (${nums[1] ?? "Google"}).`,
      why: "Google trusts a business less when the details don't line up, and some customers ring the wrong one.",
      subjects: ["two different phone numbers", `wrong number on ${dom}`, "your number on google"],
    });
  }
  const idx = get("indexable");
  if (idx) hooks.push({ id: "noindex", fact: `${dom} is telling Google not to list it. ${short(idx.detail)}`, why: "Nobody can find you by searching, however good the site is.", subjects: [`${dom} is hidden from google`, "google can't list your site", "one line hiding your site"] });
  const broken = get("broken_links");
  if (broken) {
    const n = broken.detail.match(/^(\d+) of/)?.[1];
    const name = broken.detail.match(/"([^"]+)"/)?.[1];
    hooks.push({ id: "broken", fact: short(broken.detail), why: "People who hit a dead end rarely try again.", subjects: [name ? `your "${name.toLowerCase()}" link` : `${n ?? "some"} dead links on ${dom}`, `${n ?? "a few"} broken links`, "dead link in your menu"] });
  }
  const speed = get("mobile_speed");
  if (speed) {
    const secs = speed.detail.match(/about ([\d.]+) seconds/)?.[1];
    hooks.push({
      id: "slow",
      fact: secs ? `On a phone your homepage takes about ${secs} seconds before anything useful shows.` : short(speed.detail),
      why: "Most people give up at around three seconds and ring the next result.",
      subjects: secs ? [`${secs} seconds on a phone`, `${dom} on a phone`, `${Math.round(Number(secs))} second wait`] : [`${dom} on a phone`, "your homepage on mobile"],
    });
  }
  const svc = get("service_pages");
  if (svc) {
    const missing = svc.detail.match(/no page for ([^,.]+(?:, [^,.]+)*(?: and [^,.]+)?)/)?.[1];
    const firstSvc = missing?.split(/, | and /)[0];
    hooks.push({
      id: "service_pages",
      fact: `You offer ${missing ?? "several services"} but there's no page for ${missing ? "them" : "most of them"} on ${dom}.`,
      why: `A page for each one is usually what ranks when someone searches "${firstSvc ?? "that service"}${town ? ` ${town}` : ""}".`,
      subjects: [firstSvc ? `your ${firstSvc} page` : "pages for each service", firstSvc && town ? `${firstSvc} in ${town.toLowerCase()}` : "one page per service", "no page for that"],
    });
  }
  const https = get("https");
  if (https) hooks.push({ id: "https", fact: `${dom} still loads without a padlock.`, why: "Chrome labels it 'Not secure' next to your name, which puts people off before they've read a word.", subjects: [`"not secure" next to your name`, `padlock on ${dom}`, "the not secure warning"] });
  const redir = get("redirects");
  if (redir) hooks.push({ id: "redirects", fact: short(redir.detail), why: "Google can split your site into two weaker copies.", subjects: [`two versions of ${dom}`, "www and non-www", "your site at two addresses"] });
  const mail = get("email_auth");
  if (mail && /No SPF/.test(mail.detail)) hooks.push({ id: "email_auth", fact: short(mail.detail), why: "Quotes that land in spam don't get accepted.", subjects: [`your @${dom} emails`, "quotes landing in spam", `spam settings on ${dom}`] });
  const booking = get("online_booking");
  if (booking) hooks.push({ id: "booking", fact: `There's no way to book or ask for a quote on ${dom} without ringing.`, why: "The 9pm searchers book whoever lets them do it right then.", subjects: ["booking at 9pm", "the after-hours enquiries", "quote form on your site"] });
  const reviews = get("reviews");
  if (reviews) hooks.push({ id: "reviews", fact: `No reviews or testimonials on the ${dom} homepage.`, why: "Most people check reviews before they call, and AI assistants weigh them when picking who to recommend.", subjects: ["your reviews aren't on the site", "reviews on your homepage", "where your reviews are"] });
  const local = get("local_headline");
  if (local && town) hooks.push({ id: "local_headline", fact: `${dom} doesn't say ${town} in its title or main heading.`, why: `Google has less to go on when someone searches "${town}" plus what you do.`, subjects: [`${town.toLowerCase()} isn't on your homepage`, `"${town.toLowerCase()}" on ${dom}`, `searching ${town.toLowerCase()} for what you do`] });
  const tap = get("click_to_call");
  if (tap) hooks.push({ id: "click_to_call", fact: `On a phone your number on ${dom} isn't tappable, so people have to copy it out.`, why: "Small thing, but most won't bother.", subjects: ["tried to ring you from your site", "your number on mobile", "tap to call"] });
  const cta = get("cta");
  if (cta) hooks.push({ id: "cta", fact: `There's no obvious next step on ${dom}: no call, book or quote button near the top.`, why: "Visitors who aren't told what to do next usually do nothing.", subjects: ["what happens after they land", "the first thing on your homepage", "no button to call you"] });
  const schema = get("schema");
  if (schema) hooks.push({ id: "schema", fact: short(schema.detail), why: "It's how Google and AI tools confirm what you do and where.", subjects: ["the bit google can't read", "behind the scenes on your site", "what google sees"] });
  const depth = get("content_depth");
  if (depth) hooks.push({ id: "content_depth", fact: short(depth.detail), why: "Google and AI assistants can't recommend what they can't understand.", subjects: [`${depth.detail.match(/about (\d+) words/)?.[1] ?? "not many"} words on your homepage`, "your homepage says very little", "what your site tells google"] });
  const fresh = get("freshness");
  if (fresh) hooks.push({ id: "freshness", fact: short(fresh.detail), why: "People wonder if you're still trading.", subjects: [`${fresh.detail.match(/© ?(\d{4})/)?.[1] ?? "the year"} in your footer`, "small thing in your footer", "is the site still looked after"] });

  // No website at all.
  if (!a?.url) {
    hooks.unshift({
      id: "no_site",
      fact: `I couldn't find a website for ${lead.company}${town ? ` in ${town}` : ""}, only directory listings.`,
      why: "Google and AI assistants recommend businesses they can read about, and a listing on its own doesn't give them much.",
      subjects: [`${lead.company.toLowerCase()} without a website`, town ? `looking for you in ${town.toLowerCase()}` : "couldn't find your site", "your google listing"],
    });
  }

  // Fallback so a decent site still gets something concrete.
  if (!hooks.length && a) {
    hooks.push({ id: "score", fact: `${dom} scored ${a.score}/100 on our check; the main thing holding it back is ${a.topIssues[0]?.label?.toLowerCase() ?? "a few small things"}.`, why: "", subjects: [`${a.score} out of 100`, `one thing on ${dom}`, "small fix on your site"] });
  }
  return hooks;
}

// ---------- subject quality ----------

const GENERIC = /\b(website|web site|site review|audit|proposal|partnership|opportunity|services|quick question|quick chat|introduction|intro|touching base|checking in|following up|follow up|help(ing)? you|grow(th)?|boost|improve|free|offer|discount|collaboration|catch up|hello|hi there)\b/i;

/** True when a subject could have been sent to anyone. */
export function weakSubject(subject: string, lead: Lead, hooks: Hook[]): boolean {
  const s = subject.trim();
  const words = s.split(/\s+/).length;
  if (!s || words > 7) return true;
  if (/^(re|fwd?):/i.test(s)) return true; // fake replies
  if (/[!]|\.\.\./.test(s)) return true;
  if (GENERIC.test(s)) return true;
  const specifics = [
    lead.company,
    lead.domain,
    lead.city,
    lead.first_name,
    "chatgpt",
    "claude",
    "perplexity",
    "gemini",
    "google",
    ...hooks.flatMap((h) => h.subjects),
    ...hooks.flatMap((h) => h.fact.match(/\d[\d.]*/g) ?? []),
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());
  const l = s.toLowerCase();
  const concrete = /\d/.test(l) || specifics.some((x) => x.length > 2 && l.includes(x)) || /(second|phone|mobile|number|link|page|padlock|spam|footer|menu|reviews?|booking|quote)/.test(l);
  return !concrete;
}

/** Pick the best of several candidate subjects: specific, short, lowercase, not generic. */
export function bestSubject(candidates: string[], lead: Lead, hooks: Hook[]): string {
  const usable = candidates.map((c) => c.trim()).filter((c) => c && !weakSubject(c, lead, hooks));
  const pool = usable.length ? usable : hooks.flatMap((h) => h.subjects).filter((c) => !weakSubject(c, lead, hooks));
  const scored = pool
    .map((c) => {
      let score = 0;
      const words = c.split(/\s+/).length;
      if (words >= 2 && words <= 6) score += 2;
      if (/\d/.test(c)) score += 1;
      if (lead.city && c.toLowerCase().includes(lead.city.toLowerCase())) score += 1;
      if (/chatgpt|claude|perplexity|gemini/i.test(c)) score += 1;
      if (/^[a-z"\d]/.test(c)) score += 1; // starts lowercase, like a real note
      if (/\?$/.test(c)) score -= 1; // statements read less salesy than questions
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.c ?? hooks[0]?.subjects[0] ?? "one thing on your site";
}
