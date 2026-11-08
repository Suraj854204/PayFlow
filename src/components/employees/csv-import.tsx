"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  csvTemplateAction,
  importEmployeesCsvAction,
  type CsvRowError,
} from "@/app/actions/employees";

export function CsvImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<CsvRowError[]>([]);
  const [fileName, setFileName] = useState("");
  const csvRef = useRef("");

  async function downloadTemplate() {
    const text = await csvTemplateAction();
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File | undefined) {
    setErrors([]);
    if (!file) return;
    if (file.size > 2_000_000) return toast.error("File is too large (max 2 MB).");
    setFileName(file.name);
    csvRef.current = await file.text();
  }

  function submit() {
    if (!csvRef.current) return toast.error("Choose a CSV file first.");
    start(async () => {
      const res = await importEmployeesCsvAction(csvRef.current);
      if (!res.ok) return void toast.error(res.error);
      if (res.data.errors.length > 0) {
        setErrors(res.data.errors);
        toast.error("Nothing was imported. Fix the rows below and try again.");
        return;
      }
      toast.success(`Imported ${res.data.imported} employees.`);
      setOpen(false);
      csvRef.current = "";
      setFileName("");
      router.refresh();
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline">
          <Upload /> Import CSV
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="bg-card fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">Import employees</Dialog.Title>
          <Dialog.Description className="text-muted-foreground mb-4 text-sm">
            Departments and designations must already exist. The import is all-or-nothing, so one
            bad row never leaves you with a half-imported file.
          </Dialog.Description>
          <div className="space-y-4">
            <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download /> Download template
            </Button>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
              aria-label="CSV file"
              className="file:bg-muted block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-2"
            />
            {fileName && <p className="text-muted-foreground text-xs">Selected: {fileName}</p>}
            {errors.length > 0 && (
              <ul
                role="alert"
                className="border-destructive/30 bg-destructive/10 max-h-48 space-y-1 overflow-y-auto rounded-lg border p-3 text-xs"
              >
                {errors.map((e, i) => (
                  <li key={i}>
                    <strong>Row {e.row}:</strong> {e.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
