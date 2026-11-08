"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { navLabel } from "@/i18n/nav-label";
import { BREADCRUMB_LABELS, ID_LABELS } from "@/lib/nav";

export function Breadcrumbs() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-sm sm:flex">
      {parts.map((part, i) => {
        const href = `/${parts.slice(0, i + 1).join("/")}`;
        const raw =
          BREADCRUMB_LABELS[part] ??
          (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(part)
            ? (ID_LABELS[parts[i - 1]] ?? "Details")
            : part);
        const label = navLabel(t, raw);
        const last = i === parts.length - 1;
        return (
          <span key={href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="text-muted-foreground size-3.5" aria-hidden />}
            {last ? (
              <span aria-current="page" className="font-medium">
                {label}
              </span>
            ) : (
              <Link
                href={href}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
