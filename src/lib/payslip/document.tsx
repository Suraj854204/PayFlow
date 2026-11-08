import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { PayLineJson } from "@/lib/db/schema";

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Built-in PDF fonts have no rupee glyph, so amounts are printed as "Rs.". */
export const rs = (paise: number) => `Rs. ${inr.format(paise / 100)}`;

export interface PayslipData {
  number: string;
  monthLabel: string;
  org: { name: string; brandColor: string };
  employee: {
    name: string;
    code: string;
    designation?: string | null;
    department?: string | null;
    joinDate: string;
    panMasked?: string | null;
    bankMasked?: string | null;
    uan?: string | null;
  };
  paidDays: string;
  daysInMonth: number;
  lopDays: string;
  earnings: PayLineJson[];
  deductions: PayLineJson[];
  gross: number;
  totalDeductions: number;
  net: number;
}

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 2,
  },
  org: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  muted: { color: "#666" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 14 },
  cell: { width: "33%", marginBottom: 8 },
  label: { color: "#666", fontSize: 8 },
  cols: { flexDirection: "row", marginTop: 12, gap: 16 },
  col: { flex: 1, borderWidth: 1, borderColor: "#ddd" },
  colHead: { padding: 6, fontFamily: "Helvetica-Bold", backgroundColor: "#f3f3f3" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderColor: "#eee",
  },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 6,
    fontFamily: "Helvetica-Bold",
    borderTopWidth: 1,
    borderColor: "#ccc",
  },
  net: {
    marginTop: 14,
    padding: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#f3f3f3",
  },
  foot: {
    position: "absolute",
    bottom: 28,
    left: 36,
    right: 36,
    fontSize: 8,
    color: "#888",
    textAlign: "center",
  },
});

export function PayslipDocument({ d }: { d: PayslipData }) {
  const field = (label: string, value?: string | null) => (
    <View style={s.cell}>
      <Text style={s.label}>{label}</Text>
      <Text>{value || "-"}</Text>
    </View>
  );
  const list = (title: string, lines: PayLineJson[], total: number, totalLabel: string) => (
    <View style={s.col}>
      <Text style={s.colHead}>{title}</Text>
      {lines.map((l) => (
        <View key={l.code} style={s.row}>
          <Text>{l.name}</Text>
          <Text>{rs(l.amount)}</Text>
        </View>
      ))}
      <View style={s.total}>
        <Text>{totalLabel}</Text>
        <Text>{rs(total)}</Text>
      </View>
    </View>
  );
  return (
    <Document title={`Payslip ${d.number}`} author={d.org.name}>
      <Page size="A4" style={s.page}>
        <View style={[s.header, { borderBottomColor: d.org.brandColor }]}>
          <View>
            <Text style={s.org}>{d.org.name}</Text>
            <Text style={s.muted}>Payslip for {d.monthLabel}</Text>
          </View>
          <View>
            <Text style={s.muted}>Payslip no.</Text>
            <Text>{d.number}</Text>
          </View>
        </View>
        <View style={s.grid}>
          {field("Employee", d.employee.name)}
          {field("Employee code", d.employee.code)}
          {field("Date of joining", d.employee.joinDate)}
          {field("Designation", d.employee.designation)}
          {field("Department", d.employee.department)}
          {field("PAN", d.employee.panMasked)}
          {field("UAN", d.employee.uan)}
          {field("Bank account", d.employee.bankMasked)}
          {field("Paid days", `${d.paidDays} of ${d.daysInMonth} (LOP ${d.lopDays})`)}
        </View>
        <View style={s.cols}>
          {list("Earnings", d.earnings, d.gross, "Gross earnings")}
          {list("Deductions", d.deductions, d.totalDeductions, "Total deductions")}
        </View>
        <View style={s.net}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Net pay</Text>
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 12 }}>{rs(d.net)}</Text>
        </View>
        <Text style={s.foot}>
          This is a computer-generated payslip and does not require a signature.
        </Text>
      </Page>
    </Document>
  );
}
