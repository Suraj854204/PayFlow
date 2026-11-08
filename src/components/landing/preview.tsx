"use client";

import { useState } from "react";
import { AreaChart } from "@/components/charts/area-chart";
import { Donut } from "@/components/charts/donut";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR, formatINRCompact } from "@/lib/money";
import { cn } from "@/lib/utils";

// Sample figures in paise. They illustrate the real dashboard components; no customer data.
const COST = [
  ["Jun", 41_80_000_00],
  ["Jul", 42_10_000_00],
  ["Aug", 43_60_000_00],
  ["Sep", 43_20_000_00],
  ["Oct", 45_90_000_00],
  ["Nov", 46_40_000_00],
] as const;
const DEPTS = [
  { label: "Engineering", value: 24_20_000_00 },
  { label: "Sales", value: 9_80_000_00 },
  { label: "Operations", value: 6_90_000_00 },
  { label: "Finance & HR", value: 5_50_000_00 },
];
const PAY = [
  ["Jun", 98_400_00],
  ["Jul", 98_400_00],
  ["Aug", 1_04_900_00],
  ["Sep", 98_400_00],
  ["Oct", 1_02_300_00],
  ["Nov", 98_400_00],
] as const;

export function Preview() {
  const [tab, setTab] = useState<"company" | "employee">("company");
  return (
    <div className="bg-card/60 rounded-2xl border p-3 shadow-xl backdrop-blur sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Preview" className="bg-muted inline-flex rounded-xl p-1">
          {(["company", "employee"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                tab === t ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "company" ? "HR & Finance" : "Employee"}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-xs">Sample data</span>
      </div>

      {tab === "company" ? (
        <div className="space-y-4" role="tabpanel">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Total payroll cost"
              kind="inr"
              icon="banknote"
              value={COST[5][1]}
              hint="Nov 2026 · 118 paid"
              spark={COST.map((c) => c[1])}
            />
            <KpiCard
              label="Active headcount"
              kind="count"
              icon="users"
              value={118}
              hint="Employees on payroll"
            />
            <KpiCard
              label="Pending approvals"
              kind="count"
              icon="clipboard"
              value={7}
              hint="1 payroll · 4 leave · 2 expense"
            />
            <KpiCard
              label="Tax (TDS) deducted"
              kind="inr"
              icon="landmark"
              value={5_82_000_00}
              hint="Challan 281 due on the 7th"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Payroll cost trend</CardTitle>
              </CardHeader>
              <CardContent>
                <AreaChart
                  data={COST.map(([label, value]) => ({ label, value }))}
                  format={formatINRCompact}
                  ariaLabel="Sample payroll cost by month"
                  height={170}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By department</CardTitle>
              </CardHeader>
              <CardContent>
                <Donut
                  slices={DEPTS}
                  format={formatINRCompact}
                  ariaLabel="Sample cost share by department"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="space-y-4" role="tabpanel">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label="Latest net pay"
              kind="inr"
              icon="wallet"
              value={PAY[5][1]}
              hint="Nov 2026"
              spark={PAY.map((p) => p[1])}
            />
            <KpiCard
              label="Casual leave left"
              kind="count"
              icon="plane"
              value={9}
              hint="of 12 this year"
            />
            <KpiCard
              label="Tax deducted this year"
              kind="inr"
              icon="landmark"
              value={6_14_000_00}
              hint="New regime"
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Take-home history</CardTitle>
              <CardDescription>Every payslip is a download away.</CardDescription>
            </CardHeader>
            <CardContent>
              <AreaChart
                data={PAY.map(([label, value]) => ({ label, value }))}
                format={formatINR}
                ariaLabel="Sample net pay by month"
                height={170}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
