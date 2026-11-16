import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseLeadsCsv } from "../src/lib/leads/csv";

describe("Excel lead upload", () => {
  it("reads the .xlsx template into the same leads as the CSV template", async () => {
    const rows = await readSheet(readFileSync("public/leads-template.xlsx"));
    const text = Papa.unparse(rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : (c ?? "")))));
    const fromXlsx = parseLeadsCsv(text);
    const fromCsv = parseLeadsCsv(readFileSync("public/leads-template.csv", "utf8"));
    expect(fromXlsx.leads).toHaveLength(1);
    expect(fromXlsx.leads[0]).toMatchObject({ company: "Acme Plumbing Ltd", email: "info@acmeplumbing.co.uk", entity_type: "company", city: "Leeds" });
    expect(fromXlsx).toEqual(fromCsv);
  });
});
