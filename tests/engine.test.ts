import { describe, expect, it } from "vitest";
import { analyzePage, blockedAiBots, scoreAudit, topIssues } from "@/lib/audit/analyze";
import { parseLeadsCsv } from "@/lib/leads/csv";
import { extractEmails, pickBest } from "@/lib/leads/email";
import { cityFrom, postcodeFrom } from "@/lib/leads/places";
import { detectBounce, stripQuoted } from "@/lib/mail/inbox";
import { renderEmail, threadSubject } from "@/lib/sequence/render";
import { inWindow, jitterFor, localParts, nextInWindow, planSequence } from "@/lib/sequence/schedule";
import { entityTypeFromCompanyType, normaliseCompanyName } from "@/lib/leads/companiesHouse";

const goodHtml = `<!doctype html><html><head><title>Acme Electrical | Leeds Electricians</title>
<meta name="description" content="NICEIC approved electricians in Leeds for rewires, EV chargers and fault finding since 2009.">
<meta name="viewport" content="width=device-width">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Electrician","name":"Acme"}</script>
</head><body><h1>Electricians in Leeds</h1><a href="tel:01131234567">Call</a> Get a quote
<img src="a.jpg" alt="van"><img src="b.jpg" alt="team"><img src="c.jpg" alt="job">
<footer>© 2026 Acme</footer></body></html>`;

const badHtml = `<html><head><title>Home</title></head><body><h1>Welcome</h1><h1>Hi</h1>
<img src="a.jpg"><img src="b.jpg"><img src="c.jpg"><footer>Copyright 2019</footer></body></html>`;

describe("audit analysis", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("passes a well-built page", () => {
    const checks = analyzePage({ finalUrl: "https://acme.co.uk/", html: goodHtml, responseMs: 400, bytes: 1000, robotsTxt: "User-agent: *\nAllow: /", hasSitemap: true, hasLlmsTxt: true, now });
    expect(checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([]);
    expect(scoreAudit(checks, 90)).toBeGreaterThan(90);
  });
  it("flags a weak page and ranks high-impact issues first", () => {
    const checks = analyzePage({
      finalUrl: "http://old.co.uk/",
      html: badHtml,
      responseMs: 2600,
      bytes: 1000,
      robotsTxt: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /",
      hasSitemap: false,
      hasLlmsTxt: false,
      now,
    });
    const failed = new Set(checks.filter((c) => !c.pass).map((c) => c.id));
    for (const id of ["https", "title", "meta_description", "h1", "mobile", "schema", "ai_crawlers", "freshness", "alt_text", "response_time", "click_to_call", "cta"]) {
      expect(failed.has(id), id).toBe(true);
    }
    const top = topIssues(checks);
    expect(top).toHaveLength(3);
    expect(top.every((c) => c.impact === "high")).toBe(true);
    expect(scoreAudit(checks, 20)).toBeLessThan(25);
  });
});

describe("robots.txt AI bot parsing", () => {
  it("applies specific groups over the wildcard", () => {
    expect(blockedAiBots("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:")).toEqual(["GPTBot"]);
  });
  it("handles stacked user-agent lines", () => {
    expect(blockedAiBots("User-agent: ClaudeBot\nUser-agent: PerplexityBot\nDisallow: /")).toEqual(["ClaudeBot", "PerplexityBot"]);
  });
  it("wildcard block catches every bot without its own group", () => {
    expect(blockedAiBots("User-agent: *\nDisallow: /").length).toBe(5);
    expect(blockedAiBots("User-agent: *\nDisallow: /admin")).toEqual([]);
    expect(blockedAiBots(null)).toEqual([]);
  });
});

describe("scheduling", () => {
  const w = { startHour: 8, endHour: 17, days: [1, 2, 3, 4, 5], timezone: "Europe/London" };
  it("pushes a Saturday to Monday 08:00 UK", () => {
    const sat = new Date("2026-11-07T10:00:00Z");
    const t = nextInWindow(sat, w);
    expect(localParts(t, w.timezone)).toMatchObject({ isoDay: 1, hour: 8, minute: 0 });
  });
  it("handles BST (UTC+1) correctly", () => {
    // 06:30 UTC on Tue 7 July 2026 = 07:30 BST -> next slot 08:00 BST = 07:00 UTC
    expect(nextInWindow(new Date("2026-07-07T06:30:00Z"), w).toISOString()).toBe("2026-07-07T07:00:00.000Z");
  });
  it("plans steps by day offset inside the window", () => {
    const [a, b, c] = planSequence(new Date("2026-11-05T15:00:00Z"), [0, 3, 7], w);
    expect(inWindow(a, w) && inWindow(b, w) && inWindow(c, w)).toBe(true);
    expect(b.getTime()).toBeGreaterThan(a.getTime() + 2.9 * 86400000);
    expect(c.getTime()).toBeGreaterThan(b.getTime());
  });
  it("jitter is deterministic and bounded", () => {
    expect(jitterFor("x", 3)).toEqual(jitterFor("x", 3));
    expect(jitterFor("lead-1", 50).every((n) => n >= 0 && n <= 90)).toBe(true);
  });
});

