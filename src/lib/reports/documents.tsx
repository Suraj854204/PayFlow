import ExcelJS from "exceljs";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { monthLabel } from "@/lib/payroll/period";
import { rs } from "@/lib/payslip/document";
import type { ReportData } from "./load";

export async function buildWorkbook(r: ReportData, orgName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = orgName;
  const money = (ws: ExcelJS.Worksheet, cols: number[]) =>
    cols.forEach((c) => (ws.getColumn(c).numFmt = "#,##0.00"));
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.columns.forEach((c) => (c.width = Math.max(14, c.width ?? 14)));
  };
  const inr = (p: number) => p / 100;

  const t = wb.addWorksheet("Cost trend");
  t.columns = [
    { header: "Month", key: "m" },
    { header: "Employees", key: "n" },
    { header: "Gross (INR)", key: "g" },
    { header: "Net pay (INR)", key: "net" },
    { header: "Employer cost (INR)", key: "c" },
  ];
  r.trend.forEach((x) =>
    t.addRow({
      m: x.month,
      n: x.employees,
      g: inr(x.gross),
      net: inr(x.net),
      c: inr(x.employerCost),
    }),
  );
  money(t, [3, 4, 5]);
  head(t);

  const d = wb.addWorksheet("Department cost");
  d.columns = [
    { header: "Department", key: "d" },
    { header: "Employer cost (INR)", key: "c" },
    { header: "Share", key: "s" },
  ];
  r.departments.forEach((x) => d.addRow({ d: x.department, c: inr(x.cost), s: x.share }));
  money(d, [2]);
  d.getColumn(3).numFmt = "0.0%";
  head(d);

  const h = wb.addWorksheet("Headcount");
  h.columns = [
    { header: "Month", key: "m" },
    { header: "Headcount", key: "h" },
    { header: "Joined", key: "j" },
    { header: "Left", key: "l" },
  ];
  r.headcount.forEach((x) => h.addRow({ m: x.month, h: x.headcount, j: x.joined, l: x.exited }));
  h.addRow({});
  h.addRow({ m: "Attrition (annualised %)", h: r.attrition });
  head(h);

  const o = wb.addWorksheet("Overtime");
  o.columns = [
    { header: "Month", key: "m" },
    { header: "Hours", key: "h" },
    { header: "Paid (INR)", key: "a" },
  ];
  r.overtime.forEach((x) => o.addRow({ m: x.month, h: x.minutes / 60, a: inr(x.amount) }));
  money(o, [3]);
  o.getColumn(2).numFmt = "0.0";
  head(o);

  const y = wb.addWorksheet("Year over year");
  y.columns = [
    { header: "Month", key: "m" },
    { header: "This year (INR)", key: "c" },
    { header: "Last year (INR)", key: "p" },
    { header: "Change %", key: "x" },
  ];
  r.yoy.forEach((x) =>
    y.addRow({
      m: x.month,
      c: inr(x.current),
      p: x.previous === null ? null : inr(x.previous),
      x: x.changePct,
    }),
  );
  money(y, [2, 3]);
  head(y);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 4 },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderColor: "#eee" },
  c: { flex: 1 },
  r: { flex: 1, textAlign: "right" },
  muted: { color: "#666", marginTop: 2 },
});

export function ReportsPdf({ r, orgName }: { r: ReportData; orgName: string }) {
  return (
    <Document title="Payroll reports" author={orgName}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{orgName}: payroll reports</Text>
        <Text style={s.muted}>
          12 months to {monthLabel(r.endMonth)} · attrition {r.attrition}% (annualised)
        </Text>

        <Text style={s.h2}>Payroll cost trend</Text>
        <View style={[s.row, { fontFamily: "Helvetica-Bold" }]}>
          <Text style={s.c}>Month</Text>
          <Text style={s.r}>Employees</Text>
          <Text style={s.r}>Net pay</Text>
          <Text style={s.r}>Employer cost</Text>
        </View>
        {r.trend.map((t) => (
          <View key={t.month} style={s.row}>
            <Text style={s.c}>{t.month}</Text>
            <Text style={s.r}>{t.employees}</Text>
            <Text style={s.r}>{rs(t.net)}</Text>
            <Text style={s.r}>{rs(t.employerCost)}</Text>
          </View>
        ))}

        <Text style={s.h2}>Department cost (latest month)</Text>
        {r.departments.map((d) => (
          <View key={d.department} style={s.row}>
            <Text style={s.c}>{d.department}</Text>
            <Text style={s.r}>{rs(d.cost)}</Text>
            <Text style={s.r}>{Math.round(d.share * 100)}%</Text>
          </View>
        ))}

        <Text style={s.h2}>Headcount</Text>
        {r.headcount.map((h) => (
          <View key={h.month} style={s.row}>
            <Text style={s.c}>{h.month}</Text>
            <Text style={s.r}>{h.headcount}</Text>
            <Text style={s.r}>+{h.joined}</Text>
            <Text style={s.r}>-{h.exited}</Text>
          </View>
        ))}

        <Text style={s.h2}>Overtime</Text>
        {r.overtime.map((o) => (
          <View key={o.month} style={s.row}>
            <Text style={s.c}>{o.month}</Text>
            <Text style={s.r}>{(o.minutes / 60).toFixed(1)} h</Text>
            <Text style={s.r}>{rs(o.amount)}</Text>
          </View>
        ))}

        <Text style={s.h2}>Year over year (employer cost)</Text>
        {r.yoy.map((y) => (
          <View key={y.month} style={s.row}>
            <Text style={s.c}>{y.month}</Text>
            <Text style={s.r}>{rs(y.current)}</Text>
            <Text style={s.r}>{y.previous === null ? "-" : rs(y.previous)}</Text>
            <Text style={s.r}>{y.changePct === null ? "-" : `${y.changePct}%`}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}
