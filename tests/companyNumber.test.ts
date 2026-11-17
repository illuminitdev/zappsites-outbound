import { describe, expect, it } from "vitest";
import { extractCompanyNumbers } from "../src/lib/leads/companiesHouse";

describe("extractCompanyNumbers", () => {
  it("reads the common UK footer formats and pads to 8 characters", () => {
    expect(extractCompanyNumbers("Falcon Insurance Ltd. Registered in England No. 06012879")).toEqual(["06012879"]);
    expect(extractCompanyNumbers("One 2 One Insurance Ltd Company Reg Number 02118024")).toEqual(["02118024"]);
    expect(extractCompanyNumbers("T H March & Co Ltd, Registered in England No 116175")).toEqual(["00116175"]);
    expect(extractCompanyNumbers("Registered in England and Wales, company number: 12345678")).toEqual(["12345678"]);
    expect(extractCompanyNumbers("Company number SC123456")).toEqual(["SC123456"]);
    expect(extractCompanyNumbers("Registration Number 750484")).toEqual(["00750484"]);
  });

  it("ignores FCA register numbers", () => {
    expect(extractCompanyNumbers("Authorised and regulated by the FCA. Our Register number is 301623")).toEqual([]);
    expect(extractCompanyNumbers("Firm Reference Number 769110")).toEqual([]);
  });
});
