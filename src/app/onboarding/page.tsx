import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreateCompanyForm } from "@/components/company/create-company-form";
import { getContext, getSessionUser } from "@/lib/auth/context";

export const metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getContext();
  if (ctx) redirect("/dashboard");

  return (
    <AuthShell
      title="Set up your company"
      subtitle={`Welcome, ${user.name.split(" ")[0]}. Create your company to get started. You'll become its Super Admin.`}
    >
      <CreateCompanyForm />
    </AuthShell>
  );
}
