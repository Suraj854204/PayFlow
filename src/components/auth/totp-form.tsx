"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { totpSchema } from "@/lib/validation/auth";
import type { z } from "zod";

type Values = z.infer<typeof totpSchema>;

export function TotpForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(totpSchema) });

  async function onSubmit({ code }: Values) {
    setSubmitting(true);
    const res = await authClient.twoFactor.verifyTotp({ code, trustDevice: true });
    setSubmitting(false);
    if (res.error) {
      toast.error(res.error.message ?? "That code did not work. Try again.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="code">Authenticator code</Label>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="text-center font-mono text-lg tracking-[0.5em]"
          aria-invalid={!!errors.code}
          {...register("code")}
        />
        <FieldError message={errors.code?.message} />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Verifying…" : "Verify and continue"}
      </Button>
    </form>
  );
}
