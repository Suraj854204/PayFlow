import { Sparkles } from "lucide-react";

export interface BrandInfo {
  name: string;
  logoUrl: string | null;
}

/** The product mark in the header: the company's own name and logo when white-labelled. */
export function BrandMark({ brand, showName = true }: { brand: BrandInfo; showName?: boolean }) {
  return (
    <>
      <span className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo is an arbitrary https URL chosen by the company
          <img
            src={brand.logoUrl}
            alt=""
            className="size-8 object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          <Sparkles className="size-4" />
        )}
      </span>
      {showName && <span className="truncate">{brand.name}</span>}
    </>
  );
}
