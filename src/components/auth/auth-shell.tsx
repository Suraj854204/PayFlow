import Link from "next/link";
import { Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-2">
      <div className="bg-mesh pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <aside className="relative hidden flex-col justify-between p-12 lg:flex">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg">
            <Sparkles className="size-4" />
          </span>
          PayFlow
        </Link>
        <div className="max-w-md space-y-4">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">
            Payroll that runs itself, so your team can run the business.
          </h2>
          <p className="text-muted-foreground">
            PF, ESI, PT and TDS calculated to the paisa, with maker-checker approvals and a
            tamper-proof audit trail.
          </p>
        </div>
        <p className="text-muted-foreground text-xs">Built for Indian companies · DPDP ready</p>
      </aside>

      <main id="main" className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
          {children}
          {footer && <p className="text-muted-foreground text-center text-sm">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
