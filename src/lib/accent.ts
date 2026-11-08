export const ACCENTS = [
  { id: "indigo", label: "Indigo", swatch: "#6366f1" },
  { id: "teal", label: "Teal", swatch: "#14b8a6" },
  { id: "rose", label: "Rose", swatch: "#f43f5e" },
  { id: "amber", label: "Amber", swatch: "#f59e0b" },
  { id: "emerald", label: "Emerald", swatch: "#10b981" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"];
export const ACCENT_KEY = "payflow:accent";
export const isAccent = (v: unknown): v is AccentId => ACCENTS.some((a) => a.id === v);

/** Runs before first paint so the chosen accent never flashes the default. */
export const ACCENT_BOOT_SCRIPT = `try{var a=localStorage.getItem("${ACCENT_KEY}");if(a&&a!=="indigo")document.documentElement.dataset.accent=a}catch(e){}`;
