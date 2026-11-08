import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(110deg,var(--muted)_30%,color-mix(in_oklab,var(--muted)_60%,var(--card))_50%,var(--muted)_70%)] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}
