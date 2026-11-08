import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Magnetic } from "@/components/ui/magnetic";

const WORDS = ["Run", "payroll", "that", "pays", "right,", "first", "time."];

/**
 * Server-rendered on purpose: the headline is the largest paint, so it must not wait for
 * JavaScript. The entrance animation is CSS-only (and switched off for reduced motion).
 */
export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="bg-mesh absolute inset-0 -z-10" />
      <div className="mx-auto max-w-4xl px-4 pt-20 pb-16 text-center sm:pt-28">
        <p className="bg-card/70 text-muted-foreground mx-auto inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
          <ShieldCheck className="text-success size-3.5" aria-hidden /> PF · ESI · Professional Tax
          · TDS, built in
        </p>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          {WORDS.map((w, i) => (
            <span
              key={w + i}
              className="animate-fade-up inline-block pr-[0.25em]"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {i >= 3 ? (
                <span className="from-primary bg-gradient-to-r to-fuchsia-500 bg-clip-text text-transparent">
                  {w}
                </span>
              ) : (
                w
              )}
            </span>
          ))}
        </h1>
        <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-lg text-pretty">
          PayFlow calculates salaries, statutory deductions and tax for Indian companies, routes
          every run through a second approver, and keeps a tamper-evident record of who did what.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Magnetic>
            <Button asChild size="lg">
              <Link href={signedIn ? "/dashboard" : "/signup"}>
                {signedIn ? "Open dashboard" : "Start free"} <ArrowRight />
              </Link>
            </Button>
          </Magnetic>
          <Magnetic>
            <Button asChild size="lg" variant="outline">
              <a href="#preview">See it working</a>
            </Button>
          </Magnetic>
        </div>
        <p className="text-muted-foreground mt-4 text-xs">
          No card needed. Payments run in Razorpay test mode.
        </p>
      </div>
    </section>
  );
}
