import * as React from "react";

import { cn } from "@/lib/utils";

function Badge({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-[#2a2f3a] bg-[#0b2b51] px-2 py-0.5 text-xs font-medium text-[#7dd3fc]",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
