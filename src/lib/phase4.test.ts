import { describe, expect, it } from "vitest";
import { classifyDay, dateRange, workingDays } from "@/lib/attendance/calendar";
import {
  computeDay,
  dateInTz,
  haversineMeters,
  insideGeofence,
  scheduledMinutes,
  DEFAULT_SHIFT,
} from "@/lib/attendance/calc";
import { carryForward, chargeableDays, checkBalance, daysByMonth, overlaps } from "@/lib/leave";
import { dueDate, dueState, planCalendar } from "@/lib/compliance/calendar";
import { hraExemption } from "@/lib/payroll/tax";
import { rupeesToPaise as R } from "@/lib/money";
import {
  attritionRate,
  costTrend,
  departmentCost,
  headcountSeries,
  overtimeByMonth,
  yearOverYear,
  lastMonths,
} from "@/lib/reports/aggregate";

const none = new Set<string>();

describe("calendar", () => {
  it("classifies days", () => {
    expect(classifyDay("2026-11-01", [0], none)).toBe("weekly_off"); // Sunday
    expect(classifyDay("2026-11-02", [0], none)).toBe("working");
    expect(classifyDay("2026-11-02", [0], new Set(["2026-11-02"]))).toBe("holiday");
  });
  it("counts working days", () => {
    expect(workingDays("2026-11", [0], none)).toBe(25); // 30 days, 5 Sundays
    expect(workingDays("2026-11", [0, 6], none)).toBe(21);
  });
  it("date range is inclusive and guards runaway ranges", () => {
    expect(dateRange("2026-02-27", "2026-03-02")).toHaveLength(4);
    expect(dateRange("2026-03-02", "2026-03-01")).toEqual([]);
    expect(() => dateRange("2020-01-01", "2026-01-01")).toThrow();
  });
});

