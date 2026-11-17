import { describe, expect, it } from "vitest";
import * as d from "@/lib/audit/deeper";
import { groupChecks, CATEGORY } from "@/lib/audit/analyze";
import { bestSubject, pickHooks, weakSubject } from "@/lib/sequence/hooks";
import type { Audit, Lead } from "@/lib/types";

const txt = (s: string) => s;

describe("deeper checks", () => {
  it("catches noindex and robots blocking everyone", () => {
    expect(d.indexable(`<meta name="robots" content="noindex, nofollow">`, undefined, null).pass).toBe(false);
    expect(d.indexable("", new Headers({ "x-robots-tag": "noindex" }), null).pass).toBe(false);
    expect(d.indexable("", undefined, "User-agent: *\nDisallow: /").pass).toBe(false);
    expect(d.indexable("", undefined, "User-agent: *\nDisallow: /wp-admin/").pass).toBe(true);
  });
  it("canonical to another domain is high impact", () => {
    expect(d.canonical(`<link rel="canonical" href="https://other.com/">`, "https://a.co/")!.impact).toBe("high");
    expect(d.canonical(`<link rel="canonical" href="https://www.a.co/">`, "https://a.co/")!.pass).toBe(true);
  });
  it("flags mixed content only on https", () => {
    expect(d.mixedContent(`<img src="http://a.co/x.jpg">`, "https://a.co/")!.pass).toBe(false);
    expect(d.mixedContent(`<img src="http://a.co/x.jpg">`, "http://a.co/")).toBeNull();
  });
  it("finds accreditations in text and image alt", () => {
    const c = d.accreditations(`<img alt="Gas Safe Register">`, "Fully insured. NICEIC approved contractor.");
    expect(c.pass).toBe(true);
    expect(c.detail).toContain("Gas Safe");
    expect(c.detail).toContain("NICEIC");
    expect(d.accreditations("", "We fix boilers.").pass).toBe(false);
  });
  it("spots reviews, forms, booking, whatsapp, hours", () => {
    expect(d.socialProof(`<script src="https://widget.trustpilot.com/x.js">`, "").pass).toBe(true);
    expect(d.socialProof("", "What our customers say: rated 4.9 out of 5").pass).toBe(true);
    expect(d.socialProof("", "We fix boilers").pass).toBe(false);
    expect(d.contactForm(`<form><input type="email"><textarea name="message"></textarea></form>`).pass).toBe(true);
    expect(d.contactForm(`<form><input type="search"></form>`).pass).toBe(false);
    expect(d.onlineBooking(`<a href="https://calendly.com/x">`, "").pass).toBe(true);
    expect(d.onlineBooking("", "Book online in 30 seconds").pass).toBe(true);
    expect(d.whatsapp(`<a href="https://wa.me/447700900123">`).pass).toBe(true);
    expect(d.openingHours("", "Open Mon-Fri 8am-6pm").pass).toBe(true);
    expect(d.openingHours("", "We fix boilers").pass).toBe(false);
  });
  it("content depth and faq", () => {
    expect(d.contentDepth("short page").pass).toBe(false);
    expect(d.contentDepth("word ".repeat(300)).pass).toBe(true);
    expect(d.faq(`{"@type":"FAQPage"}`, "").detail).toContain("marked up");
    expect(d.faq("", "Frequently asked questions").pass).toBe(true);
  });
  it("headings and images", () => {
    expect(d.headings("<h1>a</h1><h1>b</h1>").detail).toContain("2 main headings");
    expect(d.headings("<h1>a</h1><h2>b</h2>").pass).toBe(true);
    expect(d.imageFormats(`<img src="a.jpg"><img src="b.jpg"><img src="c.png">`)!.pass).toBe(false);
    expect(d.imageFormats(`<img src="a.webp"><img src="b.webp"><img src="c.png">`)!.pass).toBe(true);
    expect(d.imageFormats(`<img src="a.jpg">`)).toBeNull();
  });
  it("every check id has a category", () => {
    const ids = ["indexable", "canonical", "redirects", "broken_links", "email_auth", "reviews", "accreditations", "contact_form", "online_booking", "faq", "content_depth", "og_tags"];
    for (const id of ids) expect(CATEGORY[id], id).toBeTruthy();
    const g = groupChecks([{ id: "faq", label: "", pass: false, impact: "medium", detail: "" }, { id: "https", label: "", pass: true, impact: "high", detail: "" }]);
    expect(g.map((x) => x.category)).toEqual(["ai", "technical"]);
  });
});

