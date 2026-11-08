"use client";

import { useRouter } from "next/navigation";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, Compass, KeyRound, Languages, LogOut, Palette } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { setLocaleAction } from "@/app/actions/locale";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { ACCENTS, ACCENT_KEY, isAccent, type AccentId } from "@/lib/accent";
import { TOUR_EVENT } from "@/lib/tour";
import { initials } from "@/lib/utils";
import { ROLE_LABELS, type Role } from "@/lib/rbac";

export function UserMenu({ name, email, role }: { name: string; email: string; role: Role }) {
  const router = useRouter();
  const t = useTranslations("shell");
  const locale = useLocale();
  const [accent, setAccent] = useState<AccentId>("indigo");
  useEffect(() => {
    try {
      const a = localStorage.getItem(ACCENT_KEY);
      if (isAccent(a)) setAccent(a);
    } catch {
      /* storage blocked: the default accent stays */
    }
  }, []);
  function pick(id: AccentId) {
    setAccent(id);
    if (id === "indigo") delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = id;
    try {
      localStorage.setItem(ACCENT_KEY, id);
    } catch {
      /* the choice still applies for this visit */
    }
  }

  async function logout() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        aria-label={t("accountMenu")}
        className="bg-accent text-accent-foreground ring-offset-background focus-visible:ring-ring grid size-9 place-items-center rounded-full text-xs font-semibold transition hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none"
      >
        {initials(name)}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          className="bg-card z-50 min-w-60 rounded-xl border p-1.5 shadow-lg"
        >
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-muted-foreground truncate text-xs">{email}</p>
            <p className="text-primary mt-1 text-xs">{ROLE_LABELS[role]}</p>
          </div>
          <Dropdown.Separator className="bg-border my-1 h-px" />
          <Dropdown.Item asChild>
            <Link
              href="/settings/security"
              className="data-[highlighted]:bg-muted flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none"
            >
              <KeyRound className="size-4" /> {t("security")}
            </Link>
          </Dropdown.Item>
          <div className="px-2 py-2">
            <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs">
              <Palette className="size-3.5" /> {t("accentColour")}
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={accent === a.id}
                  aria-label={a.label}
                  onClick={() => pick(a.id)}
                  className="ring-offset-card focus-visible:ring-ring grid size-7 place-items-center rounded-full ring-offset-2 transition focus-visible:ring-2 focus-visible:outline-none"
                  style={{ background: a.swatch }}
                >
                  {accent === a.id && <Check className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>
          <div className="px-2 py-2">
            <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs">
              <Languages className="size-3.5" /> {t("language")}
            </p>
            <div className="flex gap-2" role="radiogroup" aria-label={t("language")}>
              {LOCALES.map((l: Locale) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={locale === l}
                  onClick={async () => {
                    await setLocaleAction(l);
                    router.refresh();
                  }}
                  className={`rounded-lg border px-3 py-1 text-xs ${locale === l ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
                >
                  {LOCALE_LABELS[l]}
                </button>
              ))}
            </div>
          </div>
          <Dropdown.Item
            onSelect={() => window.dispatchEvent(new Event(TOUR_EVENT))}
            className="data-[highlighted]:bg-muted flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none"
          >
            <Compass className="size-4" /> {t("tour")}
          </Dropdown.Item>
          <Dropdown.Separator className="bg-border my-1 h-px" />
          <Dropdown.Item
            onSelect={logout}
            className="text-destructive data-[highlighted]:bg-destructive/10 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none"
          >
            <LogOut className="size-4" /> {t("signOut")}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
