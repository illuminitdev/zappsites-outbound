import { describe, expect, it } from "vitest";
import { aeoCheck } from "@/lib/audit";
import { runMentionsAudit, type EngineAnswer } from "@/lib/audit/mentions";
import { brandTokens, citedCompetitorDomains, competitorsIn, detectMention, fillPrompt, listEntries, tally } from "@/lib/audit/mentionsDetect";

const target = { company: "Brightcover Insurance Brokers Ltd", domain: "brightcover.co.uk" };

const answerWithout = `Here are some well-regarded commercial insurance brokers for tradespeople in Leeds:

1. **Towergate Insurance** – a large national broker with trade schemes.
2. **Bluefin Group** - strong on liability cover.
3. **Smith & Co Brokers**: local and independent.

**Tips for choosing a broker**
- Check they are FCA authorised.
- Ask about public liability limits.`;

const answerWith = `Top picks:
1. Towergate Insurance – national.
2. Brightcover – an independent Leeds broker focused on electricians and plumbers.
Brightcover has strong reviews.`;

describe("brand matching", () => {
  it("keeps only distinctive tokens", () => {
    expect(brandTokens("Brightcover Insurance Brokers Ltd")).toEqual(["brightcover"]);
    expect(brandTokens("Insurance Brokers Ltd")).toEqual(["insurance", "brokers"]);
  });
  it("detects absence, presence, list position and citations", () => {
    expect(detectMention(answerWithout, [], target).mentioned).toBe(false);
    const hit = detectMention(answerWith, ["https://www.brightcover.co.uk/about"], target);
    expect(hit).toMatchObject({ mentioned: true, cited: true, position: 2 });
    expect(hit.snippet).toContain("Brightcover");
  });
  it("does not match a partial word", () => {
    expect(detectMention("Try Brightcoverage Ltd for cover.", [], target).mentioned).toBe(false);
  });
  it("counts a citation alone as a mention", () => {
    expect(detectMention("See the sources.", ["https://brightcover.co.uk"], target)).toMatchObject({ mentioned: true, cited: true });
  });
});

describe("competitor extraction", () => {
  it("pulls business names from lists and skips advice headings", () => {
    expect(listEntries(answerWithout).slice(0, 3)).toEqual(["Towergate Insurance", "Bluefin Group", "Smith & Co Brokers"]);
    const c = competitorsIn(answerWithout, target);
    expect(c).toEqual(["Towergate Insurance", "Bluefin Group", "Smith & Co Brokers"]);
    expect(competitorsIn(answerWith, target)).toEqual(["Towergate Insurance"]);
  });
  it("ranks cited domains excluding the target", () => {
    expect(citedCompetitorDomains(["https://www.towergate.co.uk/a", "https://towergate.co.uk/b", "https://brightcover.co.uk", "https://bluefin.co.uk"], target)).toEqual(["towergate.co.uk", "bluefin.co.uk"]);
  });
  it("tallies names case-insensitively", () => {
    expect(tally(["Towergate Insurance", "towergate insurance", "Bluefin Group"])[0]).toEqual({ name: "Towergate Insurance", count: 2 });
  });
  it("fills prompt templates, defaulting the city", () => {
    expect(fillPrompt("Who are the best {category} in {city}?", { category: "brokers", city: null, company: "X" })).toBe("Who are the best brokers in the UK?");
    expect(fillPrompt("Best {category} near {city}", { category: "brokers", city: "Leeds", company: "X" })).toBe("Best brokers near Leeds");
  });
});

