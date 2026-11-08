import Link from "next/link";
import { cn } from "@/lib/utils";

export type ViewKey = "admin" | "team" | "me";
const LABEL: Record<ViewKey, string> = { admin: "Company", team: "My team", me: "Me" };

/** Plain links (no client state), so the chosen view is shareable and works without JavaScript. */
export function ViewTabs({ views, active }: { views: ViewKey[]; active: ViewKey }) {
  if (views.length < 2) return null;
  return (
    <nav aria-label="Dashboard view" className="bg-muted inline-flex rounded-xl p-1">
      {views.map((v) => (
        <Link
          key={v}
          href={`/dashboard?view=${v}`}
          aria-current={v === active ? "page" : undefined}
          className={cn(
            "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
            v === active
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABEL[v]}
        </Link>
      ))}
    </nav>
  );
}
