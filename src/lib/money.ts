/**
 * Money is always an integer number of paise (1 INR = 100 paise). Never use floats for amounts.
 */
export type Paise = number;

export function assertPaise(value: number): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Money must be a safe integer number of paise, got ${value}`);
  }
}

export function rupeesToPaise(rupees: number | string): Paise {
  const str = typeof rupees === "number" ? rupees.toFixed(2) : rupees.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid rupee amount: ${rupees}`);
  }
  const negative = str.startsWith("-");
  const [whole, frac = ""] = str.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  assertPaise(paise);
  return negative ? -paise : paise;
}

export function paiseToRupees(paise: Paise): number {
  assertPaise(paise);
  return paise / 100;
}

/** Percentage of an amount with banker-safe half-up rounding. `bps` = basis points (1% = 100 bps). */
export function percentOf(amount: Paise, bps: number): Paise {
  assertPaise(amount);
  return Math.round((amount * bps) / 10_000);
}

export function sum(values: Paise[]): Paise {
  return values.reduce((acc, v) => {
    assertPaise(v);
    return acc + v;
  }, 0);
}

/** Splits an amount into n parts that add up exactly to the total (remainder spread from the start). */
export function allocate(total: Paise, parts: number): Paise[] {
  assertPaise(total);
  if (!Number.isInteger(parts) || parts <= 0) throw new Error("parts must be a positive integer");
  const base = Math.trunc(total / parts);
  let remainder = total - base * parts;
  return Array.from({ length: parts }, () => {
    if (remainder > 0) {
      remainder -= 1;
      return base + 1;
    }
    return base;
  });
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatINR(paise: Paise): string {
  return inr.format(paiseToRupees(paise));
}

/** Compact form: ₹1.2L, ₹3.4Cr. */
export function formatINRCompact(paise: Paise): string {
  const rupees = Math.abs(paiseToRupees(paise));
  const sign = paise < 0 ? "-" : "";
  if (rupees >= 1_00_00_000) return `${sign}₹${(rupees / 1_00_00_000).toFixed(2)}Cr`;
  if (rupees >= 1_00_000) return `${sign}₹${(rupees / 1_00_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)}K`;
  return `${sign}₹${rupees.toFixed(0)}`;
}
