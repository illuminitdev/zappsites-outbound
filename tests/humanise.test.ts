import { describe, expect, it } from "vitest";
import { bannedFound, humanise, humaniseSubject } from "@/lib/sequence/humanise";

describe("humanise", () => {
  it("removes dashes, curly quotes, exclamation marks and markdown", () => {
    const t = humanise("Hi Jo —\n\nYour site’s **great** — but slow!! It takes 3–5 seconds…");
    expect(t).not.toMatch(/[—–’*!…]/);
    expect(t).toContain("Your site's great, but slow.");
    expect(t).toContain("3-5 seconds...");
  });
  it("finds stock phrases", () => {
    expect(bannedFound("I hope this email finds you well. I came across your site and wanted to elevate it.")).toEqual(
      expect.arrayContaining(["i hope this email finds you well", "i came across", "elevate"]),
    );
    expect(bannedFound("I asked ChatGPT about brokers in Leeds and you weren't there.")).toEqual([]);
  });
  it("makes subjects read like a note, keeping names", () => {
    expect(humaniseSubject("Your Website Speed Issue")).toBe("your website speed issue");
    expect(humaniseSubject("Brightcover And ChatGPT", ["Brightcover", "ChatGPT"])).toBe("Brightcover and ChatGPT");
    expect(humaniseSubject("Quick look at your site.")).toBe("quick look at your site");
    expect(humaniseSubject("I asked ChatGPT about you")).toBe("I asked ChatGPT about you");
  });
});
