import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  checklistItems,
  departments,
  designations,
  employeeDocuments,
  employeeSalaries,
  employees,
  holidays,
  salaryComponents,
  salaryStructures,
} from "@/lib/db/schema";
import { decrypt, maskValue } from "@/lib/crypto";

export const PAGE_SIZE = 20;

export interface EmployeeFilters {
  q?: string;
  status?: "active" | "probation" | "notice" | "exited";
  departmentId?: string;
  probationEnding?: boolean;
  page?: number;
}

/** List view: never selects encrypted columns. */
export async function listEmployees(tx: Tx, orgId: string, f: EmployeeFilters) {
  const conds: SQL[] = [eq(employees.organizationId, orgId), isNull(employees.deletedAt)];
  if (f.status) conds.push(eq(employees.status, f.status));
  if (f.departmentId) conds.push(eq(employees.departmentId, f.departmentId));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    const c = or(
      ilike(employees.firstName, like),
      ilike(employees.lastName, like),
      ilike(employees.email, like),
      ilike(employees.employeeCode, like),
    );
    if (c) conds.push(c);
  }
  if (f.probationEnding) {
    conds.push(eq(employees.status, "probation"));
    conds.push(sql`${employees.probationEndDate} <= (current_date + interval '30 days')`);
  }
  const where = and(...conds);
  const page = Math.max(1, f.page ?? 1);

  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        email: employees.email,
        status: employees.status,
        joinDate: employees.joinDate,
        probationEndDate: employees.probationEndDate,
        department: departments.name,
        designation: designations.title,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(where)
      .orderBy(asc(employees.employeeCode))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    tx
      .select({ total: sql<number>`count(*)::int` })
      .from(employees)
      .where(where),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getReferenceData(tx: Tx, orgId: string) {
  const [depts, desigs, hols] = await Promise.all([
    tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.organizationId, orgId), isNull(departments.deletedAt)))
      .orderBy(asc(departments.name)),
    tx
      .select({ id: designations.id, title: designations.title })
      .from(designations)
      .where(and(eq(designations.organizationId, orgId), isNull(designations.deletedAt)))
      .orderBy(asc(designations.title)),
    tx
      .select({ id: holidays.id, name: holidays.name, date: holidays.date })
      .from(holidays)
      .where(and(eq(holidays.organizationId, orgId), isNull(holidays.deletedAt)))
      .orderBy(asc(holidays.date)),
  ]);
  return { departments: depts, designations: desigs, holidays: hols };
}

function safeMask(enc: string | null, visible: number): string | null {
  if (!enc) return null;
  try {
    return maskValue(decrypt(enc), visible);
  } catch {
    return "unreadable";
  }
}

/** Detail view: sensitive values are masked server-side; plaintext only via the audited reveal action. */
export async function getEmployeeDetail(tx: Tx, orgId: string, id: string) {
  const [e] = await tx
    .select()
    .from(employees)
    .where(
      and(eq(employees.id, id), eq(employees.organizationId, orgId), isNull(employees.deletedAt)),
    );
  if (!e) return null;
  const { panEnc, aadhaarEnc, bankAccountEnc, panIndex: _i, ...safe } = e;
  void _i;
  return {
    ...safe,
    panMasked: safeMask(panEnc, 4),
    aadhaarMasked: safeMask(aadhaarEnc, 4),
    bankAccountMasked: safeMask(bankAccountEnc, 4),
  };
}

export async function getEmployeeExtras(tx: Tx, orgId: string, id: string, withSalary: boolean) {
  const [docs, checklist, salaries] = await Promise.all([
    tx
      .select({
        id: employeeDocuments.id,
        type: employeeDocuments.type,
        fileName: employeeDocuments.fileName,
        sizeBytes: employeeDocuments.sizeBytes,
        createdAt: employeeDocuments.createdAt,
      })
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.employeeId, id),
          eq(employeeDocuments.organizationId, orgId),
          isNull(employeeDocuments.deletedAt),
        ),
      )
      .orderBy(desc(employeeDocuments.createdAt)),
    tx
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.employeeId, id), eq(checklistItems.organizationId, orgId)))
      .orderBy(asc(checklistItems.kind), asc(checklistItems.position)),
    withSalary
      ? tx
          .select()
          .from(employeeSalaries)
          .where(
            and(eq(employeeSalaries.employeeId, id), eq(employeeSalaries.organizationId, orgId)),
          )
          .orderBy(desc(employeeSalaries.effectiveFrom))
      : Promise.resolve([]),
  ]);
  return { docs, checklist, salaries };
}

export async function listOrgChart(tx: Tx, orgId: string) {
  return tx
    .select({
      id: employees.id,
      name: sql<string>`trim(${employees.firstName} || ' ' || ${employees.lastName})`,
      managerId: employees.managerId,
      designation: designations.title,
      department: departments.name,
    })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(employees.organizationId, orgId),
        isNull(employees.deletedAt),
        sql`${employees.status} <> 'exited'`,
      ),
    )
    .orderBy(asc(employees.firstName));
}

export async function getSalaryLibrary(tx: Tx, orgId: string) {
  const [components, structures] = await Promise.all([
    tx
      .select()
      .from(salaryComponents)
      .where(and(eq(salaryComponents.organizationId, orgId), isNull(salaryComponents.deletedAt)))
      .orderBy(asc(salaryComponents.position), asc(salaryComponents.name)),
    tx
      .select()
      .from(salaryStructures)
      .where(and(eq(salaryStructures.organizationId, orgId), isNull(salaryStructures.deletedAt)))
      .orderBy(asc(salaryStructures.name)),
  ]);
  return { components, structures };
}
