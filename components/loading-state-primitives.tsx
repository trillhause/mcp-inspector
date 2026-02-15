import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type LoadingSectionProps = {
  children: ReactNode;
  className?: string;
  label?: string;
};

type SkeletonCardProps = {
  className?: string;
  lineWidths?: string[];
};

type SkeletonRowProps = {
  className?: string;
  showIcon?: boolean;
};

export function LoadingSection({
  children,
  className,
  label = "Loading content",
}: LoadingSectionProps) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-live="polite" aria-label={label}>
      {children}
    </div>
  );
}

export function SkeletonCard({
  className,
  lineWidths = ["w-40", "w-full", "w-3/4"],
}: SkeletonCardProps) {
  return (
    <div className={cn("rounded-lg border bg-background p-3", className)}>
      <div className="flex animate-pulse flex-col gap-2">
        {lineWidths.map((widthClass, index) => (
          <div key={`${widthClass}-${index}`} className={cn("h-3 rounded bg-muted", widthClass)} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonRow({
  className,
  showIcon = true,
}: SkeletonRowProps) {
  return (
    <div className={cn("flex animate-pulse items-center gap-2.5 rounded-md px-2 py-1.5", className)}>
      {showIcon ? <div className="size-6 shrink-0 rounded bg-muted" /> : null}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="h-3 w-24 rounded bg-muted" />
      </div>
    </div>
  );
}
