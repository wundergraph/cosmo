import * as React from "react";
import { addDays, addYears } from "date-fns";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button, ButtonProps } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import CalendarIcon from "@heroicons/react/24/outline/CalendarIcon";
import useWindowSize from "@/hooks/use-window-size";
import { formatDate } from "@/lib/format-date";

export function DatePickerWithRange({
  selectedDateRange,
  onDateRangeChange,
  className,
  align = "start",
  size,
}: React.HTMLAttributes<HTMLDivElement> & {
  selectedDateRange: DateRange;
  onDateRangeChange: (newVal: DateRange) => unknown;
  align?: "start" | "center" | "end";
  size?: ButtonProps["size"];
}) {
  const { isMobile } = useWindowSize();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id="date"
          variant={"outline"}
          size={size}
          className={cn(
            "w-[240px] justify-center text-left font-normal",
            className,
            !selectedDateRange && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selectedDateRange?.from ? (
            selectedDateRange.to ? (
              <>
                {formatDate(selectedDateRange.from)} -{" "}
                {formatDate(selectedDateRange.to)}
              </>
            ) : (
              formatDate(selectedDateRange.from)
            )
          ) : (
            <span>Pick a date</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          initialFocus
          mode="range"
          defaultMonth={selectedDateRange?.from}
          selected={selectedDateRange}
          onSelect={(range) => {
            if (range) onDateRangeChange(range);
          }}
          min={2}
          numberOfMonths={isMobile ? 1 : 2}
          showOutsideDays={false}
          disabled={[
            { from: addDays(new Date(), 1), to: addYears(new Date(), 1000) },
          ]}
        />
      </PopoverContent>
    </Popover>
  );
}
