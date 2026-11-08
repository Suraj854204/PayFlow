import { eq } from "drizzle-orm";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { getReferenceData } from "@/lib/queries";

export const metadata = { title: "Company setup" };

export default async function SetupPage() {
  const ctx = await requirePagePermission("org:manage");
  const { org, ref } = await withTenant(ctx.organizationId, async (tx) => {
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId));
    return { org, ref: await getReferenceData(tx, ctx.organizationId) };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Company setup</h1>
        <p className="text-muted-foreground text-sm">
          A few quick steps so payroll, leave and compliance start with the right defaults. Every
          step saves as you go, and you can revisit this page any time.
        </p>
      </div>
      <SetupWizard
        completed={Boolean(org.onboardingCompletedAt)}
        statutory={{
          state: org.state ?? "",
          pan: org.pan ?? "",
          tan: org.tan ?? "",
          gstin: org.gstin ?? "",
          pfEstablishmentCode: org.pfEstablishmentCode ?? "",
          esiCode: org.esiCode ?? "",
          ptRegistrationNo: org.ptRegistrationNo ?? "",
        }}
        schedule={{ payDay: org.payDay, cutoffDay: org.cutoffDay }}
        departments={ref.departments}
        designations={ref.designations}
        holidays={ref.holidays}
      />
    </div>
  );
}
