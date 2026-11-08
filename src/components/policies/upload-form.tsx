"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function PolicyUploadForm() {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/policies", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; chunks?: number };
      if (!res.ok) return void toast.error(body.error ?? "Upload failed.");
      toast.success(`Policy added (${body.chunks} passages indexed).`);
      ref.current?.reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={ref} onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="min-w-56 flex-1 text-sm">
        Title (optional)
        <input
          name="title"
          maxLength={120}
          className="border-input bg-background mt-1 h-10 w-full rounded-lg border px-3"
        />
      </label>
      <label className="min-w-56 flex-1 text-sm">
        PDF, .txt or .md (up to 5 MB)
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="border-input bg-background mt-1 block h-10 w-full rounded-lg border px-2 py-1.5 text-sm"
        />
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
      </Button>
    </form>
  );
}