describe("geo-fence", () => {
  const office = { lat: 12.9716, lng: 77.5946, radiusM: 200 };
  it("measures distance", () => {
    expect(haversineMeters(office, office)).toBe(0);
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
  it("is inside, outside or unknown", () => {
    expect(insideGeofence({ lat: 12.9717, lng: 77.5947 }, office)).toBe(true);
    expect(insideGeofence({ lat: 13.05, lng: 77.6 }, office)).toBe(false);
    expect(insideGeofence(null, office)).toBeNull();
    expect(insideGeofence({ lat: 1, lng: 1 }, null)).toBeNull();
  });
});

describe("attendance day", () => {
  const tz = "Asia/Kolkata";
  const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00+05:30`);
  it("reads dates and minutes in the company time zone", () => {
    expect(dateInTz(new Date("2026-11-01T20:00:00Z"), tz)).toBe("2026-11-02"); // 01:30 IST next day
  });
  it("full day, on time", () => {
    const r = computeDay(at("09:30"), at("18:30"), DEFAULT_SHIFT, tz);
    expect(r).toEqual({
      workedMinutes: 540,
      lateMinutes: 0,
      overtimeMinutes: 0,
      status: "present",
    });
  });
  it("late beyond grace, overtime past threshold and cap", () => {
    expect(computeDay(at("09:45"), at("18:45"), DEFAULT_SHIFT, tz).lateMinutes).toBe(15);
    expect(computeDay(at("09:35"), at("18:35"), DEFAULT_SHIFT, tz).lateMinutes).toBe(0);
    expect(computeDay(at("09:30"), at("19:15"), DEFAULT_SHIFT, tz).overtimeMinutes).toBe(45);
    expect(computeDay(at("09:30"), at("19:00"), DEFAULT_SHIFT, tz).overtimeMinutes).toBe(30);
    expect(computeDay(at("09:30"), at("19:00"), DEFAULT_SHIFT, tz).overtimeMinutes).toBe(30);
    expect(computeDay(at("06:00"), at("23:59"), DEFAULT_SHIFT, tz).overtimeMinutes).toBe(240);
  });
  it("half day, absent and missing check-out", () => {
    expect(computeDay(at("09:30"), at("14:00"), DEFAULT_SHIFT, tz).status).toBe("half_day");
    expect(computeDay(at("09:30"), at("10:30"), DEFAULT_SHIFT, tz).status).toBe("absent");
    expect(computeDay(at("09:30"), null, DEFAULT_SHIFT, tz)).toMatchObject({
      workedMinutes: 0,
      status: "present",
    });
  });
  it("overnight shift length", () => {
    expect(scheduledMinutes({ start: "22:00", end: "06:00", graceMinutes: 0 })).toBe(480);
  });
});

describe("leave", () => {
  const cal = { weeklyOffs: [0], holidays: new Set(["2026-11-04"]) };
  it("skips weekly offs and holidays", () => {
    // Mon 2 Nov to Sun 8 Nov: 7 days, minus Sunday 8th... (1st is Sunday, outside) and holiday on 4th => 5
    expect(chargeableDays("2026-11-02", "2026-11-08", cal)).toBe(5);
    expect(chargeableDays("2026-11-01", "2026-11-01", cal)).toBe(0);
  });
  it("half day only on a single date", () => {
    expect(chargeableDays("2026-11-02", "2026-11-02", cal, true)).toBe(0.5);
    expect(() => chargeableDays("2026-11-02", "2026-11-03", cal, true)).toThrow();
  });
  it("splits across months", () => {
    expect(
      daysByMonth("2026-10-29", "2026-11-03", { weeklyOffs: [0], holidays: new Set() }),
    ).toEqual({ "2026-10": 3, "2026-11": 2 });
  });
  it("balance and overlap and carry forward", () => {
    expect(checkBalance(12, 10, 2)).toEqual({ ok: true, remaining: 0 });
    expect(checkBalance(12, 10, 2.5).ok).toBe(false);
    expect(checkBalance(12, 0, 0).ok).toBe(false);
    expect(overlaps("2026-11-01", "2026-11-05", "2026-11-05", "2026-11-09")).toBe(true);
    expect(overlaps("2026-11-01", "2026-11-04", "2026-11-05", "2026-11-09")).toBe(false);
    expect(carryForward(9, 5)).toBe(5);
    expect(carryForward(3, 5)).toBe(3);
  });
});

describe("HRA exemption", () => {
  it("takes the least of the three limits", () => {
    // basic 6L, HRA 2.4L, rent 3L: rent-10% basic = 2.4L, 50% basic = 3L => 2.4L
    expect(
      hraExemption({
        basicAnnual: R(600000),
        hraAnnual: R(240000),
        rentAnnual: R(300000),
        metro: true,
      }),
    ).toBe(R(240000));
    // rent 1.2L: 1.2L - 60k = 60k is the least
    expect(
      hraExemption({
        basicAnnual: R(600000),
        hraAnnual: R(240000),
        rentAnnual: R(120000),
        metro: false,
      }),
    ).toBe(R(60000));
    // non-metro cap 40% of basic = 2.4L; HRA 3L; rent 5L => 2.4L
    expect(
      hraExemption({
        basicAnnual: R(600000),
        hraAnnual: R(300000),
        rentAnnual: R(500000),
        metro: false,
      }),
    ).toBe(R(240000));
  });
  it("is zero with no rent or when rent is below 10% of basic", () => {
    expect(
      hraExemption({ basicAnnual: R(600000), hraAnnual: R(240000), rentAnnual: 0, metro: true }),
    ).toBe(0);
    expect(
      hraExemption({
        basicAnnual: R(600000),
        hraAnnual: R(240000),
        rentAnnual: R(50000),
        metro: true,
      }),
    ).toBe(0);
  });
});

describe("compliance calendar", () => {
  it("due dates", () => {
    expect(dueDate("PF", "2026-10")).toBe("2026-11-15");
    expect(dueDate("ESI", "2026-12")).toBe("2027-01-15");
    expect(dueDate("TDS", "2026-10")).toBe("2026-11-07");
    expect(dueDate("TDS", "2027-03")).toBe("2027-04-30");
    expect(dueDate("TDS_RETURN", "2026-09")).toBe("2026-10-31");
    expect(dueDate("TDS_RETURN", "2026-12")).toBe("2027-01-31");
    expect(dueDate("TDS_RETURN", "2027-03")).toBe("2027-05-31");
    expect(() => dueDate("TDS_RETURN", "2026-10")).toThrow();
  });
  it("plans a calendar with quarterly returns", () => {
    const plan = planCalendar("2026-10", 3); // Oct, Nov, Dec
    expect(plan.filter((p) => p.kind === "PF")).toHaveLength(3);
    expect(plan.filter((p) => p.kind === "TDS_RETURN").map((p) => p.period)).toEqual(["2026-12"]);
  });
  it("states", () => {
    expect(dueState({ status: "filed", dueDate: "2026-01-01" }, "2026-11-01")).toBe("filed");
    expect(dueState({ status: "pending", dueDate: "2026-10-31" }, "2026-11-01")).toBe("overdue");
    expect(dueState({ status: "pending", dueDate: "2026-11-05" }, "2026-11-01")).toBe("due_soon");
    expect(dueState({ status: "pending", dueDate: "2026-12-05" }, "2026-11-01")).toBe("upcoming");
  });
});

describe("report aggregation", () => {
  const runs = [
    { month: "2026-10", gross: 1, net: 1, employerCost: 1100, employees: 3 },
    { month: "2025-10", gross: 1, net: 1, employerCost: 1000, employees: 3 },
  ];
  it("trend and year over year", () => {
    expect(costTrend(runs).map((r) => r.month)).toEqual(["2025-10", "2026-10"]);
    const y = yearOverYear(runs);
    expect(y[0].changePct).toBeNull();
    expect(y[1]).toMatchObject({ previous: 1000, changePct: 10 });
  });
  it("department share and overtime", () => {
    const items = [
      {
        month: "2026-10",
        department: "Eng",
        gross: 0,
        employerCost: 300,
        overtimeAmount: 10,
        overtimeMinutes: 60,
      },
      {
        month: "2026-10",
        department: "Sales",
        gross: 0,
        employerCost: 100,
        overtimeAmount: 5,
        overtimeMinutes: 30,
      },
    ];
    expect(departmentCost(items)[0]).toEqual({ department: "Eng", cost: 300, share: 0.75 });
    expect(overtimeByMonth(items)).toEqual([{ month: "2026-10", minutes: 90, amount: 15 }]);
  });
  it("headcount and attrition", () => {
    const people = [
      { joinDate: "2025-01-01", exitDate: null },
      { joinDate: "2025-01-01", exitDate: "2026-02-10" },
      { joinDate: "2026-02-15", exitDate: null },
    ];
    const s = headcountSeries(people, ["2026-01", "2026-02", "2026-03"]);
    expect(s.map((x) => x.headcount)).toEqual([2, 2, 2]);
    expect(s[1]).toMatchObject({ joined: 1, exited: 1 });
    expect(attritionRate(s)).toBe(200); // 1 exit / avg 2 heads, annualised over 3 months
    expect(attritionRate([])).toBe(0);
  });
  it("last months", () => {
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

import { compareRegimes, NO_DECLARATIONS } from "@/lib/payroll/tax";
describe("regime comparison", () => {
  it("new regime wins with no deductions", () => {
    const c = compareRegimes(R(1200000), R(21600), R(2400), NO_DECLARATIONS);
    expect(c.better).toBe("new");
    expect(c.newTax).toBe(0); // 12L less 75k = 11.25L, within the rebate
  });
  it("old regime wins with heavy deductions", () => {
    const c = compareRegimes(R(1800000), R(21600), R(2400), {
      section80C: R(150000),
      section80D: R(50000),
      hraExemption: R(240000),
      otherDeductions: R(500000),
    });
    expect(c.better).toBe("old");
    expect(c.saving).toBeGreaterThan(0);
    expect(c.oldTax).toBeLessThan(c.newTax);
  });
});

import {
  esiReport,
  expectedDues,
  form16Summary,
  pfReport,
  ptReport,
  tdsReport,
  type ReportItem,
} from "@/lib/compliance/reports";
describe("compliance reports", () => {
  const item = (o: Partial<ReportItem> = {}): ReportItem => ({
    employeeId: "e1",
    name: "Asha",
    code: "E1",
    uan: "100200300400",
    esiNumber: null,
    pan: "ABCDE1234F",
    state: "Karnataka",
    paidDays: 30,
    lopDays: 0,
    gross: R(100000),
    pfWages: R(25000),
    esiWages: 0,
    taxable: R(100000),
    deductions: [
      { code: "PF", amount: R(3000) },
      { code: "PT", amount: R(200) },
      { code: "TDS", amount: R(5000) },
    ],
    employer: [
      { code: "ER_EPF", amount: R(917.5) },
      { code: "ER_EPS", amount: R(2082.5) },
      { code: "ER_EDLI", amount: R(125) },
      { code: "ER_ADMIN", amount: R(125) },
    ],
    ...o,
  });
  it("PF file lists contributions and flags a missing UAN", () => {
    const r = pfReport([item(), item({ name: "Ravi", uan: null })]);
    expect(r.csv.split("\r\n")[1]).toContain("100200300400,Asha,100000.00,25000.00");
    expect(r.missing).toEqual(["Ravi"]);
  });
  it("ESI file only includes people with ESI", () => {
    const e = item({
      deductions: [{ code: "ESI", amount: R(135) }],
      employer: [{ code: "ER_ESI", amount: R(585) }],
      esiWages: R(18000),
      esiNumber: "1234567890",
    });
    expect(esiReport([item(), e]).csv.trim().split("\r\n")).toHaveLength(2);
    expect(esiReport([item(), e]).missing).toEqual([]);
  });
  it("PT groups by state and TDS flags missing PAN", () => {
    expect(ptReport([item(), item({ state: null })]).csv).toContain("Karnataka,1,200.00");
    expect(ptReport([item(), item({ state: null })]).csv).toContain("Unknown state,1,200.00");
    expect(tdsReport([item({ pan: null })]).csv).toContain("PANNOTAVBL");
    expect(tdsReport([item({ pan: null })]).missing).toEqual(["Asha"]);
  });
  it("expected dues add employee and employer shares", () => {
    expect(expectedDues([item()])).toEqual({ PF: R(6250), ESI: 0, PT: R(200), TDS: R(5000) });
  });
  it("csv neutralises formula injection", () => {
    expect(pfReport([item({ name: "=cmd()" })]).csv).toContain("'=cmd()");
  });
  it("Form 16 summary, new regime", () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `m${i}`,
      gross: R(100000),
      taxable: R(100000),
      pf: R(3000),
      pt: R(200),
      tds: R(0),
    }));
    const f = form16Summary(months, "new", {
      section80C: 0,
      section80D: 0,
      hraExemption: 0,
      otherDeductions: 0,
    });
    expect(f.taxableIncome).toBe(R(1200000 - 75000));
    expect(f.taxOnIncome).toBe(0); // within the rebate
    expect(f.balance).toBe(0);
  });
  it("Form 16 summary, old regime uses declarations and PT", () => {
    const months = Array.from({ length: 12 }, () => ({
      month: "m",
      gross: R(100000),
      taxable: R(100000),
      pf: R(3000),
      pt: R(200),
      tds: R(1000),
    }));
    const f = form16Summary(months, "old", {
      section80C: R(100000),
      section80D: R(25000),
      hraExemption: R(120000),
      otherDeductions: 0,
    });
    // 80C: min(1.5L, 1L + 36k PF) = 1.36L, plus 25k 80D, plus 1.2L HRA
    expect(f.chapterVI).toBe(R(136000 + 25000 + 120000));
    expect(f.professionalTax).toBe(R(2400));
    expect(f.tdsDeducted).toBe(R(12000));
    expect(f.balance).toBe(f.taxOnIncome - R(12000));
  });
});