describe("rendering", () => {
  it("fills links, adds signature and opt-out footer", () => {
    const t = renderEmail({
      body: "Hi Jo,\n\nYour audit: [AUDIT_LINK]\n\nBook: [BOOKING_LINK]",
      auditUrl: "https://x.test/p/abc",
      bookingUrl: "https://x.test/go/abc",
      signature: "Ram",
      unsubscribeUrl: "https://x.test/u/abc",
      identity: "ZappSites, 160 City Road, London EC1V 2NX",
    });
    expect(t).toContain("https://x.test/p/abc");
    expect(t).toContain("https://x.test/go/abc");
    expect(t).not.toContain("[AUDIT_LINK]");
    expect(t).toContain("ZappSites, 160 City Road, London EC1V 2NX.");
    expect(t).toContain("unsubscribe: https://x.test/u/abc");
    expect(t).not.toMatch(/[—–]/);
  });
  it("threads follow-up subjects", () => {
    expect(threadSubject("quick one", 0)).toBe("quick one");
    expect(threadSubject("quick one", 2)).toBe("Re: quick one");
    expect(threadSubject("Re: quick one", 1)).toBe("Re: quick one");
  });
});

describe("lead parsing", () => {
  it("maps flexible CSV headers and infers entity type", () => {
    const { leads, skipped } = parseLeadsCsv(
      "Business Name,Website,Email,First Name,Town\nAcme Ltd,www.acme.co.uk,,Jo,Leeds\nBob Plumbing,,bob@bobplumb.co.uk,,\nNo Contact,,,,\n",
    );
    expect(skipped).toBe(1);
    expect(leads[0]).toMatchObject({ company: "Acme Ltd", website: "https://www.acme.co.uk", domain: "acme.co.uk", first_name: "Jo", entity_type: "company" });
    expect(leads[1]).toMatchObject({ domain: "bobplumb.co.uk", entity_type: "unknown" });
  });
  it("extracts and ranks emails", () => {
    const html = `mailto:info@acme.co.uk <a>jo.smith@acme.co.uk</a> logo@2x.png x@gmail.com sales&#64;acme.co.uk`;
    const found = extractEmails(html, "acme.co.uk");
    expect(found).toContain("sales@acme.co.uk");
    expect(found).not.toContain("logo@2x.png");
    expect(pickBest(found, "acme.co.uk", "Jo")).toBe("jo.smith@acme.co.uk");
    expect(pickBest(["info@acme.co.uk", "x@gmail.com"], "acme.co.uk")).toBe("info@acme.co.uk");
  });
  it("parses UK addresses", () => {
    expect(postcodeFrom("1 High St, Leeds LS1 4AP, UK")).toBe("LS1 4AP");
    expect(cityFrom("1 High St, Leeds LS1 4AP, UK")).toBe("Leeds");
  });
  it("classifies Companies House types for PECR", () => {
    expect(entityTypeFromCompanyType("ltd")).toBe("company");
    expect(entityTypeFromCompanyType("llp")).toBe("llp");
    expect(entityTypeFromCompanyType("limited-partnership")).toBe("partnership");
    expect(normaliseCompanyName("The Acme Group Ltd.")).toBe("acme");
  });
});

describe("inbox parsing", () => {
  it("strips quoted history", () => {
    expect(stripQuoted("Yes, Thursday works.\n\nOn Mon, 3 Nov 2026, Ram wrote:\n> Hi Jo")).toBe("Yes, Thursday works.");
  });
  it("detects bounces and the failed recipient", () => {
    const b = detectBounce("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "Final-Recipient: rfc822; jo@acme.co.uk\nStatus: 5.1.1");
    expect(b).toEqual({ isBounce: true, recipient: "jo@acme.co.uk" });
    expect(detectBounce("jo@acme.co.uk", "Re: quick one", "thanks").isBounce).toBe(false);
  });
});
