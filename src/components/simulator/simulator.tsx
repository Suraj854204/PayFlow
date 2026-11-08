"use client";

import { convertPaise, CURRENCIES, formatForeign, type Currency } from "@/lib/enterprise/fx";
import { useMemo, useState } from "react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { AreaChart } from "@/components/charts/area-chart";
import { CompareBars } from "@/components/charts/compare-bars";
import { formatINR, formatINRCompact } from "@/lib/money";
import { compareCtc } from "@/lib/simulator/simulate";
import type { SalaryLineInput } from "@/lib/salary";

const toPaise = (rupees: string) => Math.round((Number(rupees.replace(/,/g, "")) || 0) * 100);

export interface SimulatorProps {
  initialCtc: number;
  month: string;
  workState: string | null;
  gender: "male" | "female" | "other" | null;
  components: SalaryLineInput[];
  /** Company-entered rates (units of foreign currency per 1 INR). Display only. */
  fx?: { currency: string; perInr: number }[];
}

export function Simulator({
  initialCtc,
  month,
  workState,
  gender,
  components,
  fx = [],
}: SimulatorProps) {
  const [current, setCurrent] = useState(String(Math.round(initialCtc / 100) || 1200000));
  const [proposed, setProposed] = useState(
    String(Math.round((initialCtc * 1.15) / 100) || 1400000),
  );
  const [c80, setC80] = useState("150000");
  const [d80, setD80] = useState("0");
  const [hra, setHra] = useState("0");
  const [other, setOther] = useState("0");

  const result = useMemo(
    () =>
      compareCtc(
        {
          ctcAnnual: toPaise(current),
          month,
          workState,
          gender,
          components,
          declarations: {
            section80C: toPaise(c80),
            section80D: toPaise(d80),
            hraExemption: toPaise(hra),
            otherDeductions: toPaise(other),
          },
        },
        toPaise(proposed),
      ),
    [current, proposed, c80, d80, hra, other, month, workState, gender, components],
  );

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint?: string,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => set(e.target.value.replace(/[^\d,]/g, ""))}
      />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Try a change</CardTitle>
          <CardDescription>
            Amounts are yearly, in rupees. Nothing here is saved or shared.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("sim-current", "Current yearly CTC", current, setCurrent)}
          {field("sim-proposed", "New yearly CTC", proposed, setProposed)}
          <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-4">
            <legend className="text-muted-foreground mb-2 text-xs font-medium">
              Deductions you would claim under the old regime (yearly)
            </legend>
            {field("sim-80c", "Section 80C", c80, setC80, "Capped at ₹1.5 lakh with PF")}
            {field("sim-80d", "Health insurance (80D)", d80, setD80)}
            {field("sim-hra", "HRA exemption", hra, setHra)}
            {field("sim-other", "Other", other, setOther)}
          </fieldset>
        </CardContent>
      </Card>

      {!result.ok ? (
        <p role="alert" className="text-destructive text-sm">
          {result.errors[0]}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3" aria-live="polite">
            <Stat
              label="Monthly take-home now"
              value={result.current[result.current.better].monthlyTakeHome}
              note={`${result.current.better} regime`}
            />
            <Stat
              label="Monthly take-home after"
              value={result.proposed[result.proposed.better].monthlyTakeHome}
              note={`${result.proposed.better} regime`}
              highlight
            />
            <Stat
              label="Change per month"
              value={
                result.proposed[result.proposed.better].monthlyTakeHome -
                result.current[result.current.better].monthlyTakeHome
              }
              note={
                result.marginalKeepBp === null
                  ? "No change in CTC"
                  : `You keep about ${(result.marginalKeepBp / 100).toFixed(0)}% of each extra rupee (new regime)`
              }
              signed
            />
          </div>
          {fx.length > 0 && (
            <p className="text-muted-foreground text-xs" data-testid="fx-note">
              Indicative only, using your company&apos;s own rates (payroll is paid in INR):{" "}
              {fx
                .map((r) => {
                  const isCurrency = (CURRENCIES as readonly string[]).includes(r.currency);
                  if (!isCurrency) return null;
                  return `${formatForeign(
                    convertPaise(result.proposed[result.proposed.better].monthlyTakeHome, r.perInr),
                    r.currency as Currency,
                  )} ${r.currency}/month`;
                })
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Old vs new tax regime</CardTitle>
              <CardDescription>
                At the new CTC, the <Badge tone="success">{result.proposed.better} regime</Badge>{" "}
                leaves you <strong>{formatINR(result.proposed.annualAdvantage)}</strong> better off
                over the year.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompareBars
                ariaLabel="Yearly tax and take-home under each regime at the new CTC"
                format="inrCompact"
                rows={[
                  {
                    label: "Income tax for the year",
                    values: [
                      {
                        name: "New regime",
                        value: result.proposed.new.annualTax,
                        tone: result.proposed.better === "new" ? "success" : "muted",
                      },
                      {
                        name: "Old regime",
                        value: result.proposed.old.annualTax,
                        tone: result.proposed.better === "old" ? "success" : "muted",
                      },
                    ],
                  },
                  {
                    label: "Take-home for the year",
                    values: [
                      {
                        name: "New regime",
                        value: result.proposed.new.annualTakeHome,
                        tone: result.proposed.better === "new" ? "success" : "muted",
                      },
                      {
                        name: "Old regime",
                        value: result.proposed.old.annualTakeHome,
                        tone: result.proposed.better === "old" ? "success" : "muted",
                      },
                    ],
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Month by month at the new CTC ({result.proposed.better} regime)</CardTitle>
              <CardDescription>
                Tax is spread over the year, so take-home shifts as the year goes on.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AreaChart
                ariaLabel="Monthly take-home across the financial year"
                format="inrCompact"
                data={result.proposed[result.proposed.better].monthly.map((m) => ({
                  label: m.month.slice(2),
                  value: m.net,
                }))}
              />
            </CardContent>
          </Card>
          <p className="text-muted-foreground text-xs">
            This runs PayFlow&apos;s real payroll engine with your company&apos;s salary structure,
            PF, professional tax and TDS rules for one full financial year. It is an estimate: your
            actual payslip also depends on attendance, loans and declarations you submit.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  highlight,
  signed,
}: {
  label: string;
  value: number;
  note: string;
  highlight?: boolean;
  signed?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40" : undefined}>
      <CardContent className="space-y-1 p-5">
        <p className="text-muted-foreground text-xs font-medium">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">
          <AnimatedNumber
            value={value}
            format={(n) => `${signed && n > 0 ? "+" : ""}${formatINRCompact(Math.round(n))}`}
          />
        </p>
        <p className="text-muted-foreground text-xs capitalize">{note}</p>
      </CardContent>
    </Card>
  );
}
