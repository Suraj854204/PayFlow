"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="bg-destructive/10 text-destructive grid size-12 place-items-center rounded-full">
        <AlertTriangle className="size-6" />
      </span>
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">
        We hit an unexpected error. Your data is safe.{" "}
        {error.digest && `Reference: ${error.digest}`}
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
