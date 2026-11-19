import { describe, expect, it } from "vitest";
import { cleanEmail, extractEmails, isValidSyntax } from "@/lib/leads/email";

describe("encoded mailto: links", () => {
  it("drops a leading %20 (encoded space) from a scraped address", () => {
    const html = `<a href="mailto:%20info@reydirectinsurance.co.uk">Email us</a>`;
    expect(extractEmails(html, "reydirectinsurance.co.uk")).toEqual(["info@reydirectinsurance.co.uk"]);
  });

  it("decodes %40 for @ inside mailto: links", () => {
    expect(extractEmails(`<a href="mailto:sales%40acme.co.uk">x</a>`, "acme.co.uk")).toEqual(["sales@acme.co.uk"]);
  });

  it("cleanEmail tidies stored addresses", () => {
    expect(cleanEmail("%20info@reydirectinsurance.co.uk")).toBe("info@reydirectinsurance.co.uk");
    expect(cleanEmail(" Mailto:Info@Acme.co.uk. ")).toBe("info@acme.co.uk");
    expect(cleanEmail("<bob@acme.co.uk>")).toBe("bob@acme.co.uk");
  });

  it("treats % in an address as invalid", () => {
    expect(isValidSyntax("%20info@acme.co.uk")).toBe(false);
    expect(isValidSyntax("info@acme.co.uk")).toBe(true);
  });
});