describe("mentions audit run", () => {
  const fake = (answer: EngineAnswer, id: "chatgpt" | "perplexity") => ({ id, label: id, ask: async () => answer });
  it("aggregates engines x prompts into a scored check", async () => {
    const aeo = await runMentionsAudit({
      ...target,
      city: "Leeds",
      category: "commercial insurance brokers for tradespeople",
      prompts: ["Who are the best {category} in {city}?", "Recommend {category} in {city}"],
      engines: [fake({ text: answerWithout, citations: ["https://towergate.co.uk"] }, "chatgpt"), fake({ text: answerWith, citations: [] }, "perplexity")],
    });
    expect(aeo).not.toBeNull();
    expect(aeo!.answered).toBe(4);
    expect(aeo!.mentions).toBe(2);
    expect(aeo!.mentionRate).toBe(50);
    expect(aeo!.prompts[0]).toBe("Who are the best commercial insurance brokers for tradespeople in Leeds?");
    expect(aeo!.topCompetitors[0]).toEqual({ name: "Towergate Insurance", count: 4 });
    const check = aeoCheck(aeo!);
    expect(check).toMatchObject({ id: "ai_mentions", pass: true, impact: "high" });
  });
  it("fails the check and names rivals when never mentioned", async () => {
    const aeo = await runMentionsAudit({ ...target, city: "Leeds", category: "brokers", engines: [fake({ text: answerWithout, citations: [] }, "chatgpt")] });
    const check = aeoCheck(aeo!);
    expect(check.pass).toBe(false);
    expect(check.detail).toContain("3 times and you didn't come up once");
    expect(check.detail).toContain("Towergate Insurance");
  });
  it("survives an engine error and skips when nothing answers", async () => {
    const broken = { id: "chatgpt" as const, label: "x", ask: async (): Promise<EngineAnswer> => { throw new Error("rate limited"); } };
    expect(await runMentionsAudit({ ...target, city: null, category: "brokers", engines: [broken] })).toBeNull();
    expect(await runMentionsAudit({ ...target, city: null, category: "", engines: [fake({ text: "", citations: [] }, "chatgpt")] })).toBeNull();
  });
});

import { cleanPrompts, expandServiceTemplates, findServicesLink, pageText, templatePrompts } from "../src/lib/audit/services";

describe("service-aware AEO prompts", () => {
  it("extracts visible text and skips scripts", () => {
    const t = pageText(`<html><head><title>Leeds Boilers &amp; Heating</title><meta name="description" content="Boiler repair in Leeds"><script>var x=1</script></head><body><nav><a href="/services">Services</a></nav><h1>Boiler installation</h1><p>Emergency boiler repair, 24/7</p><style>.a{}</style></body></html>`);
    expect(t).toContain("TITLE: Leeds Boilers & Heating");
    expect(t).toContain("Emergency boiler repair, 24/7");
    expect(t).not.toContain("var x");
  });

  it("finds a same-site services page", () => {
    const html = `<a href="https://facebook.com/services">fb</a><a href="/about">About</a><a href="/our-services/">What we do</a>`;
    expect(findServicesLink(html, "https://acme.co.uk/")).toBe("https://acme.co.uk/our-services/");
    expect(findServicesLink(`<a href="/contact">Contact</a>`, "https://acme.co.uk/")).toBeNull();
  });

  it("drops prompts that name the business and dedupes", () => {
    const out = cleanPrompts(
      [
        "Who is the best boiler repair company in Leeds?",
        "Is Smith Heating good for boiler repair in Leeds?",
        "Should I use smithheating.co.uk?",
        "who is the best boiler repair company in leeds?",
        "I need a new boiler fitted in Leeds, who do you recommend?",
      ],
      "Smith Heating Ltd",
      "smithheating.co.uk",
      3,
    );
    expect(out).toEqual(["Who is the best boiler repair company in Leeds?", "I need a new boiler fitted in Leeds, who do you recommend?"]);
  });

  it("writes one template question per service, then the category", () => {
    const p = templatePrompts({ services: ["boiler repair", "bathroom fitting"], category: "plumbers", city: "Leeds" }, 3);
    expect(p).toHaveLength(3);
    expect(p[0]).toContain("boiler repair in Leeds");
    expect(p[1]).toContain("bathroom fitting in Leeds");
    expect(p[2]).toContain("plumbers in Leeds");
  });

  it("expands {service} campaign templates across services", () => {
    const out = expandServiceTemplates(["Who's best for {service} in {city}?"], ["deep cleaning", "end of tenancy cleaning", "office cleaning"], 3);
    expect(out).toEqual(["Who's best for deep cleaning in {city}?", "Who's best for end of tenancy cleaning in {city}?", "Who's best for office cleaning in {city}?"]);
  });
});
