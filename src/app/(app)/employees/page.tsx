import Link from "next/link";
import { Download, Plus, Search, Users } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CsvImport } from "@/components/employees/csv-import";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getReferenceData, listEmployees } from "@/lib/queries";

export const metadata = { title: "Employees" };

const paramsSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(["active", "probation", "notice", "exited"]).optional().catch(undefined),
  dept: z.string().uuid().optional().catch(undefined),
  probation: z.literal("1").optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

const TONE = {
  active: "success",
  probation: "warning",
  notice: "danger",
  exited: "neutral",
} as const;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePagePermission("employees:read");
  const sp = paramsSchema.parse(await searchParams);
  const canWrite = can(ctx.role, "employees:write");

  const { list, ref } = await withTenant(ctx.organizationId, async (tx) => ({
    list: await listEmployees(tx, ctx.organizationId, {
      q: sp.q,
      status: sp.status,
      departmentId: sp.dept,
      probationEnding: sp.probation === "1",
      page: sp.page,
    }),
    ref: await getReferenceData(tx, ctx.organizationId),
  }));

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, status: sp.status, dept: sp.dept, probation: sp.probation, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-muted-foreground text-sm">
            {list.total} {list.total === 1 ? "person" : "people"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/api/employees/export">
              <Download /> Export CSV
            </a>
          </Button>
          {canWrite && <CsvImport />}
          {canWrite && (
            <Button asChild>
              <Link href="/employees/new">
                <Plus /> Add employee
              </Link>
            </Button>
          )}
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-52 flex-1">
          <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <input
            name="q"
            defaultValue={sp.q}
            placeholder="Search name, email or code"
            aria-label="Search employees"
            className="bg-card h-10 w-full rounded-lg border pr-3 pl-9 text-sm"
          />
        </div>
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          aria-label="Status"
          className="bg-card h-10 rounded-lg border px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="probation">On probation</option>
          <option value="notice">Serving notice</option>
          <option value="exited">Exited</option>
        </select>
        <select
          name="dept"
          defaultValue={sp.dept ?? ""}
          aria-label="Department"
          className="bg-card h-10 rounded-lg border px-3 text-sm"
        >
          <option value="">All departments</option>
          {ref.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="probation" value="1" defaultChecked={sp.probation === "1"} />{" "}
          Probation ending in 30 days
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(sp.q || sp.status || sp.dept || sp.probation) && (
          <Button variant="ghost" asChild>
            <Link href="/employees">Clear</Link>
          </Button>
        )}
      </form>

      <Card className="overflow-hidden">
        {list.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="bg-accent text-accent-foreground grid size-12 place-items-center rounded-full">
              <Users className="size-6" />
            </span>
            <p className="font-medium">
              {sp.q || sp.status || sp.dept || sp.probation
                ? "No employees match your filters"
                : "No employees yet"}
            </p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Add people one by one or import a CSV to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/employees/${r.id}`} className="font-medium hover:underline">
                        {r.firstName} {r.lastName}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {r.employeeCode} · {r.designation ?? "No designation"}
                      </div>
                    </td>
                    <td className="px-4 py-3">{r.department ?? "—"}</td>
                    <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                      {new Date(`${r.joinDate}T00:00:00`).toLocaleDateString("en-IN", {
                        dateStyle: "medium",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={TONE[r.status]}>
                        {r.status === "notice"
                          ? "Serving notice"
                          : r.status[0].toUpperCase() + r.status.slice(1)}
                      </Badge>
                      {r.status === "probation" && r.probationEndDate && (
                        <div className="text-muted-foreground mt-1 text-xs">
                          until{" "}
                          {new Date(`${r.probationEndDate}T00:00:00`).toLocaleDateString("en-IN", {
                            dateStyle: "medium",
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {list.pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {list.page} of {list.pages}
          </span>
          <div className="flex gap-2">
            {list.page > 1 && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/employees${qs({ page: String(list.page - 1) })}`}>Previous</Link>
              </Button>
            )}
            {list.page < list.pages && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/employees${qs({ page: String(list.page + 1) })}`}>Next</Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
