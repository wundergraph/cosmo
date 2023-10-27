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
import { addDays, addYears, differenceInHours, subHours } from "date-fns";
import { useEffect, useState } from "react";
import { DateRange } from "react-day-picker";

const ranges: Record<number, string> = {
  1: "Last hour",
  4: "Last 4 hours",
  24: "Last day",
  72: "Last 3 days",
  168: "Last week",
  720: "Last month",
};

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

  const diff =
    selectedDateRange?.to &&
    selectedDateRange?.from &&
    differenceInHours(selectedDateRange.to, selectedDateRange.from);

  const [selected, setSelected] = useState(selectedDateRange);

  const [range, setRange] = useState(diff);

  const rangeLabel = diff ? ranges[diff] : undefined;

  useEffect(() => {
    setSelected(selectedDateRange);
  }, [selectedDateRange]);

  const setSelectedRange = (range: number) => {
    const from = subHours(new Date(), range);
    const to = new Date();

    setSelected({ from, to });
    setRange(range);
    onDateRangeChange({ from, to });
  };

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
            "w-[200px] justify-start px-2.5 text-left font-normal",
            className,
            !selected && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />

          <span className="truncate text-sm">
            {rangeLabel ? (
              rangeLabel
            ) : selected?.from ? (
              selected.to ? (
                <>
                  {formatDate(selected.from)} - {formatDate(selected.to)}
                </>
              ) : (
                <>{formatDate(selected.from)} - </>
              )
            ) : (
              <>Pick a date</>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto flex-row p-0" align={align}>
        <ul className="w-[140px] space-y-[1px] p-2">
          {Object.entries(ranges).map(([id, label]) => (
            <li key={id}>
              <Button
                variant="ghost"
                className="w-full justify-start"
                data-active={range === Number(id) ? "" : undefined}
                onClick={() => setSelectedRange(Number(id))}
              >
                {label}
              </Button>
            </li>
          ))}
        </ul>
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
