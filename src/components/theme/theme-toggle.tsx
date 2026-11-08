"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Both icons are always rendered and cross-fade with CSS, so the toggle needs no animation library. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      data-tour="theme"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <span className="relative grid size-4 place-items-center">
        <Sun
          className={`absolute transition-all duration-300 ${dark ? "scale-50 -rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"}`}
        />
        <Moon
          className={`absolute transition-all duration-300 ${dark ? "scale-100 rotate-0 opacity-100" : "scale-50 rotate-90 opacity-0"}`}
        />
      </span>
    </Button>
  );
}
