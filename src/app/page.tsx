import type { Metadata } from "next";
import { LandingHeader } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { PreviewLazy } from "@/components/landing/preview-lazy";
import {
  Audiences,
  Bento,
  Faq,
  FinalCta,
  LandingFooter,
  Pricing,
} from "@/components/landing/sections";
import { getSessionUser } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: { absolute: "PayFlow: payroll and HR for Indian companies" },
  description:
    "Run payroll with PF, ESI, Professional Tax and TDS built in. Four-eyes approvals, payslips, attendance, leave, expenses, compliance and a tamper-evident audit log.",
  openGraph: {
    title: "PayFlow",
    description: "Payroll that pays right, first time.",
    type: "website",
  },
};

export default async function Home() {
  const user = await getSessionUser();
  const signedIn = Boolean(user);
  return (
    <>
      <LandingHeader signedIn={signedIn} />
      <main id="main">
        <Hero signedIn={signedIn} />
        <section id="preview" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              The same dashboards you&apos;ll use
            </h2>
            <p className="text-muted-foreground mt-3">
              Switch between what finance and an employee see. These figures are sample data.
            </p>
          </div>
          <PreviewLazy />
        </section>
        <Bento />
        <Audiences />
        <Pricing />
        <Faq />
        <FinalCta signedIn={signedIn} />
      </main>
      <LandingFooter />
    </>
  );
}
