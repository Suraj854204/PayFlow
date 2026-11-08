import { eq, or } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/db";
import {
  attendanceRecords,
  employeeSalaries,
  employees,
  ewaRequests,
  expenseClaims,
  leaveBalances,
  leaveRequests,
  loans,
  payrollItems,
  payslips,
  recognitions,
  taxDeclarations,
} from "@/lib/db/schema";
import { decrypt, maskValue } from "@/lib/crypto";

type ByEmployee = PgTable & { employeeId: PgColumn };

const SECTIONS: [string, ByEmployee][] = [
  ["salaryHistory", employeeSalaries as unknown as ByEmployee],
  ["payrollItems", payrollItems as unknown as ByEmployee],
  ["payslips", payslips as unknown as ByEmployee],
  ["loansAndAdvances", loans as unknown as ByEmployee],
  ["attendance", attendanceRecords as unknown as ByEmployee],
  ["leaveBalances", leaveBalances as unknown as ByEmployee],
  ["leaveRequests", leaveRequests as unknown as ByEmployee],
  ["taxDeclarations", taxDeclarations as unknown as ByEmployee],
  ["earnedWageRequests", ewaRequests as unknown as ByEmployee],
];

const safeDecrypt = (v: string | null) => {
  if (!v) return null;
  try {
    return maskValue(decrypt(v));
  } catch {
    return null;
  }
};

/**
 * Everything held about one person in one company, as plain JSON. Government ids and the bank account
 * are masked to the last four characters so a downloaded file is not a ready-made identity kit.
 * Receipt images and uploaded documents are listed by name, not embedded.
 */
export async function buildPersonalExport(
  tx: Tx,
  input: { organizationId: string; userId: string; employeeId: string | null; email: string },
) {
  const out: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    scope: "Data held about you by this company in PayFlow",
    account: { email: input.email },
  };
  if (!input.employeeId) return out;

  const [e] = await tx.select().from(employees).where(eq(employees.id, input.employeeId));
  if (!e) return out;
  const {
    panEnc,
    aadhaarEnc,
    bankAccountEnc,
    panIndex: _panIndex,
    organizationId: _o,
    ...profile
  } = e;
  void _panIndex;
  void _o;
  out.profile = {
    ...profile,
    pan: safeDecrypt(panEnc),
    aadhaar: safeDecrypt(aadhaarEnc),
    bankAccount: safeDecrypt(bankAccountEnc),
  };
  for (const [label, table] of SECTIONS) {
    out[label] = await tx.select().from(table).where(eq(table.employeeId, input.employeeId));
  }
  out.expenseClaims = (
    await tx.select().from(expenseClaims).where(eq(expenseClaims.employeeId, input.employeeId))
  ).map(({ receiptData: _r, ...c }) => {
    void _r;
    return c;
  });
  out.recognition = await tx
    .select()
    .from(recognitions)
    .where(
      or(
        eq(recognitions.fromEmployeeId, input.employeeId),
        eq(recognitions.toEmployeeId, input.employeeId),
      ),
    );
  return out;
}
