// AEO/GEO mentions audit: ask AI answer engines the questions a buyer would ask and see
// whether the prospect is mentioned or cited, and who is recommended instead.
// Each engine is optional and switched on by its API key. Claude uses ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { fetchJson } from "../http";
import type { AeoAudit, AeoResult } from "../types";
import { citedCompetitorDomains, competitorsIn, detectMention, fillPrompt, tally, type MentionTarget } from "./mentionsDetect";

export interface EngineAnswer {
  text: string;
  citations: string[];
}

type Engine = { id: AeoResult["engine"]; label: string; ask: (prompt: string) => Promise<EngineAnswer> };

const SYSTEM = "You are a helpful assistant. Answer as you would for any member of the public in the UK. Recommend specific businesses by name where you can.";

// ---------- engines ----------

async function askChatGpt(prompt: string): Promise<EngineAnswer> {
  const r = await fetchJson<{
    output_text?: string;
    output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[] }[];
  }>("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_AEO_MODEL || "gpt-5",
      tools: [{ type: "web_search" }],
      instructions: SYSTEM,
      input: prompt,
    }),
    timeoutMs: 120000,
  });
  const parts = (r.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text");
  const text = r.output_text ?? parts.map((p) => p.text ?? "").join("\n");
  const citations = parts.flatMap((p) => (p.annotations ?? []).map((a) => a.url).filter((u): u is string => !!u));
  return { text, citations };
}

async function askPerplexity(prompt: string): Promise<EngineAnswer> {
  const r = await fetchJson<{ choices?: { message?: { content?: string } }[]; citations?: string[]; search_results?: { url: string }[] }>(
    "https://api.perplexity.ai/chat/completions",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
      body: JSON.stringify({
        model: process.env.PERPLEXITY_MODEL || "sonar",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
      timeoutMs: 90000,
    },
  );
  return {
    text: r.choices?.[0]?.message?.content ?? "",
    citations: r.citations ?? (r.search_results ?? []).map((s) => s.url),
  };
}

async function askGemini(prompt: string): Promise<EngineAnswer> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const r = await fetchJson<{
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
  }>(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    }),
    timeoutMs: 90000,
  });
  const c = r.candidates?.[0];
  const chunks = c?.groundingMetadata?.groundingChunks ?? [];
  // Gemini cites through redirect URLs; the chunk title is the source's domain.
  const citations = chunks.map((g) => (g.web?.title && /\.[a-z]{2,}$/i.test(g.web.title) ? `https://${g.web.title}` : g.web?.uri ?? "")).filter(Boolean);
  return { text: (c?.content?.parts ?? []).map((p) => p.text ?? "").join("\n"), citations };
}

let anthropic: Anthropic | null = null;
async function askClaude(prompt: string): Promise<EngineAnswer> {
  anthropic ??= new Anthropic({ apiKey: env.anthropicKey });
  const useSearch = process.env.AEO_CLAUDE_WEB_SEARCH !== "false";
  const res = await anthropic.messages.create({
    model: process.env.AEO_CLAUDE_MODEL || env.anthropicModel,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    ...(useSearch
      ? { tools: [{ type: (process.env.AEO_CLAUDE_SEARCH_TOOL || "web_search_20250305") as "web_search_20250305", name: "web_search", max_uses: 3 }] }
      : {}),
  } as Anthropic.MessageCreateParamsNonStreaming);
  const text: string[] = [];
  const citations: string[] = [];
  for (const b of res.content as unknown as Record<string, unknown>[]) {
    if (b.type === "text") {
      text.push(String(b.text ?? ""));
      for (const c of (b.citations as { url?: string }[] | undefined) ?? []) if (c.url) citations.push(c.url);
    }
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { url?: string }[]) if (r.url) citations.push(r.url);
    }
  }
  return { text: text.join(""), citations };
}

export function enabledEngines(): Engine[] {
  const list: Engine[] = [];
  if (process.env.OPENAI_API_KEY) list.push({ id: "chatgpt", label: "ChatGPT", ask: askChatGpt });
  if (process.env.ANTHROPIC_API_KEY && process.env.AEO_CLAUDE !== "false") list.push({ id: "claude", label: "Claude", ask: askClaude });
  if (process.env.PERPLEXITY_API_KEY) list.push({ id: "perplexity", label: "Perplexity", ask: askPerplexity });
  if (process.env.GEMINI_API_KEY) list.push({ id: "gemini", label: "Gemini", ask: askGemini });
  return list;
}

/** Old fixed defaults. A campaign that still has exactly these saved is treated as "automatic". */
export const DEFAULT_AEO_PROMPTS = [
  "Who are the best {category} in {city}?",
  "Which {category} in {city} would you recommend? I want someone reliable.",
  "I'm comparing {category} near {city}. Which firms should I shortlist and why?",
];

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/**
 * Run every prompt on every enabled engine. A buyer-intent prompt never names the company,
 * so a mention means the engine genuinely surfaces them.
 */
export async function runMentionsAudit(p: {
  company: string;
  domain: string | null;
  city: string | null;
  category: string;
  prompts?: string[];
  services?: string[];
  promptSource?: AeoAudit["promptSource"];
  engines?: Engine[];
}): Promise<AeoAudit | null> {
  const engines = p.engines ?? enabledEngines();
  if (!engines.length || (!p.category.trim() && !p.prompts?.length)) return null;
  const max = Number(process.env.AEO_MAX_PROMPTS || 3);
  const prompts = (p.prompts?.length ? p.prompts : DEFAULT_AEO_PROMPTS)
    .slice(0, max)
    .map((t) => fillPrompt(t, { category: p.category, city: p.city, company: p.company }));
  const target: MentionTarget = { company: p.company, domain: p.domain };

  const jobs = prompts.flatMap((prompt) => engines.map((engine) => ({ prompt, engine })));
  const results = await pool(jobs, 4, async ({ prompt, engine }): Promise<AeoResult> => {
    try {
      const a = await engine.ask(prompt);
      const hit = detectMention(a.text, a.citations, target);
      return {
        engine: engine.id,
        prompt,
        ...hit,
        competitors: competitorsIn(a.text, target).slice(0, 8),
        citedDomains: citedCompetitorDomains(a.citations, target).slice(0, 8),
        answerExcerpt: a.text.slice(0, 1200),
        error: null,
      };
    } catch (e) {
      return { engine: engine.id, prompt, mentioned: false, cited: false, position: null, snippet: null, competitors: [], citedDomains: [], answerExcerpt: "", error: (e as Error).message.slice(0, 200) };
    }
  });

  const ok = results.filter((r) => !r.error);
  if (!ok.length) return null;
  const mentions = ok.filter((r) => r.mentioned).length;
  return {
    ranAt: new Date().toISOString(),
    category: p.category,
    services: p.services ?? [],
    promptSource: p.promptSource ?? (p.prompts?.length ? "campaign" : "default"),
    engines: engines.map((e) => e.id),
    prompts,
    results,
    mentionRate: Math.round((mentions / ok.length) * 100),
    answered: ok.length,
    mentions,
    topCompetitors: tally(ok.flatMap((r) => r.competitors)).slice(0, 6),
    topCitedDomains: tally(ok.flatMap((r) => r.citedDomains)).slice(0, 6),
  };
}
