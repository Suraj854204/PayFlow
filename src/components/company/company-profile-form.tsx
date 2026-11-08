"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { updateCompanyProfileAction } from "@/app/actions/company";

interface Props {
  initial: { name: string; legalName: string; brandColor: string };
}

export function CompanyProfileForm({ initial }: Props) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [color, setColor] = useState(initial.brandColor);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    start(async () => {
      const res = await updateCompanyProfileAction({
        name: f.get("name"),
        legalName: f.get("legalName") || undefined,
        brandColor: color,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success("Company profile saved.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Display name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={initial.name}
          required
          aria-invalid={!!errors.name}
        />
        <FieldError message={errors.name?.[0]} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="legalName">Legal name</Label>
        <Input id="legalName" name="legalName" defaultValue={initial.legalName} />
        <FieldError message={errors.legalName?.[0]} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="brandColor">Brand colour</Label>
        <div className="flex items-center gap-3">
          <input
            id="brandColor"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="bg-card size-10 cursor-pointer rounded-lg border p-1"
          />
          <span className="text-muted-foreground font-mono text-sm">{color}</span>
        </div>
        <FieldError message={errors.brandColor?.[0]} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
