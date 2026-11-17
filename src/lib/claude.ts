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
- Write like a busy UK founder typing on a laptop between jobs: short sentences, contractions (I'm, you're, it's), plain words. Slightly informal is fine.
- Vary sentence length. A fragment now and then is fine. Don't make every paragraph the same size.
- No lists of three ("fast, simple and affordable"). No "not X, but Y" constructions. No rhetorical questions stacked together.
- Never use dashes of any kind as punctuation. Use commas or full stops.
- No exclamation marks, emojis, bold, bullets or headings.
- Banned: "I hope this finds you well", "I came across", "I noticed that", "reaching out", "quick question", "I'd love to", "unlock", "elevate", "leverage", "seamless", "streamline", "boost your online presence", "digital landscape", "take your business to the next level", "feel free to", "don't hesitate", "furthermore", "moreover", "additionally", "kind regards", "best regards", "looking forward to hearing from you".
- Be specific instead of persuasive: one concrete thing you saw beats three claims.
- Sound mildly curious, not salesy. It's fine to be a bit understated ("might be worth a look").`;

const WRITER_SYSTEM = `You write cold emails for ${"${BRAND}"}, a small UK company, sent personally by ${"${PERSON}"}. Rules you never break:
- Only state facts that appear in the audit, the lead record, or the PROOF text. Never invent clients, results, numbers, mutual connections or compliments.
- Under 90 words for the first email, under 50 for follow-ups. Plain text.
- One specific observation about THEIR business, why it matters to them in plain terms, and one easy ask (a 15 minute call, or "want me to send the fixes?").
- If an AI ANSWER ENGINE TEST is present and they were not mentioned, that is usually the best opener: say which assistant you asked, roughly what you asked, and optionally one business it named instead, exactly as listed. Only name engines and businesses that appear in the test data. Say "when I asked", never "every time"; answers vary.
- Use the literal token ${AUDIT_TOKEN} where their audit page link goes (first email only, on its own line), and ${BOOKING_TOKEN} only if you mention booking a call. Each token at most once.
- Each email is given a HOOK: the one specific thing it leads with. Use that hook's fact as the opener, in your own words, and don't reuse an earlier email's hook. Follow-ups are new information, never "just checking in".
- SUBJECT LINES: the subject is the part they read before deciding to open, so it has to be about THEM. Rules: 2 to 6 words, lowercase like a note to a colleague, and it must contain a specific detail from the hook (a number, their town, a service, an AI assistant's name, a competitor, a page, the thing that's broken). Never a subject that could be sent to any business: no "your website", "website review", "quick question", "proposal", "partnership", "helping you grow", "free audit". No fake "re:". No question marks unless it's a real question. Give three different subject candidates for each email.
- Greeting: "Hi {first name}," if known, otherwise just "Hi,". Never "Hi there" or "Dear".
- No sign-off or signature; one is added automatically.
- British English spelling.

${HUMAN_STYLE}

EXAMPLES OF THE VOICE (different businesses; never copy their facts):

Subject: chatgpt recommended towergate instead
Hi Dan,

I asked ChatGPT for a good commercial insurance broker for builders in Bristol last night. It named Towergate and a couple of others, but not you, even though you clearly specialise in it.

Mostly that's down to a few missing bits on your site that AI tools read. I wrote up what I found here:
${AUDIT_TOKEN}

Worth a 15 minute call to go through it?

---
Subject: tried to ring you from your site
Hi,

Tried to call you from your site on my phone and the number isn't tappable, so I had to copy it out. Small thing, but most people won't bother.

Few other bits like that here, all fixable in a day:
${AUDIT_TOKEN}

Want me to send over the fixes?

---
(follow-up, subject: 6 seconds on a phone)
Hi Dan, one more thing from that check. Your homepage takes about 6 seconds to show anything on a phone. Happy to talk it through if useful.`;

function writerSystem() {
  return WRITER_SYSTEM.replace("${BRAND}", brand.name).replace("${PERSON}", brand.person);
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

function cleanSequence(out: { emails: WrittenEmail[]; page_note?: string }, lead: Lead, hooks: Hook[]): WrittenSequence {
  const keep = [lead.company, lead.city ?? "", "ChatGPT", "Claude", "Perplexity", "Gemini", "Google", "AI"];
  return {
    emails: out.emails.map((e, i) => {
      let body = humanise(e.body);
      if (i === 0 && !body.includes(AUDIT_TOKEN)) body = `${body}\n\n${AUDIT_TOKEN}`;
      const candidates = [e.subject, ...(e.subject_candidates ?? []), ...(hooks[i]?.subjects ?? [])].map((c) => humaniseSubject(c, keep));
      return { subject: bestSubject(candidates, lead, hooks), body };
    }),
    pageNote: humanise(out.page_note ?? ""),
  };
}

/** Write every step of the sequence for one lead in one call so the emails don't repeat each other. */
export async function writeSequence(campaign: Campaign, lead: Lead): Promise<WrittenSequence> {
  const hooks = pickHooks(lead, lead.audit);
  const hookFor = (i: number) => hooks[i % Math.max(hooks.length, 1)];
  const steps = campaign.steps
    .map((s, i) => {
      const h = hookFor(i);
      return `Email ${i + 1} (day ${s.day}): ${s.instructions}${h ? `\n  HOOK: ${h.fact}${h.why ? ` Why it matters: ${h.why}` : ""}\n  Subject ideas (use one, or something as specific): ${h.subjects.map((x) => `"${x}"`).join(", ")}` : ""}`;
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
