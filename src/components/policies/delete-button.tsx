"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePolicyAction } from "@/app/actions/policies";
import { Button } from "@/components/ui/button";

export function DeletePolicyButton({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Delete ${title}`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${title}"? PayBot will stop citing it.`)) return;
        start(async () => {
          const r = await deletePolicyAction(id);
          if (!r.ok) toast.error(r.error);
          else toast.success("Policy deleted.");
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}
