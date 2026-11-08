"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "@/app/actions/invite";

export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      )}
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptInviteAction(token);
            if (!r.ok) return void setError(r.error);
            router.replace("/dashboard");
            router.refresh();
          })
        }
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </div>
  );
}
