"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col gap-2",
        month: "space-y-4",
        caption: "flex items-center justify-between gap-2 py-1",
        caption_label: "text-sm font-semibold tracking-wide text-[#f3f4f6]",
        nav: "flex items-center gap-1",
        nav_button:
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#2a2f3a] bg-[#141926] text-[#c7ccda] transition-colors hover:bg-[#2c3344] hover:text-white",
        nav_button_previous: "static",
        nav_button_next: "static",
        table: "w-full border-collapse table-fixed",
        weekdays: "grid grid-cols-7 mb-1",
        weekdays_row: "contents",
        weekday: "h-10 w-10 place-self-center text-center text-[0.8rem] font-medium uppercase tracking-wide text-[#7d8596]",
        head_row: "grid grid-cols-7",
        head_cell: "h-10 w-10 place-self-center text-center text-[0.8rem] font-medium uppercase tracking-wide text-[#7d8596]",
        row: "mt-1.5 grid grid-cols-7 justify-items-center",
        cell: "relative h-10 w-10 p-0 text-center text-sm",
        day: "inline-flex h-10 w-10 items-center justify-center rounded-md text-[#e8ebf3] transition-colors hover:bg-[#2c3344]",
        day_selected: "bg-[#0a84ff] text-white shadow-sm hover:bg-[#0a84ff]",
        day_today: "border border-[#355a92] bg-[#1a2333]",
        day_outside: "text-[#5f6675] opacity-70",
        day_disabled: "text-[#5f6675] opacity-50",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: iconClassName, ...iconProps }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", iconClassName)} {...iconProps} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", iconClassName)} {...iconProps} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
