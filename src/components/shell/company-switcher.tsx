"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { switchCompanyAction } from "@/app/actions/company";
import { CreateCompanyForm } from "@/components/company/create-company-form";
import { ROLE_LABELS } from "@/lib/rbac";
import type { CompanySummary } from "@/lib/auth/context";

export function CompanySwitcher({
  companies,
  activeId,
}: {
  companies: CompanySummary[];
  activeId: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const active = companies.find((c) => c.id === activeId) ?? companies[0];

  function switchTo(id: string) {
    if (id === activeId) return;
    start(async () => {
      const res = await switchCompanyAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <Dropdown.Root>
        <Dropdown.Trigger className="bg-card hover:bg-muted focus-visible:ring-ring/40 flex h-9 max-w-28 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none sm:max-w-56">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: active.brandColor }}
            aria-hidden
          />
          <span className="truncate font-medium">{active.name}</span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            align="start"
            sideOffset={6}
            className="bg-card z-50 min-w-64 rounded-xl border p-1.5 shadow-lg"
          >
            <p className="text-muted-foreground px-2 py-1.5 text-xs">Your companies</p>
            {companies.map((c) => (
              <Dropdown.Item
                key={c.id}
                onSelect={() => switchTo(c.id)}
                className="data-[highlighted]:bg-muted flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: c.brandColor }}
                  aria-hidden
                />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-muted-foreground text-xs">{ROLE_LABELS[c.role]}</span>
                {c.id === activeId && <Check className="text-primary size-4" />}
              </Dropdown.Item>
            ))}
            <Dropdown.Separator className="bg-border my-1 h-px" />
            <Dropdown.Item
              onSelect={() => setOpen(true)}
              className="data-[highlighted]:bg-muted flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none"
            >
              <Plus className="size-4" /> Add another company
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="bg-card fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold">Add another company</Dialog.Title>
            <Dialog.Description className="text-muted-foreground mb-4 text-sm">
              You&apos;ll be the Super Admin of the new company. Your other companies stay separate.
            </Dialog.Description>
            <CreateCompanyForm onDone={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
