"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteFxRateAction,
  saveBrandingAction,
  saveFxRateAction,
  saveSsoDomainsAction,
  setFlagAction,
} from "@/app/actions/enterprise";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CURRENCIES } from "@/lib/enterprise/fx";

export function BrandingForm({
  initial,
}: {
  initial: { brandName: string; logoUrl: string; defaultLocale: "en" | "hi" };
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveBrandingAction(v);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Branding saved.");
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="br-name">Product name shown to your people</Label>
        <Input
          id="br-name"
          maxLength={60}
          placeholder="PayFlow"
          value={v.brandName}
          onChange={(e) => setV({ ...v, brandName: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="br-logo">Logo link (https)</Label>
        <Input
          id="br-logo"
          placeholder="https://example.com/logo.png"
          value={v.logoUrl}
          onChange={(e) => setV({ ...v, logoUrl: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="br-loc">Default language</Label>
        <select
          id="br-loc"
          className="bg-card h-10 w-full rounded-lg border px-3 text-sm"
          value={v.defaultLocale}
          onChange={(e) => setV({ ...v, defaultLocale: e.target.value as "en" | "hi" })}
        >
          <option value="en">English</option>
          <option value="hi">हिन्दी (Hindi)</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        Save branding
      </Button>
    </form>
  );
}

export function SsoForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [domains, setDomains] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveSsoDomainsAction({ domains });
          if (!r.ok) return void toast.error(r.error);
          setDomains(r.data.domains.join(", "));
          toast.success(
            r.data.domains.length
              ? "Single sign-on is now required for these domains."
              : "Single sign-on requirement removed.",
          );
          router.refresh();
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="sso-domains">Email domains (comma separated)</Label>
        <Input
          id="sso-domains"
          placeholder="acme.com, acme.in"
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        Save
      </Button>
    </form>
  );
}

export function FlagToggle({
  flagKey,
  label,
  description,
  enabled,
}: {
  flagKey: string;
  label: string;
  description: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium" id={`flag-${flagKey}`}>
          {label}
        </p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={`flag-${flagKey}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setFlagAction({ key: flagKey, enabled: !enabled });
            if (!r.ok) return void toast.error(r.error);
            router.refresh();
          })
        }
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${enabled ? "bg-primary border-primary" : "bg-muted"}`}
      >
        <span
          className={`bg-background absolute top-0.5 size-5 rounded-full shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

export function FxSection({ rates }: { rates: { currency: string; inrPerUnit: number }[] }) {
  const router = useRouter();
  const [currency, setCurrency] = useState<string>(CURRENCIES[0]);
  const [rate, setRate] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <ul className="divide-y text-sm">
        {rates.length === 0 && <li className="text-muted-foreground py-2">No rates yet.</li>}
        {rates.map((r) => (
          <li key={r.currency} className="flex items-center justify-between py-2">
            <span>
              1 {r.currency} = ₹{r.inrPerUnit.toFixed(2)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const x = await deleteFxRateAction({ currency: r.currency });
                  if (!x.ok) return void toast.error(x.error);
                  router.refresh();
                })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const x = await saveFxRateAction({ currency, inrPerUnit: Number(rate) });
            if (!x.ok) return void toast.error(x.error);
            setRate("");
            toast.success("Rate saved.");
            router.refresh();
          });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="fx-cur">Currency</Label>
          <select
            id="fx-cur"
            className="bg-card h-10 rounded-lg border px-3 text-sm"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="fx-rate">₹ per 1 unit</Label>
          <Input
            id="fx-rate"
            inputMode="decimal"
            placeholder="83.50"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || !(Number(rate) > 0)}>
          Save rate
        </Button>
      </form>
    </div>
  );
}
