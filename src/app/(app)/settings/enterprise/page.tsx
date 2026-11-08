import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BrandingForm,
  FlagToggle,
  FxSection,
  SsoForm,
} from "@/components/enterprise/enterprise-forms";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { fxRates, organizations } from "@/lib/db/schema";
import { FLAG_DEFS } from "@/lib/enterprise/flags";
import { loadFlags } from "@/lib/enterprise/flags-server";

export const metadata = { title: "Enterprise settings" };
export const dynamic = "force-dynamic";

export default async function EnterpriseSettingsPage() {
  const ctx = await requirePagePermission("org:manage");
  const d = await withTenant(ctx.organizationId, async (tx) => {
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId));
    const rates = await tx
      .select()
      .from(fxRates)
      .where(eq(fxRates.organizationId, ctx.organizationId));
    return { org, rates, flags: await loadFlags(tx, ctx.organizationId) };
  });
  if (!d.org) notFound();
  const googleOn = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const msOn = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enterprise settings</h1>
        <p className="text-muted-foreground text-sm">
          Branding, sign-in rules, feature switches and currency display. Every change is audited.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>White-label branding</CardTitle>
          <CardDescription>
            Your name and logo replace “PayFlow” in the app header. Colour is set under Company
            profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm
            initial={{
              brandName: d.org.brandName ?? "",
              logoUrl: d.org.logoUrl ?? "",
              defaultLocale: d.org.defaultLocale === "hi" ? "hi" : "en",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
          <CardDescription>
            People with an email on these domains must use Continue with Google or Microsoft;
            password sign-in is refused. Google is {googleOn ? "configured" : "not configured"} and
            Microsoft is {msOn ? "configured" : "not configured"} on this server. SAML is not
            supported yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SsoForm initial={d.org.ssoDomains.join(", ")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>
            Switching a feature off makes its pages unreachable for everyone in this company.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {FLAG_DEFS.map((f) => (
            <FlagToggle
              key={f.key}
              flagKey={f.key}
              label={f.label}
              description={f.description}
              enabled={d.flags[f.key]}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Currency display</CardTitle>
          <CardDescription>
            Payroll stays in rupees. Rates you enter here only add an indicative foreign-currency
            figure in the simulator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FxSection
            rates={d.rates.map((r) => ({ currency: r.currency, inrPerUnit: 1 / Number(r.perInr) }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
