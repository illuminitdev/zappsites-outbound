import { describe, expect, it } from "vitest";
import { analyzePage, scoreAudit, topIssues } from "@/lib/audit/analyze";
import { hasPageFor, internalLinks, localChecks, normPhone, schemaCheck, sitemapUrls, ukPhones } from "@/lib/audit/local";
import { detectPlatform, isBotWall, looksJsRendered } from "@/lib/audit/platform";
import { fixPlan } from "@/lib/offers";
import type { Audit, AuditCheck } from "@/lib/types";

const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

describe("schema completeness", () => {
  it("fails when missing", () => expect(schemaCheck("<html></html>").pass).toBe(false));
  it("passes a complete LocalBusiness inside @graph", () => {
    const c = schemaCheck(ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite" }, { "@type": "Plumber", name: "A", address: {}, telephone: "0113", areaServed: "Leeds", openingHours: "Mo-Fr" }] }));
    expect(c.pass).toBe(true);
    expect(c.detail).toContain("Plumber");
  });
  it("flags a bare Organization with gaps", () => {
    const c = schemaCheck(ld({ "@type": "Organization", name: "A" }));
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/not a local business/);
  });
  it("ignores malformed JSON-LD", () => expect(schemaCheck(`<script type="application/ld+json">{bad</script>`).pass).toBe(false));
});

describe("service pages", () => {
  const links = internalLinks(
    `<a href="/boiler-installation/">New boilers</a><a href="/services/bathrooms">Bathroom fitting</a><a href="https://other.com/x">x</a><a href="/contact">Contact</a>`,
    "https://acme.co.uk/",
  );
  it("collects same-site links only", () => expect(links.map((l) => new URL(l.href).pathname)).toEqual(["/boiler-installation/", "/services/bathrooms", "/contact"]));
  it("matches by URL or anchor text with stemming", () => {
    expect(hasPageFor("boiler installation", links, [])).toBe(true);
    expect(hasPageFor("bathroom fitting", links, [])).toBe(true);
    expect(hasPageFor("boiler repair", links, [])).toBe(false);
    expect(hasPageFor("boiler repair", [], ["https://acme.co.uk/boiler-repairs-leeds/"])).toBe(true);
  });
  it("reads sitemap urls and index children", () => {
    expect(sitemapUrls(`<urlset><url><loc>https://a.co/x</loc></url></urlset>`).urls).toEqual(["https://a.co/x"]);
    expect(sitemapUrls(`<sitemapindex><sitemap><loc>https://a.co/page-sitemap.xml</loc></sitemap></sitemapindex>`).children).toEqual(["https://a.co/page-sitemap.xml"]);
  });
});

