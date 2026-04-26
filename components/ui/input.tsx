import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-transparent bg-[#171a23] px-3 py-2 text-sm text-[#a1a8b3] outline-none placeholder:text-[#7d8596] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
