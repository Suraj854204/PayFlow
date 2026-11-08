import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyProfileForm } from "@/components/company/company-profile-form";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { organizations } from "@/lib/db/schema";

export const metadata = { title: "Company profile" };

export default async function CompanySettingsPage() {
  const ctx = await requirePagePermission("org:manage");
  const [org] = await withTenant(ctx.organizationId, (tx) =>
    tx
      .select({
        name: organizations.name,
        legalName: organizations.legalName,
        brandColor: organizations.brandColor,
      })
      .from(organizations)
      .where(and(eq(organizations.id, ctx.organizationId), isNull(organizations.deletedAt))),
  );
  if (!org) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Company profile</h1>
        <p className="text-muted-foreground text-sm">
          Name and branding used across payslips and emails.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>Changes are recorded in the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyProfileForm
            initial={{ name: org.name, legalName: org.legalName ?? "", brandColor: org.brandColor }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