describe("phones and NAP", () => {
  it("normalises UK numbers", () => {
    expect(ukPhones("Call 0113 496 0000 or +44 (0)7700 900123")).toEqual(["01134960000", "07700900123"]);
    expect(normPhone("+44 113 496 0000")).toBe("01134960000");
  });
  const base = { title: "Plumbers", h1: "Plumbing", services: [], links: [], sitemap: [] };
  it("passes with phone + postcode, fails on a mismatch with the Google listing", () => {
    const html = `<body><a href="tel:01134960000">0113 496 0000</a> 1 High St, Leeds LS1 4AB</body>`;
    const ok = localChecks({ ...base, html, visibleText: "0113 496 0000 1 High St, Leeds LS1 4AB", city: null, knownPhone: "0113 496 0000" }).find((c) => c.id === "nap")!;
    expect(ok.pass).toBe(true);
    const bad = localChecks({ ...base, html, visibleText: "0113 496 0000 1 High St, Leeds LS1 4AB", city: null, knownPhone: "0113 496 1111" }).find((c) => c.id === "nap")!;
    expect(bad.pass).toBe(false);
    expect(bad.detail).toMatch(/doesn't match/);
  });
  it("checks the town is in the title or H1", () => {
    const c = localChecks({ ...base, html: "", visibleText: "", city: "Leeds", knownPhone: null, title: "Smith Plumbing | Boilers" }).find((c) => c.id === "local_headline")!;
    expect(c.pass).toBe(false);
    const c2 = localChecks({ ...base, html: "", visibleText: "", city: "Leeds", knownPhone: null, h1: "Plumbers in Leeds" }).find((c) => c.id === "local_headline")!;
    expect(c2.pass).toBe(true);
  });
  it("reports missing service pages by name", () => {
    const c = localChecks({ ...base, html: "", visibleText: "", city: "Leeds", knownPhone: null, services: ["boiler repair", "bathroom fitting"] }).find((c) => c.id === "service_pages")!;
    expect(c.pass).toBe(false);
    expect(c.detail).toContain("boiler repair");
  });
});

describe("accuracy", () => {
  it("detects platforms", () => {
    expect(detectPlatform(`<link href="https://static.wixstatic.com/x.css">`)).toBe("Wix");
    expect(detectPlatform(`<meta name="generator" content="WordPress 6.6">`)).toBe("WordPress");
    expect(detectPlatform(`<script src="https://static1.squarespace.com/a.js"></script>`)).toBe("Squarespace");
  });
  it("spots an empty JS shell but not a normal page", () => {
    expect(looksJsRendered(`<html><body><div id="root"></div><script src="/a.js"></script></body></html>`)).toBe(true);
    expect(looksJsRendered(`<html><body><h1>Plumbers in Leeds</h1><p>${"We fix boilers and bathrooms across Leeds every day. ".repeat(10)}</p></body></html>`)).toBe(false);
  });
  it("recognises a Cloudflare challenge", () => {
    expect(isBotWall(403, "<title>Just a moment...</title>", new Headers({ server: "cloudflare" }))).toBe(true);
    expect(isBotWall(500, "<h1>Server error</h1>")).toBe(false);
  });
  it("leaves unverified checks out of the score and top issues", () => {
    const checks: AuditCheck[] = [
      { id: "a", label: "A", pass: true, impact: "high", detail: "" },
      { id: "b", label: "B", pass: false, unverified: true, impact: "high", detail: "" },
    ];
    expect(scoreAudit(checks, null)).toBe(100);
    expect(topIssues(checks)).toEqual([]);
  });
  it("analyzePage still produces the schema check", () => {
    const c = analyzePage({ finalUrl: "https://a.co/", html: "<html></html>", responseMs: 100, bytes: 10, robotsTxt: null, hasSitemap: false, hasLlmsTxt: false });
    expect(c.find((x) => x.id === "schema")).toBeTruthy();
  });
});

describe("fix plan", () => {
  const audit = (fails: string[], extra: Partial<Audit> = {}): Audit => ({
    url: "https://a.co/",
    fetchedAt: "",
    reachable: true,
    performance: { mobileScore: 40, lcpSeconds: 5, cls: 0 },
    checks: fails.map((id) => ({ id, label: id, pass: false, impact: "high", detail: "" })),
    score: 40,
    topIssues: [],
    ...extra,
  });
  it("no website: Website Essential", () => {
    const p = fixPlan(null);
    expect(p.noWebsite).toBe(true);
    expect(p.steps[0].offer.name).toBe("Website Essential");
  });
  it("broken basics + local gaps: both packages and the bundle", () => {
    const p = fixPlan(audit(["mobile_speed", "https", "service_pages", "schema"]));
    expect(p.steps.map((s) => s.offer.id)).toEqual(["essential", "local_growth"]);
    expect(p.monthly).toBe(238);
    expect(p.bundle?.price).toBe(249);
  });
  it("a decent site with minor gaps gets Local Growth, not a rebuild", () => {
    const p = fixPlan(audit(["meta_description", "service_pages"]));
    expect(p.steps.map((s) => s.offer.id)).toEqual(["local_growth"]);
    expect(p.bundle).toBeNull();
  });
  it("never sells a fix for something we couldn't check", () => {
    const a = audit([]);
    a.checks = [{ id: "schema", label: "s", pass: false, unverified: true, impact: "high", detail: "" }];
    expect(fixPlan(a).steps).toEqual([]);
  });
});
