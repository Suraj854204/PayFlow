"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

/** Registers the service worker (production only) and offers "Install app" when the browser allows it. */
export function PwaRegister() {
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!install) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await install.prompt();
        setInstall(null);
      }}
      className="bg-card hover:bg-muted fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-lg"
    >
      <Download className="size-4" aria-hidden /> Install app
    </button>
  );
}
