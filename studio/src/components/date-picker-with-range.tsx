import { Button, ButtonProps } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useWindowSize from "@/hooks/use-window-size";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import CalendarIcon from "@heroicons/react/24/outline/CalendarIcon";
import { addDays, addYears } from "date-fns";
import { useState } from "react";
import { DateRange } from "react-day-picker";

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

  const [selected, setSelected] = useState(selectedDateRange);

  const isDayBetween = (day: Date, from: Date, to: Date) => {
    return day > from && day < to;
  };

  const handleDayClick = (day: Date) => {
    const { from, to } = selectedDateRange;

    if (from && to && isDayBetween(day, from, to)) {
      setSelected({ from: day, to: undefined });
    }
  };

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
            !selected && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selected?.from ? (
            selected.to ? (
              <>
                {formatDate(selected.from)} - {formatDate(selected.to)}
              </>
            ) : (
              <>{formatDate(selected.from)} - </>
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
          defaultMonth={selected?.from}
          selected={selected}
          onSelect={(range, day) => {
            if (range) {
              if (
                selected.from &&
                selected.to &&
                isDayBetween(day, selected.from, selected.to)
              ) {
                setSelected({ from: day, to: undefined });
                return;
              }
              setSelected(range);
              onDateRangeChange(range);
            }
          }}
          onDayClick={handleDayClick}
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
