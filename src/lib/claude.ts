import Anthropic from "@anthropic-ai/sdk";
import { displayScore } from "./audit/analyze";
import { env } from "./env";
import { bestSubject, pickHooks, weakSubject, type Hook } from "./sequence/hooks";
import { brand } from "./brand";
import { bannedFound, humanise, humaniseSubject } from "./sequence/humanise";
import type { Audit, Campaign, Lead, ReplyClass } from "./types";

let client: Anthropic | null = null;
function claude(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey });
  return client;
}

// Keywords structured outputs rejects; callers validate these in code instead.
const UNSUPPORTED = new Set(["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "multipleOf", "pattern"]);

/** Make a JSON schema acceptable to structured outputs: every object closed, unsupported limits removed. */
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, strictSchema(pv)])) : strictSchema(v);
  }
  // `type: ["string", "null"]` -> anyOf, the form structured outputs documents.
  if (Array.isArray(out.type)) {
    const { type, ...rest } = out;
    return { ...rest, anyOf: (type as string[]).map((t) => ({ type: t })) };
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/**
 * Get a JSON result that matches `schema`, via structured outputs.
 * (Current models reject forced tool calls, which this used to use.)
 */
export async function structured<T>(p: {
  system: string;
  prompt: string;
  /** Kept for callers; only used in error messages now. */
  toolName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const res = await claude().messages.create({
    model: p.model || env.anthropicModel,
    // Thinking is on by default on current models and counts toward this limit.
    max_tokens: Math.max(p.maxTokens ?? 0, 16000),
    system: p.system,
    output_config: { format: { type: "json_schema", schema: strictSchema(p.schema) as Record<string, unknown> } },
    messages: [{ role: "user", content: p.prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error(`Claude declined to write the ${p.toolName}`);
  if (res.stop_reason === "max_tokens") throw new Error(`Claude ran out of room writing the ${p.toolName}`);
  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude returned no structured result");
  return JSON.parse(text.text) as T;
}

export const AUDIT_TOKEN = "[AUDIT_LINK]";
export const BOOKING_TOKEN = "[BOOKING_LINK]";

function auditSummary(a: Audit | null): string {
  if (!a) return "No audit available.";
  const perf = a.performance.mobileScore !== null ? `Mobile speed score ${a.performance.mobileScore}/100.` : "";
  const fails = a.checks.filter((c) => !c.pass && !c.unverified).map((c) => `- [${c.impact}] ${c.label}: ${c.detail}`);
  const unknown = a.checks.filter((c) => c.unverified).map((c) => c.label);
  const passes = a.checks.filter((c) => c.pass).map((c) => c.label);
  const names = { chatgpt: "ChatGPT", claude: "Claude", perplexity: "Perplexity", gemini: "Gemini" } as const;
  const aeo = a.aeo
    ? [
        `AI ANSWER ENGINE TEST (${a.aeo.ranAt.slice(0, 10)}): asked ${a.aeo.engines.map((e) => names[e]).join(", ")} buyer questions without naming the company.`,
        a.aeo.services?.length ? `Questions were about services listed on their own website: ${a.aeo.services.join(", ")}.` : "",
        ...a.aeo.results
          .filter((r) => !r.error)
          .map((r) => `- ${names[r.engine]} | "${r.prompt}" | ${r.mentioned ? `MENTIONED${r.position ? ` at #${r.position}` : ""}` : "not mentioned"}${r.competitors.length ? ` | named: ${r.competitors.slice(0, 4).join(", ")}` : ""}`),
        `Mentioned in ${a.aeo.mentions} of ${a.aeo.answered} answers (${a.aeo.mentionRate}%).`,
        a.aeo.topCompetitors.length ? `Most-recommended instead: ${a.aeo.topCompetitors.map((c) => `${c.name} (${c.count}x)`).join(", ")}.` : "",
      ].filter(Boolean)
    : [];
  return [
    a.url ? `Overall score ${displayScore(a)}/100. ${perf}` : "No website found.",
    fails.length ? `Problems found:\n${fails.join("\n")}` : "No problems found.",
    `Passed: ${passes.join(", ") || "none"}.`,
    unknown.length ? `Could NOT be checked (never claim these are problems): ${unknown.join(", ")}.` : "",
    a.platform ? `Built with: ${a.platform}.` : "",
    ...aeo,
  ].join("\n");
}

const HUMAN_STYLE = `HOW TO SOUND LIKE A PERSON, NOT A MODEL
- Write like a polite, friendly UK founder writing to a business they respect: warm and courteous, short sentences, contractions (I'm, you're, it's), plain everyday words. Never pushy, never blunt.
- Explain anything technical in words a business owner would use ("your site opens at a few different addresses"), never jargon ("http versions", "canonical", "non-www").
- Vary sentence length. A fragment now and then is fine. Don't make every paragraph the same size.
- No lists of three ("fast, simple and affordable"). No "not X, but Y" constructions. No rhetorical questions stacked together.
- Never use dashes of any kind as punctuation. Use commas or full stops.
- No exclamation marks, emojis, bold, bullets or headings.
- Banned: "I hope this finds you well", "I came across", "I noticed that", "reaching out", "quick question", "I'd love to", "unlock", "elevate", "leverage", "seamless", "streamline", "boost your online presence", "digital landscape", "take your business to the next level", "feel free to", "don't hesitate", "furthermore", "moreover", "additionally", "kind regards", "best regards", "looking forward to hearing from you".
- Be specific instead of persuasive: one concrete thing you saw beats three claims.
- Sound helpful, not salesy. It's fine to be a bit understated ("might be worth a look").`;

const WRITER_SYSTEM = `You write cold emails for ${"${BRAND}"}, a small UK company, sent personally by ${"${PERSON}"}. Rules you never break:
- Only state facts that appear in the audit, the lead record, or the PROOF text. Never invent clients, results, numbers, mutual connections or compliments.
- Under 150 words for the first email, under 60 for follow-ups. Plain text.
- FIRST EMAIL SHAPE, in this order:
  1. Greeting (see below).
  2. A short, polite introduction: who you are and that you ran a free check on their website, e.g. "I'm ${"${PERSON}"} from ${"${BRAND}"}. We ran a free check on {their domain} this week and wanted to share what we found."
  3. Give their AUDIT SCORE in one plain sentence, e.g. "Your site scored 69 out of 100." (skip this if no score is given).
  4. Say you found two main issues that need fixing, then describe BOTH (the email's HOOK and SECOND ISSUE), each in one or two plain-English sentences with why it matters to them. Write them as two short paragraphs starting "First," and "Second,"; never bullets or numbers.
  5. One line saying the full audit report covers these and a few smaller things, then ${AUDIT_TOKEN} on its own line.
  6. A polite, low-pressure offer to fix them, with the booking link on its own line, e.g. "If you'd like us to fix these for you, you can book a free 15 minute call here:" then ${BOOKING_TOKEN}.
  7. "Thanks," on its own line as the very last line.
- If there is only one real issue, mention just that one and don't say "two".
- Follow-ups: greeting, one new specific point, a gentle ask, then "Thanks," as the last line.
- If an AI ANSWER ENGINE TEST is present and they were not mentioned, that is usually the best opener: say which assistant you asked, roughly what you asked, and optionally one business it named instead, exactly as listed. Only name engines and businesses that appear in the test data. Say "when I asked", never "every time"; answers vary.
- Use the literal token ${AUDIT_TOKEN} where their audit page link goes (first email only, on its own line), and ${BOOKING_TOKEN} where the booking link goes (first email always; follow-ups only if they mention booking). Each token at most once per email.
- Each email is given a HOOK: the one specific thing it leads with. Use that hook's fact as the opener, in your own words, and don't reuse an earlier email's hook. Follow-ups are new information, never "just checking in".
- SUBJECT LINES: the subject is the part they read before deciding to open, so it has to be about THEM. Rules: 2 to 6 words, lowercase like a note to a colleague, and it must contain a specific detail from the hook (a number, their town, a service, an AI assistant's name, a competitor, a page, the thing that's broken). Never a subject that could be sent to any business: no "your website", "website review", "quick question", "proposal", "partnership", "helping you grow", "free audit". No fake "re:". No question marks unless it's a real question. Give three different subject candidates for each email.
- Greeting: "Hi {first name}," if known. Otherwise greet the business by its short, natural name plus "team", e.g. "Hi Howden team," for Howden Group Ltd (drop Ltd, Limited, LLP, Group, UK and similar). Never "Hi there", "Hi," on its own, or "Dear".
- End with "Thanks," only; the name and signature are added automatically underneath.
- British English spelling.

${HUMAN_STYLE}

EXAMPLES OF THE VOICE (different businesses; never copy their facts):

Subject: chatgpt recommended towergate instead
Hi Dan,

I'm ${"${PERSON}"} from ${"${BRAND}"}. We ran a free check on danbrokers.co.uk this week and wanted to share what we found.

Your site scored 58 out of 100, and we found two main issues that need fixing.

First, when I asked ChatGPT for a good commercial insurance broker for builders in Bristol, it named Towergate and a couple of others, but not you. AI tools can only recommend what they can read about you, and a few key details are missing from your site.

Second, your homepage takes about 6 seconds to load on a phone. Most people give up long before that and go back to Google.

The full audit report, with these and a few smaller things, is here:
${AUDIT_TOKEN}

If you'd like us to fix these for you, you can book a free 15 minute call here:
${BOOKING_TOKEN}

Thanks,

---
Subject: howdengroup.com opens at 4 addresses
Hi Howden team,

I'm ${"${PERSON}"} from ${"${BRAND}"}. We ran a free check on howdengroup.com this week and wanted to share what we found.

Your site scored 69 out of 100, and we found two main issues that need fixing.

First, your site opens at a few different addresses (with and without "www", and the older non-secure version), and they don't all lead to the same place. Google can treat those as separate, weaker copies of your site.

Second, Google and AI tools can't easily tell where you work, because the business details they read (address, phone, areas) aren't set up on the site.

The full audit report is here:
${AUDIT_TOKEN}

If you'd like us to fix these, you can book a free 15 minute call here:
${BOOKING_TOKEN}

Thanks,

---
(follow-up, subject: 6 seconds on a phone)
Hi Dan, one more thing from that check. Your contact page has no way to send an enquiry, so anyone browsing in the evening has to remember to ring the next day. Happy to talk it through whenever suits.

Thanks,`;

function writerSystem() {
  return WRITER_SYSTEM.replaceAll("${BRAND}", brand.name).replaceAll("${PERSON}", brand.person);
}

export interface WrittenEmail {
  subject: string;
  body: string;
  subject_candidates?: string[];
}

export interface WrittenSequence {
  emails: WrittenEmail[];
  /** 2-3 sentence personal note shown at the top of their audit page. */
  pageNote: string;
}

/** The score shown on their audit page, or null when there's no site to score. */
function auditScore(a: Audit | null): number | null {
  return a?.url && a.reachable ? displayScore(a) : null;
}

function cleanSequence(out: { emails: WrittenEmail[]; page_note?: string }, lead: Lead, hooks: Hook[]): WrittenSequence {
  const keep = [lead.company, lead.city ?? "", "ChatGPT", "Claude", "Perplexity", "Gemini", "Google", "AI"];
  const score = auditScore(lead.audit);
  return {
    emails: out.emails.map((e, i) => {
      let body = humanise(e.body);
      // The first email always gives their score; if it was left out, add it after the introduction.
      if (i === 0 && score != null && !new RegExp(`\\b${score}\\s*(out of|/)\\s*100`).test(body)) {
        const paras = body.split(/\n{2,}/);
        paras.splice(Math.min(2, paras.length), 0, `Your site scored ${score} out of 100.`);
        body = paras.join("\n\n");
      }
      if (i === 0 && !body.includes(AUDIT_TOKEN)) body = `${body}\n\n${AUDIT_TOKEN}`;
      if (i === 0 && !body.includes(BOOKING_TOKEN)) {
        body = body.replace(/\n*\s*(thanks|many thanks|thank you)[,.]?\s*$/i, "").trimEnd();
        body = `${body}\n\nIf you'd like us to fix these for you, you can book a free 15 minute call here:\n${BOOKING_TOKEN}`;
      }
      // Always close politely; the signature (name, company, phone) goes underneath.
      if (!/\n\s*(thanks|many thanks|thank you)[,.]?\s*$/i.test(body)) body = `${body.trimEnd()}\n\nThanks,`;
      const candidates = [e.subject, ...(e.subject_candidates ?? []), ...(hooks[i]?.subjects ?? [])].map((c) => humaniseSubject(c, keep));
      return { subject: bestSubject(candidates, lead, hooks), body };
    }),
    pageNote: humanise(out.page_note ?? ""),
  };
}

/** Write every step of the sequence for one lead in one call so the emails don't repeat each other. */
export async function writeSequence(campaign: Campaign, lead: Lead): Promise<WrittenSequence> {
  const hooks = pickHooks(lead, lead.audit);
  const score = auditScore(lead.audit);
  // The first email names the two main issues; follow-ups carry on from the third.
  const hookFor = (i: number) => hooks[(i === 0 ? 0 : i + 1) % Math.max(hooks.length, 1)];
  const second = hooks.length > 1 ? hooks[1] : null;
  const steps = campaign.steps
    .map((s, i) => {
      const h = hookFor(i);
      const two = i === 0 && second ? `\n  SECOND ISSUE: ${second.fact}${second.why ? ` Why it matters: ${second.why}` : ""}` : "";
      return `Email ${i + 1} (day ${s.day}): ${s.instructions}${h ? `\n  HOOK: ${h.fact}${h.why ? ` Why it matters: ${h.why}` : ""}${two}\n  Subject ideas (use one, or something as specific): ${h.subjects.map((x) => `"${x}"`).join(", ")}` : ""}`;
    })
    .join("\n");
  const prompt = `OFFER: ${campaign.offer}
WHO IT IS FOR: ${campaign.icp}
PROOF (the only credibility claims you may use; may be empty): ${campaign.proof || "(none)"}
EXTRA TONE NOTES: ${campaign.tone}

LEAD
Company: ${lead.company}
First name: ${lead.first_name ?? "(unknown)"}
Website: ${lead.website ?? "(none)"}
AUDIT SCORE: ${score != null ? `${score} out of 100` : "(none, don't mention a score)"}
City: ${lead.city ?? "(unknown)"}
Built with: ${lead.audit?.platform ?? "(unknown)"}
Services on their site: ${lead.audit?.services?.join(", ") || "(unknown)"}

THEIR AUDIT
${auditSummary(lead.audit)}

SEQUENCE TO WRITE
${steps}

Follow-ups are sent as replies in the same thread, so their subject is ignored; still return one.
Also write page_note: 2-3 sentences from ${brand.person} that sit at the top of their audit page, in the same human voice, first person, saying what you looked at and the one thing you'd fix first. No greeting, no sign-off, no link tokens.`;

  const schema = {
    type: "object",
    properties: {
      emails: {
        type: "array",
        minItems: campaign.steps.length,
        maxItems: campaign.steps.length,
        items: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Best subject: 2-6 words, lowercase, contains a specific detail from the hook. Never generic." },
            subject_candidates: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3, description: "Two or three different subjects of the same standard." },
            body: { type: "string" },
          },
          required: ["subject", "subject_candidates", "body"],
        },
      },
      page_note: { type: "string" },
    },
    required: ["emails", "page_note"],
  };

  let out = await structured<{ emails: WrittenEmail[]; page_note: string }>({ system: writerSystem(), prompt, toolName: "sequence", schema });
  if (!Array.isArray(out.emails) || out.emails.length !== campaign.steps.length) {
    throw new Error("Claude returned the wrong number of emails");
  }
  // One rewrite pass if it slipped into stock phrases or a subject anyone could have been sent.
  const slips = bannedFound([...out.emails.map((e) => `${e.subject}\n${e.body}`), out.page_note].join("\n"));
  const weak = out.emails.filter((e) => [e.subject, ...(e.subject_candidates ?? [])].every((c) => weakSubject(c, lead, hooks))).map((e) => e.subject);
  if (slips.length || weak.length) {
    const notes = [
      slips.length ? `used banned phrases: ${slips.map((x) => `"${x}"`).join(", ")}` : "",
      weak.length ? `had subjects that could be sent to any business: ${weak.map((x) => `"${x}"`).join(", ")}. Every subject must name something specific from that email's HOOK` : "",
    ].filter(Boolean);
    const retry = await structured<{ emails: WrittenEmail[]; page_note: string }>({
      system: writerSystem(),
      prompt: `${prompt}\n\nYour previous draft ${notes.join("; and ")}. Rewrite, keeping the same facts.\n\nPREVIOUS DRAFT:\n${JSON.stringify(out)}`,
      toolName: "sequence",
      schema,
    });
    if (Array.isArray(retry.emails) && retry.emails.length === campaign.steps.length) out = retry;
  }
  return cleanSequence(out, lead, hooks);
}

export interface ReplyAnalysis {
  classification: ReplyClass;
  summary: string;
  draft_reply: string | null;
}

async function analyseReplyRaw(p: {
  campaign: Campaign | null;
  lead: Lead;
  ourLastEmail: string | null;
  reply: string;
}): Promise<ReplyAnalysis> {
  return structured<ReplyAnalysis>({
    system: `You triage replies to cold emails for a UK founder and draft answers he will review before sending.
Classify strictly:
- interested: wants a call, pricing, or to proceed
- question: asks something before deciding
- not_now: open but later
- not_interested: no, but did not ask to stop contact
- unsubscribe: asks to be removed / stop emailing / any hostility about being contacted
- out_of_office: auto-reply
- bounce: delivery failure notice
- other
Draft a reply only for interested, question and not_now. Plain text, under 70 words, British English, no signature. Write it the way a busy founder replies from his phone: short, direct, warm, contractions, no dashes, no stock phrases ("thanks for getting back to me", "great question", "I'd be happy to", "feel free", "don't hesitate").
For interested: give the booking link ${BOOKING_TOKEN} and offer two rough options ("tomorrow afternoon or Thursday morning?").
Never promise prices, results or timelines that are not in the OFFER text. If unsure, ask a clarifying question.`,
    prompt: `OFFER: ${p.campaign?.offer ?? "(unknown)"}
LEAD: ${p.lead.first_name ?? ""} at ${p.lead.company}
OUR LAST EMAIL:
${p.ourLastEmail ?? "(unknown)"}

THEIR REPLY:
${p.reply.slice(0, 6000)}`,
    toolName: "triage",
    schema: {
      type: "object",
      properties: {
        classification: {
          type: "string",
          enum: ["interested", "question", "not_now", "not_interested", "unsubscribe", "out_of_office", "bounce", "other"],
        },
        summary: { type: "string", description: "One line: what they said" },
        draft_reply: { type: ["string", "null"] },
      },
      required: ["classification", "summary", "draft_reply"],
    },
    maxTokens: 1000,
  });
}

export async function analyseReply(p: Parameters<typeof analyseReplyRaw>[0]): Promise<ReplyAnalysis> {
  const r = await analyseReplyRaw(p);
  return { ...r, draft_reply: r.draft_reply ? humanise(r.draft_reply) : null };
}
