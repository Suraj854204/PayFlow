import Link from "next/link";
import { Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";

const LINKS = [
  ["Features", "#features"],
  ["Preview", "#preview"],
  ["Pricing", "#pricing"],
  ["FAQ", "#faq"],
] as const;

export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="glass sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg">
            <Sparkles className="size-4" aria-hidden />
          </span>
          PayFlow
        </Link>
        <nav aria-label="Sections" className="ml-6 hidden items-center gap-5 text-sm md:flex">
          {LINKS.map(([l, h]) => (
            <a
              key={h}
              href={h}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {l}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
