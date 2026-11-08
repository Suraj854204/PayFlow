import type { TriggerKind } from "@/lib/db/schema";

/** Realistic example payloads, used by "Test run" and the builder's preview. Clearly marked as a test. */
export const SAMPLE_PAYLOADS: Record<TriggerKind, Record<string, unknown>> = {
  "leave.applied": {
    test: true,
    employee: { name: "Test Employee", email: "", department: "Engineering" },
    leave: {
      type: "Casual Leave",
      from: "2026-12-01",
      to: "2026-12-05",
      days: 5,
      reason: "Test run",
    },
  },
  "payroll.approved": {
    test: true,
    run: {
      month: "2026-10",
      monthLabel: "2026-10",
      employees: 42,
      totalNet: 1234500000,
      totalNetInr: "₹1,23,45,000",
    },
  },
  "employee.joined": {
    test: true,
    employee: {
      name: "Test Employee",
      email: "",
      department: "Engineering",
      designation: "Engineer",
      joinDate: "2026-12-01",
    },
  },
  "deadline.near": {
    test: true,
    deadline: {
      label: "PF for 2026-10",
      kind: "PF",
      period: "2026-10",
      dueDate: "2026-11-15",
      daysLeft: 2,
    },
  },
};
