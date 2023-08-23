import * as React from "react";
import { addDays, addYears, format } from "date-fns";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import CalendarIcon from "@heroicons/react/24/outline/CalendarIcon";
import useWindowSize from "@/hooks/use-window-size";

export function DatePickerWithRange({
  selectedDateRange,
  onDateRangeChange,
  className,
}: React.HTMLAttributes<HTMLDivElement> & {
  selectedDateRange: DateRange;
  onDateRangeChange: (newVal: DateRange) => unknown;
}) {
  const { isMobile } = useWindowSize();

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[280px] justify-center text-left font-normal",
              !selectedDateRange && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selectedDateRange?.from ? (
              selectedDateRange.to ? (
                <>
                  {format(selectedDateRange.from, "LLL dd, y")} -{" "}
                  {format(selectedDateRange.to, "LLL dd, y")}
                </>
              ) : (
                format(selectedDateRange.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
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
    </div>
  );
}
