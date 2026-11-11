import { cn } from "@/lib/utils";

import type { ComponentProps, ReactElement } from "react";

export function Badge({ className, ...props }: ComponentProps<"span">): ReactElement {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
