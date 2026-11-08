"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { reviewDeclarationAction, saveDeclarationAction } from "@/app/actions/tax";
import { rupeesToPaise } from "@/lib/money";

export interface DeclInit {
  regime: "new" | "old";
  section80C: number;
  section80D: number;
  annualRent: number;
  metro: boolean;
  landlordName: string;
  landlordPan: string;
  otherDeductions: number;
  status: string;
  reviewNote: string | null;
}

const rs = (p: number) => (p ? String(p / 100) : "");

export function DeclarationForm({ init }: { init: DeclInit }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [regime, setRegime] = useState(init.regime);
  const [metro, setMetro] = useState(init.metro);
  const locked = init.status === "verified";

  function save(submit: boolean, form: HTMLFormElement) {
    const f = new FormData(form);
    const money = (k: string) => {
      try {
        return rupeesToPaise(String(f.get(k) || "0").replace(/,/g, ""));
      } catch {
        return NaN;
      }
    };
    const payload = {
      regime,
      section80C: money("c80"),
      section80D: money("d80"),
      annualRent: money("rent"),
      metro,
      landlordName: String(f.get("landlord") || "") || undefined,
      landlordPan: String(f.get("lpan") || "") || undefined,
      otherDeductions: money("other"),
      submit,
    };
    if (
      [payload.section80C, payload.section80D, payload.annualRent, payload.otherDeductions].some(
        Number.isNaN,
      )
    )
      return void toast.error("Enter amounts in rupees.");
    start(async () => {
      const r = await saveDeclarationAction(payload);
      if (!r.ok) return void toast.error(r.error);
      toast.success(submit ? "Declaration submitted for HR verification." : "Draft saved.");
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save(true, e.currentTarget);
      }}
    >
      <fieldset className="flex gap-6 text-sm" disabled={locked}>
        <legend className="mb-1 font-medium">Tax regime</legend>
        {(["new", "old"] as const).map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input
              type="radio"
              name="regime"
              checked={regime === r}
              onChange={() => setRegime(r)}
            />{" "}
            {r === "new" ? "New regime" : "Old regime (uses the deductions below)"}
          </label>
        ))}
      </fieldset>
      <div className={"grid gap-3 sm:grid-cols-4 " + (regime === "new" ? "opacity-50" : "")}>
        <div className="space-y-1">
          <Label htmlFor="d-c80">Section 80C (Rs, max 1,50,000 with PF)</Label>
          <Input
            id="d-c80"
            name="c80"
            defaultValue={rs(init.section80C)}
            inputMode="decimal"
            disabled={locked}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-d80">Section 80D health insurance (Rs)</Label>
          <Input
            id="d-d80"
            name="d80"
            defaultValue={rs(init.section80D)}
            inputMode="decimal"
            disabled={locked}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-rent">Annual rent paid (Rs) for HRA</Label>
          <Input
            id="d-rent"
            name="rent"
            defaultValue={rs(init.annualRent)}
            inputMode="decimal"
            disabled={locked}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-other">Other deductions (Rs)</Label>
          <Input
            id="d-other"
            name="other"
            defaultValue={rs(init.otherDeductions)}
            inputMode="decimal"
            disabled={locked}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-landlord">Landlord name</Label>
          <Input
            id="d-landlord"
            name="landlord"
            defaultValue={init.landlordName}
            disabled={locked}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-lpan">Landlord PAN (rent above Rs 1 lakh)</Label>
          <Input id="d-lpan" name="lpan" defaultValue={init.landlordPan} disabled={locked} />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={metro}
            onChange={(e) => setMetro(e.target.checked)}
            disabled={locked}
          />{" "}
          Metro city (Delhi, Mumbai, Kolkata, Chennai)
        </label>
      </div>
      {init.reviewNote && (
        <p className="text-destructive text-sm" role="alert">
          HR note: {init.reviewNote}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || locked}>
          Submit for verification
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || locked}
          onClick={(e) => save(false, e.currentTarget.closest("form") as HTMLFormElement)}
        >
          Save draft
        </Button>
      </div>
    </form>
  );
}

export function ReviewButtons({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (verify: boolean) => {
    const note = verify ? undefined : (window.prompt("Reason for rejecting (required)") ?? "");
    if (!verify && !note) return;
    start(async () => {
      const r = await reviewDeclarationAction({ declarationId: id, verify, note });
      if (!r.ok) return void toast.error(r.error);
      toast.success(verify ? "Verified." : "Rejected.");
      router.refresh();
    });
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => go(true)}>
        Verify
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => go(false)}>
        Reject
      </Button>
    </div>
  );
}
