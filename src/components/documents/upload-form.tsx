"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DOC_KINDS, DOC_LABEL } from "@/lib/docai/fields";

export function DocumentUploadForm({ employees }: { employees: { id: string; name: string }[] }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const cls = "border-input bg-background mt-1 h-10 w-full rounded-lg border px-3 text-sm";
  return (
    <form
      ref={ref}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const res = await fetch("/api/documents", {
            method: "POST",
            body: new FormData(e.currentTarget),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string; engine?: string };
          if (!res.ok) return void toast.error(body.error ?? "Upload failed.");
          toast.success(
            body.engine === "model"
              ? "Read by AI. Please verify the values."
              : "Uploaded. Enter the values to verify.",
          );
          ref.current?.reset();
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-sm">
        Employee
        <select name="employeeId" required className={cls}>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Document
        <select name="kind" required className={cls}>
          {DOC_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOC_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        File (JPG, PNG, WebP or PDF, up to 4 MB)
        <input
          name="file"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className={`${cls} py-1.5`}
        />
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <ScanText />} Read document
        </Button>
      </div>
    </form>
  );
}
