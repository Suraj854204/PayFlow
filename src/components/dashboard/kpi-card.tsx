"use client";

import Link from "next/link";
import {
  Banknote,
  CalendarCheck,
  ClipboardCheck,
  Landmark,
  Plane,
  ReceiptText,
  Users,
  Wallet,
} from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/sparkline";
import { formatINRCompact } from "@/lib/money";

const ICONS = {
  banknote: Banknote,
  calendar: CalendarCheck,
  clipboard: ClipboardCheck,
  landmark: Landmark,
  plane: Plane,
  receipt: ReceiptText,
  users: Users,
  wallet: Wallet,
} as const;

interface Props {
  label: string;
  value: number;
  kind: "count" | "inr";
  /** A name, not a component: server pages cannot pass component functions to client components. */
  icon: keyof typeof ICONS;
  hint?: string;
  href?: string;
  spark?: number[];
}

const fmt = {
  count: (n: number) => Math.round(n).toLocaleString("en-IN"),
  inr: (n: number) => formatINRCompact(Math.round(n)),
};

/** KPI tile: animated counter, optional sparkline, hover lift, whole card links where useful. */
export function KpiCard({ label, value, kind, icon, hint, href, spark }: Props) {
  const Icon = ICONS[icon];
  const body = (
    <Card className="group relative h-full overflow-hidden p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{label}</p>
        <span className="bg-accent text-accent-foreground grid size-8 place-items-center rounded-lg">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
        <AnimatedNumber value={value} format={fmt[kind]} />
      </p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-muted-foreground min-h-4 text-xs">{hint}</p>
        {spark && <Sparkline values={spark} className="h-6 w-20 shrink-0" />}
      </div>
    </Card>
  );
  return href ? (
    <Link
      href={href}
      className="focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
