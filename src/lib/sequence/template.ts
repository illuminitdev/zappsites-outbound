// Fixed email templates, filled in from each lead's own audit: no AI, so no API cost.
// Same shape as the AI writer (writeSequence in ../claude.ts), so the pipeline can use either.
// Turn the AI writer back on with EMAIL_WRITER=ai.

import { displayScore } from "../audit/analyze";
import { brand } from "../brand";
import type { Campaign, Lead } from "../types";
import { AUDIT_TOKEN, BOOKING_TOKEN, type WrittenSequence } from "../claude";
import { bestSubject, pickHooks, type Hook } from "./hooks";

/** "Howden Insurance Brokers - Birmingham" / "Isis Insurance Services Ltd" -> "Howden Insurance Brokers" / "Isis Insurance Services". */
export function shortCompanyName(company: string, city: string | null): string {
  let n = company.split(/\s+[-–|]\s+|\s*\(|,/)[0];
  n = n.replace(/\b(limited|ltd|llp|plc|uk)\.?$/gi, " ").replace(/\s+/g, " ").trim();
  n = n.replace(/\b(limited|ltd|llp|plc|uk)\.?$/gi, " ").trim(); // "X UK Ltd"
  n = n.replace(/^the\s+/i, "");
  if (city) n = n.replace(new RegExp(`\\s+${city.replace(/[^\w\s'-]/g, "")}$`, "i"), "").trim();
  return n.length >= 2 ? n : company;
}

export function greeting(lead: Pick<Lead, "first_name" | "company" | "city">): string {
  return lead.first_name?.trim() ? `Hi ${lead.first_name.trim()},` : `Hi ${shortCompanyName(lead.company, lead.city)} team,`;
}

/** Some audit details are technical; say them the way a business owner would. A sentence that
 *  starts with the web address starts with "Your site" instead (the address is already in the intro). */
function plainFact(h: Hook, dom: string): string {
  const f = rawFact(h, dom).replace(/^(No|Yes)[.,]\s*/i, "");
  return f.startsWith(`${dom} `) ? `Your site ${f.slice(dom.length + 1)}` : f;
}

/** Plain "why it matters" lines where the audit's own would repeat the fact. */
const WHY: Record<string, string> = {
  schema: "Without them you're harder to recommend when someone searches for what you do nearby.",
};

function rawFact(h: Hook, dom: string): string {
  switch (h.id) {
    case "redirects":
      return `${dom} opens at a few different addresses (with and without "www", and the older non-secure version), and they don't all end up in the same place.`;
    case "schema":
      return `Google and AI tools can't easily tell what you do and where, because the business details they read (address, phone, areas, opening hours) aren't set up on ${dom}.`;
    case "email_auth":
      return `Your ${dom} email addresses are missing the settings (called SPF and DMARC) that stop them landing in people's spam folders.`;
    default:
      return h.fact;
  }
}

/** "On a phone your..." -> "on a phone your..." after "First, "; names and domains keep their capitals. */
function afterComma(s: string): string {
  return /^(On|There's|There|The|No|You|Your|It|When|Most|Some)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const para = (h: Hook, dom: string) => {
  const why = WHY[h.id] ?? h.why;
  return [sentence(plainFact(h, dom)), why ? sentence(why) : ""].filter(Boolean).join(" ");
};

/** Write the whole sequence for one lead from templates. */
export function writeTemplateSequence(campaign: Pick<Campaign, "steps">, lead: Lead): WrittenSequence {
  const a = lead.audit;
  const dom = lead.domain ?? "your site";
  const hi = greeting(lead);
  const intro = `I'm ${brand.person} from ${brand.name}. ${a?.url ? `We ran a free check on ${dom} this week and wanted to share what we found.` : `We looked at how easy ${lead.company} is to find online and wanted to share what we found.`}`;

  // What we lead with: the site didn't load, or the strongest issues from the audit.
  const unreachable = !!a?.url && !a.reachable;
  const hooks: Hook[] = unreachable
    ? [{ id: "down", fact: `${dom} didn't load when we checked. ${(a!.checks[0]?.detail ?? "").replace(/^(No|Yes)[.,]\s*/i, "")}`.trim(), why: "Anyone clicking through from Google or a business card sees an error page instead of you.", subjects: [`${dom} didn't load`, `${dom} is down`, "your site wouldn't open"] }]
    : pickHooks(lead, a);
  const realIssues = hooks.filter((h) => h.id !== "score");
  const score = a?.url && a.reachable ? displayScore(a) : null;
  const main = realIssues.slice(0, 2);

  // ---- email 1 ----
  const lines: string[] = [hi, "", intro, ""];
  if (unreachable) {
    lines.push(`We found one main issue that needs fixing. ${para(hooks[0], dom)}`);
  } else if (!a?.url) {
    lines.push(para(hooks[0], dom));
  } else if (main.length >= 2) {
    lines.push(`Your site scored ${score} out of 100, and we found two main issues that need fixing.`, "", `First, ${afterComma(para(main[0], dom))}`, "", `Second, ${afterComma(para(main[1], dom))}`);
  } else if (main.length === 1) {
    lines.push(`Your site scored ${score} out of 100, and we found one main issue that needs fixing.`, "", para(main[0], dom));
  } else {
    lines.push(`Good news first: your site scored ${score} out of 100, so it's in decent shape. There are still a few small things that would make it work harder for you.`);
  }
  const fixWhat = main.length >= 2 ? "these" : "this";
  lines.push(
    "",
    `The full audit report${main.length ? `, with ${fixWhat} and a few smaller things,` : ""} is here:`,
    AUDIT_TOKEN,
    "",
    `If you'd like us to fix ${fixWhat} for you, you can book a free 15 minute call here:`,
    BOOKING_TOKEN,
    "",
    "Thanks,",
  );
  // Subject comes from the issue the email opens with.
  const lead0 = unreachable ? hooks[0] : (main[0] ?? hooks[0]);
  const first = { subject: bestSubject(lead0?.subjects ?? [], lead, hooks), body: lines.join("\n") };

  // ---- follow-ups: one new issue each, then a short last note ----
  const rest = realIssues.slice(2);
  const steps = campaign.steps.length || 3;
  const emails = [first];
  for (let i = 1; i < steps; i++) {
    const last = i === steps - 1;
    const h = rest[i - 1];
    const body = h
      ? [
          `${hi.replace(/,$/, "")}, one more thing from our check of ${dom}.`,
          "",
          para(h, dom),
          "",
          last
            ? "This is my last note about it. If it's useful, you can book a free 15 minute call here:"
            : "Happy to talk it through whenever suits. You can book a free 15 minute call here:",
          BOOKING_TOKEN,
          "",
          "Thanks,",
        ]
      : [
          `${hi.replace(/,$/, "")}, ${last ? "a last note from me" : "just in case my last email got buried"}.`,
          "",
          `Your report for ${dom} is still here if it's useful:`,
          AUDIT_TOKEN,
          "",
          `${last ? "If now isn't the right time, no problem at all. If it is, " : "If you'd like to go through it, "}you can book a free 15 minute call here:`,
          BOOKING_TOKEN,
          "",
          "Thanks,",
        ];
    emails.push({ subject: first.subject, body: body.join("\n") });
  }

  // Short note at the top of their audit page.
  const pageNote = unreachable
    ? `I tried to check ${dom}, but it didn't load. That's the first thing I'd fix, because everyone clicking through from Google lands on an error.`
    : main[0]
      ? `I looked at ${dom} the way your customers find you: on a phone, on Google and through AI assistants. The first thing I'd fix: ${afterComma(sentence(plainFact(main[0], dom)))}`
      : a?.url
        ? `I looked at ${dom} on a phone, on Google and through AI assistants. It's in good shape; the list below covers the small things that would still help.`
        : "";
  return { emails, pageNote };
}
