"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { createCompanyAction } from "@/app/actions/company";

export function CreateCompanyForm({ onDone }: { onDone?: () => void }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    start(async () => {
      const res = await createCompanyAction({
        name: form.get("name"),
        state: form.get("state") || undefined,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("Company created.");
      onDone?.();
      // Hard navigation: a new company changes the whole session context, and this avoids racing the
      // router refresh that revalidatePath() triggers.
      window.location.assign("/setup");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Company name</Label>
        <Input
          id="name"
          name="name"
          required
          placeholder="Acme Technologies Pvt Ltd"
          aria-invalid={!!errors.name}
        />
        <FieldError message={errors.name?.[0]} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="state">State of registration</Label>
        <Input id="state" name="state" placeholder="Karnataka" />
        <FieldError message={errors.state?.[0]} />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create company"}
      </Button>
    </form>
  );
}
