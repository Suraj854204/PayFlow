import { Check, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/auth/context";
import { can, PERMISSIONS, ROLES, ROLE_LABELS } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { canAny } from "@/lib/rbac";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const ctx = await requireContext();
  if (!canAny(ctx.role, ["settings:manage", "members:read"])) redirect("/dashboard?denied=1");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Roles & permissions</h1>
        <p className="text-muted-foreground text-sm">
          The access matrix enforced on the server for every action and API call.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Permission matrix</CardTitle>
          <CardDescription>
            Maker-checker: whoever drafts a payroll run can never approve it.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 pr-4 font-medium">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-2 text-center font-medium">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td className="py-2 pr-4 font-mono text-xs">{p}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-3 py-2 text-center">
                      {can(r, p) ? (
                        <Check className="text-success mx-auto size-4" aria-label="Allowed" />
                      ) : (
                        <Minus
                          className="text-muted-foreground/40 mx-auto size-4"
                          aria-label="Not allowed"
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
