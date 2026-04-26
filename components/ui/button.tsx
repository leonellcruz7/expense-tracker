import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#2d313a] text-[#f3f4f6] hover:bg-[#343845]",
        outline: "border border-[#2a2f3a] bg-[#171a23] text-[#f3f4f6] hover:bg-[#1d212c]",
        ghost: "text-[#f3f4f6] hover:bg-[#1d212c]",
        destructive: "bg-[#321722] text-[#fb7185] hover:bg-[#3b1b29]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
