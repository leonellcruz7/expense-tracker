import * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-3xl border border-[#2a2f3a] bg-[#171a23] text-[#f3f4f6]", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-4 pb-2", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("font-semibold", className)} {...props} />;
}

export { Card, CardContent, CardHeader, CardTitle };
