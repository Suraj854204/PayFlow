import type { attendanceRecords, employees, leaveRequests, payrollRuns } from "@/lib/db/schema";

type Emp = typeof employees.$inferSelect;
type Run = typeof payrollRuns.$inferSelect;
type Leave = typeof leaveRequests.$inferSelect;
type Att = typeof attendanceRecords.$inferSelect;

/** Explicit allow-list: bank, PAN, Aadhaar, UAN and ESI numbers never leave through the API. */
export const serializeEmployee = (e: Emp) => ({
  id: e.id,
  employeeCode: e.employeeCode,
  firstName: e.firstName,
  lastName: e.lastName,
  email: e.email,
  status: e.status,
  employmentType: e.employmentType,
  departmentId: e.departmentId,
  designationId: e.designationId,
  managerId: e.managerId,
  joinDate: e.joinDate,
  exitDate: e.exitDate,
});

/** Money is integer paise throughout, matching the app. */
export const serializeRun = (r: Run) => ({
  id: r.id,
  month: r.month,
  status: r.status,
  employeeCount: r.employeeCount,
  totalGrossPaise: Number(r.totalGross),
  totalDeductionsPaise: Number(r.totalDeductions),
  totalNetPaise: Number(r.totalNet),
  totalEmployerCostPaise: Number(r.totalEmployerCost),
  approvedAt: r.approvedAt,
  paidAt: r.paidAt,
});

export const serializeLeave = (l: Leave) => ({
  id: l.id,
  employeeId: l.employeeId,
  leaveTypeId: l.leaveTypeId,
  fromDate: l.fromDate,
  toDate: l.toDate,
  days: Number(l.days),
  halfDay: l.halfDay,
  status: l.status,
});

export const serializeAttendance = (a: Att) => ({
  id: a.id,
  employeeId: a.employeeId,
  date: a.date,
  status: a.status,
  checkIn: a.checkIn,
  checkOut: a.checkOut,
  workedMinutes: a.workedMinutes,
  overtimeMinutes: a.overtimeMinutes,
  lateMinutes: a.lateMinutes,
});