const lead = (over: Partial<Lead> = {}): Lead =>
  ({ id: "1", campaign_id: null, company: "Smith Heating Ltd", website: "https://smithheating.co.uk", domain: "smithheating.co.uk", first_name: "Dave", last_name: null, email: null, email_status: "unknown", email_source: null, city: "Leeds", source: "csv", source_ref: null, entity_type: "ltd", pecr_ok: true, status: "new", slug: "x", audit: null, audit_score: null, notes: null, audit_note: null, last_error: null, created_at: "", ...over }) as Lead;

const audit = (fails: { id: string; detail: string }[], aeo?: Audit["aeo"]): Audit => ({
  url: "https://smithheating.co.uk/",
  fetchedAt: "",
  reachable: true,
  performance: { mobileScore: 40, lcpSeconds: 5.8, cls: 0 },
  checks: fails.map((f) => ({ ...f, label: f.id, pass: false, impact: "high" as const })),
  score: 40,
  topIssues: [],
  aeo,
});

describe("hooks and subjects", () => {
  const aeo: Audit["aeo"] = {
    ranAt: "2026-11-16", category: "plumbers", engines: ["chatgpt", "claude"], prompts: ["Who does boiler repair in Leeds?"], services: ["boiler repair"],
    results: [
      { engine: "chatgpt", prompt: "Who does boiler repair in Leeds?", mentioned: false, position: null, competitors: ["Aire Valley Heating", "LS Boilers"], sources: [], snippet: "" },
      { engine: "claude", prompt: "Who does boiler repair in Leeds?", mentioned: true, position: 3, competitors: [], sources: [], snippet: "" },
    ],
    answered: 2, mentions: 1, mentionRate: 50, topCompetitors: [{ name: "Aire Valley Heating", count: 1 }], sources: [],
  } as unknown as Audit["aeo"];

  it("leads with the AI miss and names the competitor", () => {
    const a = audit([{ id: "mobile_speed", detail: "Slow. Real visitors on phones wait about 5.8 seconds before the main content shows." }], { ...aeo!, mentionRate: 25 });
    const h = pickHooks(lead({ audit: a }), a);
    expect(h[0].id).toBe("ai_miss");
    expect(h[0].fact).toContain("Aire Valley Heating");
    expect(h[0].subjects[1]).toBe("chatgpt recommended aire valley heating instead");
    expect(h[1].id).toBe("slow");
    expect(h[1].subjects[0]).toBe("5.8 seconds on a phone");
  });
  it("phone mismatch and missing service pages carry the specifics", () => {
    const a = audit([
      { id: "nap", detail: "The number on your site (0113 496 0218) doesn't match the one on your Google listing (0113 496 0477)." },
      { id: "service_pages", detail: "Only 1 of 4. There's no page for boiler repair, bathroom fitting and power flushing, so you're unlikely to show up." },
    ]);
    const h = pickHooks(lead({ audit: a }), a);
    expect(h.map((x) => x.id)).toEqual(["phone_mismatch", "service_pages"]);
    expect(h[0].fact).toContain("0113 496 0477");
    expect(h[1].subjects[1]).toBe("boiler repair in leeds");
  });
  it("no website gets its own opener", () => {
    const h = pickHooks(lead({ website: null, domain: null }), null);
    expect(h[0].id).toBe("no_site");
  });
  it("rejects generic subjects and picks the specific one", () => {
    const a = audit([{ id: "mobile_speed", detail: "about 5.8 seconds" }]);
    const l = lead({ audit: a });
    const h = pickHooks(l, a);
    expect(weakSubject("quick question", l, h)).toBe(true);
    expect(weakSubject("your website", l, h)).toBe(true);
    expect(weakSubject("Re: proposal", l, h)).toBe(true);
    expect(weakSubject("5.8 seconds on a phone", l, h)).toBe(false);
    expect(weakSubject("smithheating.co.uk on a phone", l, h)).toBe(false);
    expect(bestSubject(["improving your website", "quick question", "5.8 seconds on a phone"], l, h)).toBe("5.8 seconds on a phone");
    expect(bestSubject(["website review", "free audit"], l, h)).toBe("5.8 seconds on a phone"); // falls back to the hook's own idea
  });
});
