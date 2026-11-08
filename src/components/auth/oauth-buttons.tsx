"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

type Provider = "google" | "microsoft";

export function OAuthButtons({ callbackURL = "/dashboard" }: { callbackURL?: string }) {
  const [pending, setPending] = useState<Provider | null>(null);

  async function go(provider: Provider) {
    setPending(provider);
    const res = await authClient.signIn.social({ provider, callbackURL });
    if (res?.error) {
      toast.error(
        `${provider === "google" ? "Google" : "Microsoft"} sign-in is not configured for this workspace.`,
      );
      setPending(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => go("google")}
      >
        {pending === "google" ? "Redirecting…" : "Google"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => go("microsoft")}
      >
        {pending === "microsoft" ? "Redirecting…" : "Microsoft"}
      </Button>
    </div>
  );
}
