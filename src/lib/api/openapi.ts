import { API_SCOPES } from "./scopes";

const page = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
];
const list = (summary: string, scope: string, item: string, extra: object[] = []) => ({
  get: {
    summary,
    security: [{ bearer: [scope] }],
    parameters: [...page, ...extra],
    responses: {
      "200": {
        description: "A page of results",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                data: { type: "array", items: { $ref: `#/components/schemas/${item}` } },
                meta: { $ref: "#/components/schemas/PageMeta" },
              },
            },
          },
        },
      },
      "401": { $ref: "#/components/responses/Error" },
      "403": { $ref: "#/components/responses/Error" },
      "429": { $ref: "#/components/responses/Error" },
    },
  },
});
const one = (summary: string, scope: string, item: string) => ({
  get: {
    summary,
    security: [{ bearer: [scope] }],
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
    ],
    responses: {
      "200": {
        description: "The record",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { data: { $ref: `#/components/schemas/${item}` } },
            },
          },
        },
      },
      "404": { $ref: "#/components/responses/Error" },
      "401": { $ref: "#/components/responses/Error" },
      "403": { $ref: "#/components/responses/Error" },
    },
  },
});
const str = { type: "string" };
const int = { type: "integer" };

export function openApiSpec(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "PayFlow API",
      version: "1.0.0",
      description:
        "Read-only API for your company's data. Create a key under Developers. Amounts are integer paise. Sensitive fields (bank, PAN, Aadhaar) are never returned.",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: `Scopes: ${API_SCOPES.map((s) => s.id).join(", ")}`,
        },
      },
      responses: {
        Error: {
          description: "Error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { type: "object", properties: { code: str, message: str } } },
              },
            },
          },
        },
      },
      schemas: {
        PageMeta: { type: "object", properties: { page: int, limit: int, total: int } },
        Employee: {
          type: "object",
          properties: {
            id: str,
            employeeCode: str,
            firstName: str,
            lastName: str,
            email: str,
            status: str,
            employmentType: str,
            departmentId: { ...str, nullable: true },
            designationId: { ...str, nullable: true },
            managerId: { ...str, nullable: true },
            joinDate: str,
            exitDate: { ...str, nullable: true },
          },
        },
        PayrollRun: {
          type: "object",
          properties: {
            id: str,
            month: { ...str, example: "2026-10" },
            status: str,
            employeeCount: int,
            totalGrossPaise: int,
            totalDeductionsPaise: int,
            totalNetPaise: int,
            totalEmployerCostPaise: int,
            approvedAt: { ...str, nullable: true },
            paidAt: { ...str, nullable: true },
          },
        },
        LeaveRequest: {
          type: "object",
          properties: {
            id: str,
            employeeId: str,
            leaveTypeId: str,
            fromDate: str,
            toDate: str,
            days: { type: "number" },
            halfDay: { type: "boolean" },
            status: str,
          },
        },
        Attendance: {
          type: "object",
          properties: {
            id: str,
            employeeId: str,
            date: str,
            status: str,
            checkIn: { ...str, nullable: true },
            checkOut: { ...str, nullable: true },
            workedMinutes: int,
            overtimeMinutes: int,
            lateMinutes: int,
          },
        },
      },
    },
    paths: {
      "/api/v1/employees": list("List employees", "employees:read", "Employee", [
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["active", "probation", "notice", "exited"] },
        },
      ]),
      "/api/v1/employees/{id}": one("Get an employee", "employees:read", "Employee"),
      "/api/v1/payroll-runs": list("List payroll runs", "payroll:read", "PayrollRun"),
      "/api/v1/payroll-runs/{id}": one("Get a payroll run", "payroll:read", "PayrollRun"),
      "/api/v1/leave-requests": list("List leave requests", "leave:read", "LeaveRequest", [
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["pending", "approved", "rejected", "cancelled"] },
        },
      ]),
      "/api/v1/attendance": list("List attendance records", "attendance:read", "Attendance", [
        { name: "from", in: "query", schema: { type: "string", format: "date" } },
        { name: "to", in: "query", schema: { type: "string", format: "date" } },
        { name: "employeeId", in: "query", schema: { type: "string", format: "uuid" } },
      ]),
    },
  };
}
