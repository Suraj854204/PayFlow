import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { Form16Document } from "@/lib/compliance/form16-document";
import { form16Summary } from "@/lib/compliance/reports";
import { buildWorkbook, ReportsPdf } from "@/lib/reports/documents";
import type { ReportData } from "@/lib/reports/load";

const report: ReportData = {
  endMonth: "2026-10",
  months: ["2026-09", "2026-10"],
  trend: [
    { month: "2026-10", gross: 100000_00, net: 80000_00, employerCost: 110000_00, employees: 3 },
  ],
  departments: [{ department: "Engineering", cost: 110000_00, share: 1 }],
  headcount: [{ month: "2026-10", headcount: 3, joined: 1, exited: 0 }],
  attrition: 0,
  overtime: [{ month: "2026-10", minutes: 120, amount: 500_00 }],
  yoy: [{ month: "2026-10", current: 110000_00, previous: null, changePct: null }],
};

describe("generated documents", () => {
  it("builds an Excel workbook with the expected sheets and rupee values", async () => {
    const buf = await buildWorkbook(report, "Acme");
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Cost trend",
      "Department cost",
      "Headcount",
      "Overtime",
      "Year over year",
    ]);
    expect(wb.getWorksheet("Cost trend")!.getRow(2).getCell(5).value).toBe(110000);
  });

  it("renders the reports PDF", async () => {
    const buf = await renderToBuffer(<ReportsPdf r={report} orgName="Acme" />);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("renders the Form 16 summary PDF", async () => {
    const months = [
      {
        month: "2026-04",
        gross: 100000_00,
        taxable: 95000_00,
        pf: 1800_00,
        pt: 200_00,
        tds: 3000_00,
      },
    ];
    const summary = form16Summary(months, "new", {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      otherDeductions: 0,
    });
    const buf = await renderToBuffer(
      <Form16Document
        d={{
          org: { name: "Acme", tan: null },
          employee: { name: "Asha", code: "E1", panMasked: "ABCDE****F" },
          fyLabel: "2026-27",
          months,
          summary,
        }}
      />,
    );
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
