import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { rs } from "@/lib/payslip/document";
import type { Form16Month, Form16Summary } from "./reports";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: "Helvetica", color: "#1a1a1a" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  muted: { color: "#666", marginTop: 2 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  bold: { fontFamily: "Helvetica-Bold" },
  cell: { flex: 1, textAlign: "right" },
  note: { marginTop: 16, fontSize: 8, color: "#888" },
});

export interface Form16Data {
  org: { name: string; tan: string | null };
  employee: { name: string; code: string; panMasked: string | null };
  fyLabel: string;
  months: Form16Month[];
  summary: Form16Summary;
}

export function Form16Document({ d }: { d: Form16Data }) {
  const f = d.summary;
  const line = (label: string, value: number, bold = false) => (
    <View style={s.row}>
      <Text style={bold ? s.bold : undefined}>{label}</Text>
      <Text style={bold ? s.bold : undefined}>{rs(value)}</Text>
    </View>
  );
  return (
    <Document title={`Annual tax summary ${d.fyLabel}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Annual tax summary (Form 16 style) FY {d.fyLabel}</Text>
        <Text style={s.muted}>
          {d.org.name}
          {d.org.tan ? ` · TAN ${d.org.tan}` : ""}
        </Text>
        <Text style={s.muted}>
          {d.employee.name} ({d.employee.code})
          {d.employee.panMasked ? ` · PAN ${d.employee.panMasked}` : ""} ·{" "}
          {f.regime === "new" ? "New" : "Old"} regime
        </Text>

        <View style={{ marginTop: 14 }}>
          {line("Gross salary", f.grossSalary)}
          {line("Taxable salary", f.taxableSalary)}
          {line("Less: standard deduction", f.standardDeduction)}
          {f.regime === "old" && line("Less: professional tax", f.professionalTax)}
          {f.regime === "old" &&
            line("Less: HRA exemption and Chapter VI-A deductions", f.chapterVI)}
          {line("Taxable income", f.taxableIncome, true)}
          {line("Tax on income including cess", f.taxOnIncome, true)}
          {line("Tax deducted at source (TDS)", f.tdsDeducted)}
          {line(
            f.balance >= 0 ? "Balance tax payable" : "Excess tax deducted",
            Math.abs(f.balance),
            true,
          )}
        </View>

        <Text style={[s.bold, { marginTop: 16, marginBottom: 4 }]}>Month by month</Text>
        <View style={[s.row, s.bold]}>
          <Text style={{ flex: 1 }}>Month</Text>
          <Text style={s.cell}>Gross</Text>
          <Text style={s.cell}>Taxable</Text>
          <Text style={s.cell}>TDS</Text>
        </View>
        {d.months.map((m) => (
          <View key={m.month} style={s.row}>
            <Text style={{ flex: 1 }}>{m.month}</Text>
            <Text style={s.cell}>{rs(m.gross)}</Text>
            <Text style={s.cell}>{rs(m.taxable)}</Text>
            <Text style={s.cell}>{rs(m.tds)}</Text>
          </View>
        ))}
        <Text style={s.note}>
          This is a summary computed from payroll records. It is not the digitally signed Form 16
          certificate that is generated from TRACES after TDS returns are filed.
        </Text>
      </Page>
    </Document>
  );
}
